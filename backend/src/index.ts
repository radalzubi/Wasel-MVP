import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Production bypass guard — fail-loud startup assertion.
//
// TEST_BYPASS_ENABLED unlocks three dangerous behaviours:
//   1. /api/auth/dev-login (hard-coded test users + magic OTP 123456)
//   2. auto-approval of any newly-registered driver
//   3. dispatch radius of 99_999 km (worldwide offers to the nearest "driver")
//
// Combined with NODE_ENV=production these become a critical exposure. Rather
// than silently running with them enabled, we refuse to boot so the ops
// operator notices immediately. Staging environments that legitimately need
// these features should use NODE_ENV=staging or similar, not production.
if (process.env.NODE_ENV === 'production' && process.env.TEST_BYPASS_ENABLED === 'true') {
  // eslint-disable-next-line no-console
  console.error(
    '[FATAL] NODE_ENV=production with TEST_BYPASS_ENABLED=true is an unsafe ' +
    'combination — it exposes dev-login, auto-approves drivers, and removes ' +
    'the dispatch radius. Unset TEST_BYPASS_ENABLED or set NODE_ENV=staging.',
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
// In production ALLOWED_ORIGINS should be set to a comma-separated list of
// allowed origins (e.g. "https://app.wasel.jo,https://rider.wasel.jo").
// Falling back to '*' is acceptable for a mobile-app-only API (no cookies),
// but should be tightened once domains are finalised.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : (() => {
      if (process.env.NODE_ENV === 'production') {
        console.error('[SECURITY] ALLOWED_ORIGINS is not set in production — CORS is open to all origins. Set this variable immediately.');
      } else {
        console.warn('[SECURITY] ALLOWED_ORIGINS is not set — CORS is open to all origins (*). Set this variable in production.');
      }
      return '*';
    })();

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH'],
}));
app.use(express.json({ limit: '10kb' }));

// Global rate limit: 100 req/min per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
}));

// Strict rate limit for OTP routes: 5 req/15min per IP
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', waitlistMode: process.env.WAITLIST_MODE === 'true' });
});

// ----------------------------------------------------------------
// P3: Backend waitlist-mode enforcement
//
// When WAITLIST_MODE=true the backend accepts only health and
// waitlist-signup requests.  All authenticated operational endpoints
// (auth, trips, drivers, riders, explore) return 503 so mobile
// clients that bypass the frontend gate still cannot use the API.
//
// Allowed in waitlist mode:
//   GET  /health
//   GET  /api/waitlist/count
//   POST /api/waitlist
//
// Blocked (503) in waitlist mode:
//   /api/auth/*  /api/trips/*  /api/drivers/*  /api/riders/*  /api/explore/*
// ----------------------------------------------------------------
const WAITLIST_MODE = process.env.WAITLIST_MODE === 'true';

if (WAITLIST_MODE) {
  console.log('[waitlist] WAITLIST_MODE=true — operational endpoints blocked');
  app.use(
    ['/api/auth', '/api/trips', '/api/drivers', '/api/riders', '/api/explore'],
    (_req, res) => {
      res.status(503).json({
        error: 'Wasel has not launched yet. Join the waitlist at /api/waitlist.',
      });
    },
  );
}

// Routes
import waitlistRouter  from './routes/waitlist';
import authRouter      from './routes/auth';
import estimateRouter  from './routes/estimate';
import tripsRouter     from './routes/trips';
import driversRouter   from './routes/drivers';
import ridersRouter    from './routes/riders';
import exploreRouter   from './routes/explore';

app.use('/api/waitlist',       waitlistRouter);
app.use('/api/auth',           authRouter);
// Estimate must be mounted BEFORE the trips router so Express does not
// mistake /api/trips/estimate for a trip ID param route.
app.use('/api/trips/estimate', estimateRouter);
app.use('/api/trips',          tripsRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/riders',  ridersRouter);
app.use('/api/explore', exploreRouter);

// ----------------------------------------------------------------
// P6: Start the DB-based dispatch poller.
//
// The poller replaces the in-memory setTimeout recursion that was
// previously inside dispatchTrip(). Expired pending offers are now
// detected by a polling query every POLLER_INTERVAL_MS (5 s) and
// re-dispatched from here.  Because all state lives in the database,
// this approach survives process restarts and is safe to run on
// multiple instances (optimistic concurrency on the offer row
// prevents double-dispatch).
// ----------------------------------------------------------------
import { startDispatchPoller, startDataCleanupJob } from './dispatch/engine';

app.listen(PORT, () => {
  console.log(`Wasel backend running on port ${PORT}`);
  console.log(`Waitlist mode: ${WAITLIST_MODE}`);
  console.log(`Environment: ${process.env.NODE_ENV ?? 'unset'}`);

  if (!WAITLIST_MODE) {
    const pollerHandle  = startDispatchPoller();
    const cleanupHandle = startDataCleanupJob();
    console.log('[dispatch] Poller started (interval: 5s)');
    console.log('[cleanup]  Data cleanup job started (interval: 30min)');

    // Graceful shutdown: clear both intervals so in-flight DB operations
    // can finish before the process exits (avoids partial deletes).
    function shutdown(signal: string) {
      clearInterval(pollerHandle);
      clearInterval(cleanupHandle);
      console.log(`[shutdown] Poller + cleanup stopped (${signal})`);
      process.exit(0);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  }
});

export default app;
