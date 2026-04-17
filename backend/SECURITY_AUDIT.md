# Security Audit — 2026-04-16

Auditor: Claude (Sonnet 4.6)
Scope: Full backend (Node.js/Express/TypeScript), Supabase RLS migrations, Expo/React Native frontend apps.

---

## Critical Issues (fix immediately)

### C1 — dev-login endpoint had no rate limiting
**File:** `backend/src/routes/auth.ts`

`POST /api/auth/dev-login` had the production guard (`NODE_ENV === 'production'` returns 404) but was NOT wrapped in `otpLimiter`. An attacker who set `NODE_ENV` incorrectly, or who hit a staging environment without `NODE_ENV=production`, could brute-force the two hardcoded dev credentials (fixed passwords) at unlimited speed.

**Fix applied:** Added `otpLimiter` middleware to `/dev-login` (same 5-req/15-min window as the other auth endpoints).

---

### C2 — RLS allows authenticated clients to self-update `is_waitlist_member`
**File:** `backend/supabase/migrations/003_rls_and_latlong.sql` (existing), `005_rls_waitlist_member_readonly.sql` (new migration)

The existing `riders_self_update` and `drivers_self_update` RLS policies granted UPDATE on the entire row for the authenticated user, including `is_waitlist_member`, `waitlist_joined_at`, and `waitlist_position`. A motivated user could:

1. Use the Supabase JS client (with the anon key) to directly call `supabase.from('riders').update({ is_waitlist_member: true })`.
2. Bypass the waitlist entirely and self-promote.

**Fix applied:** Created migration `005_rls_waitlist_member_readonly.sql` which:
- Drops the broad `riders_self_update` and `drivers_self_update` policies and recreates them.
- Adds `REVOKE UPDATE (is_waitlist_member, waitlist_joined_at, waitlist_position) ON riders/drivers FROM authenticated` — a column-level privilege revocation that blocks direct client writes even if a future policy mistake re-opens UPDATE.
- The backend uses the `service_role` key (bypasses RLS) so `applyWaitlistMembership()` continues to work correctly.

---

## Medium Issues

### M1 — Internal error messages leaked in 500 responses
**Files:** `backend/src/routes/auth.ts`, `backend/src/routes/drivers.ts`, `backend/src/routes/trips.ts`

Several 500-error paths returned raw `error.message` from Supabase to the client. This can expose internal table names, constraint names, query structure, and Supabase-specific messaging.

**Fix applied:**
- `POST /api/auth/send-otp` 500 → `"Failed to send OTP. Please try again."`
- `POST /api/auth/verify` 401 → `"Invalid or expired OTP"` (also prevents user-existence oracle via timing differences in error text)
- `PATCH /api/drivers/location` 500 → `"Failed to update location"`
- `PATCH /api/drivers/status` 500 → `"Failed to update status"`
- `POST /api/trips/:id/accept` 500 → `"Failed to accept trip"`
- `POST /api/trips/:id/status` 500 → `"Failed to update trip status"`

Note: error messages inside the `dev-login` code path still surface raw Supabase errors. Those paths are gated by `NODE_ENV !== 'production'` so they never reach a production client.

---

### M2 — PATCH /api/drivers/location used ad-hoc manual validation instead of Zod
**File:** `backend/src/routes/drivers.ts`

The location endpoint used manual `typeof` and range checks rather than the Zod schema pattern used everywhere else. This was inconsistent and easier to miss when the validation logic changes.

**Fix applied:** Replaced with a `LocationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })` pattern matching the `TripRequestSchema` coordinate approach.

---

### M3 — CORS origin fell back to the string `'*'` when `ALLOWED_ORIGINS` was unset
**File:** `backend/src/index.ts`

The original code was:
```ts
origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
```
When `ALLOWED_ORIGINS` is unset this passes the string `'*'` to `cors()`. While `cors` accepts this, the intent was unclear and mixing an array type with a string fallback is fragile. For an API consumed only by mobile apps (no browser cookies), `'*'` is acceptable, but the origin handling should be explicit.

**Fix applied:** Made the fallback explicit with a comment:
```ts
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*';
```
A comment notes that `ALLOWED_ORIGINS` should be set in production once domains are finalised.

---

## Low / Informational

### L1 — Frontend calls Supabase auth directly, bypassing backend rate limiting
**Files:** `rider/app/(auth)/login.tsx`, `rider/app/(auth)/verify.tsx`

The rider login screen calls `supabase.auth.signInWithOtp({ phone })` directly from the client (using the anon key) rather than hitting `POST /api/auth/send-otp` on the backend. Similarly, the verify screen calls `supabase.auth.verifyOtp()` directly rather than `POST /api/auth/verify`.

This means:
- The backend `otpLimiter` is bypassed — rate limiting depends entirely on Supabase's own phone auth throttling.
- The `applyWaitlistMembership` logic never runs for the client-direct path (though the backend verify endpoint does run it when called).

**Recommended fix (not applied — requires UX decision):** Route all OTP send/verify calls through the backend, using the session returned by the backend verify endpoint to call `supabase.auth.setSession()`. The backend already has this flow for the `dev-login` path. Evaluate whether Supabase's built-in phone auth rate limits are sufficient for MVP.

---

### L2 — `NODE_ENV` is not set in `backend/.env`
**File:** `backend/.env`

The `.env` file does not contain a `NODE_ENV=production` line. This means:
- On Railway, `NODE_ENV` is typically set by the platform at runtime — verify this is the case.
- If the platform does NOT inject `NODE_ENV=production`, the dev-login production guard will NOT fire, and test credentials will be live in production.

**Recommended fix (not applied):** Add `NODE_ENV=production` to the Railway environment variables via the dashboard and add a startup assertion to `index.ts`:
```ts
if (!process.env.NODE_ENV) {
  console.warn('WARNING: NODE_ENV is not set — defaulting to development mode');
}
```

---

### L3 — Waitlist phone validation is too loose
**File:** `backend/src/routes/waitlist.ts`

`WaitlistSchema` validates phone as `z.string().min(8).max(20)` — any 8–20 character string is accepted. This allows junk data into the waitlist and is inconsistent with the strict Jordanian regex used in the auth routes.

**Recommended fix (not applied — depends on whether international waitlist signups are wanted):**
```ts
phone: z.string().regex(/^\+?[\d\s\-\(\)]{8,20}$/, 'Invalid phone number'),
```
Or use the same strict Jordanian regex if the MVP is Jordan-only.

---

### L4 — CORS wildcard in production (informational)
**File:** `backend/src/index.ts`

When `ALLOWED_ORIGINS` is not set, the API allows requests from any origin (`*`). For a pure mobile-app API that never uses browser cookies or session-based auth, this is not a vulnerability (CORS is a browser-only protection). However, if a web dashboard is ever added, this must be tightened before launch.

---

### L5 — `backend/.env` contains real service-role key (not committed to git)
**File:** `backend/.env`

The `.env` file contains a real `SUPABASE_SERVICE_ROLE_KEY`. This key is not committed to git (confirmed: the root `.gitignore` has `*.env`), so it is not exposed in the repository. However:
- The key is long-lived (expiry 2091) — consider rotating it periodically.
- Ensure the Railway environment variable (`SUPABASE_SERVICE_ROLE_KEY`) is set via the Railway dashboard, not embedded in any `railway.json` or `Dockerfile`.

---

### L6 — `requireDriver` not enforced on driver-only PATCH routes
**File:** `backend/src/routes/drivers.ts`

`PATCH /api/drivers/location` and `PATCH /api/drivers/status` use `requireAuth` but not `requireDriver`. A rider with a valid token could call these endpoints. Since the update is scoped to `.eq('id', req.userId)` and riders have no row in the `drivers` table, the update silently no-ops — no data is corrupted. However, this is misleading and could become a problem if the scoping logic ever changes.

**Recommended fix (not applied — low actual risk):** Add `requireDriver` middleware to both routes for defence-in-depth and intent clarity.

---

## Checklist Summary

| Check | Result |
|---|---|
| dev-login blocked in production | PASS (NODE_ENV guard) |
| dev-login rate-limited | FIXED (was missing) |
| send-otp rate-limited | PASS |
| verify rate-limited | PASS |
| Global rate limiter | PASS (100 req/min) |
| Zod validation on all routes | PASS (after M2 fix) |
| Explore route — no SQL injection | PASS (hardcoded data) |
| Coordinate bounds validated | PASS |
| Phone numbers validated before Supabase | PASS (strict regex) |
| All data-modifying routes behind requireAuth | PASS |
| trips POST behind requireRider | PASS |
| GET /api/riders/me behind requireAuth | PASS |
| GET /api/drivers/me behind requireAuth | PASS |
| Backend uses service_role key | PASS |
| Frontend uses anon key only | PASS |
| driver/lib/supabase.ts uses anon key | PASS |
| rider/lib/supabase.ts uses anon key | PASS |
| Rider cannot read another rider's trip | PASS (RLS: rider_id = auth.uid()) |
| Driver cannot read another driver's offer | PASS (RLS: driver_id = auth.uid()) |
| is_waitlist_member write-protected | FIXED (migration 005) |
| CORS configuration | FIXED (explicit, documented) |
| 500 errors do not leak stack traces | FIXED |
| Auth errors do not confirm user existence | PASS (generic messages) |
| Tokens in Authorization header | PASS |
| Server-side token validation via getUser() | PASS |
| express.json({ limit: '10kb' }) | PASS |
| helmet() applied | PASS |

---

## Fixes Applied

| # | File | Change |
|---|---|---|
| 1 | `backend/src/routes/auth.ts` line 202 | Added `otpLimiter` middleware to `POST /dev-login` |
| 2 | `backend/src/routes/auth.ts` line 96 | Replaced raw `error.message` with generic message on send-otp 500 |
| 3 | `backend/src/routes/auth.ts` line 169 | Replaced raw `error.message` with generic `"Invalid or expired OTP"` on verify 401 |
| 4 | `backend/src/routes/drivers.ts` lines 8-17 | Replaced ad-hoc manual validation with `LocationSchema` Zod schema |
| 5 | `backend/src/routes/drivers.ts` line 26 | Generic error message on location update failure |
| 6 | `backend/src/routes/drivers.ts` line 44 | Generic error message on status update failure |
| 7 | `backend/src/routes/trips.ts` line 78 | Generic error message on accept failure |
| 8 | `backend/src/routes/trips.ts` line 116 | Generic error message on status update failure |
| 9 | `backend/src/index.ts` lines 14-22 | Made CORS origin handling explicit with comment about production config |
| 10 | `backend/supabase/migrations/005_rls_waitlist_member_readonly.sql` | New migration: REVOKE column-level UPDATE on waitlist fields from `authenticated` role |
