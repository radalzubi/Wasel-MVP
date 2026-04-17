import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

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
      console.warn('[SECURITY] ALLOWED_ORIGINS is not set — CORS is open to all origins (*). Set this variable in production.');
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
  res.json({ status: 'ok' });
});

// Routes
import waitlistRouter from './routes/waitlist';
import authRouter from './routes/auth';
import tripsRouter from './routes/trips';
import driversRouter from './routes/drivers';
import ridersRouter from './routes/riders';
import exploreRouter from './routes/explore';

app.use('/api/waitlist', waitlistRouter);
app.use('/api/auth', authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/riders', ridersRouter);
app.use('/api/explore', exploreRouter);

app.listen(PORT, () => {
  console.log(`Wasel backend running on port ${PORT}`);
  console.log(`Waitlist mode: ${process.env.WAITLIST_MODE === 'true'}`);
});

export default app;
