# Wasel MVP Launch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Take Wasel from its current state to a production-ready app where real riders and drivers can connect, complete trips, and have the essential experience work reliably.

**Architecture:** Eight phases in strict priority order — database blockers first, then the single highest-impact feature (push notifications, without which the business model breaks), then background GPS, then feature completeness (driver onboarding, trip history, navigation), then polish. Every task is independently committable. No task depends on a later task.

**Tech Stack:** Expo SDK 52 / React Native (rider + driver apps), Express + TypeScript + Zod (backend on Railway), Supabase (Postgres + Auth + Realtime), `expo-notifications` + Expo Push Service (FCM/APNs), `expo-location` background mode, Google Maps SDK + Directions API, react-native-maps

---

## ⚠️ Pre-flight: What's Broken Today

Before writing any code, understand the current critical failures:

1. **Every `POST /api/trips` silently fails.** Migration `002_core_tables.sql` declares `pickup_location` and `dropoff_location` as `geography(Point,4326) NOT NULL`, but the backend never writes them. Unless these columns were manually nullified in the Supabase dashboard, trip creation has been broken since day one.

2. **Drivers never receive offers in the background.** Neither app has `expo-notifications` installed. Supabase Realtime requires the app to be foregrounded and the socket to be open. A driver with their phone in their pocket = no trips = dead product.

3. **Driver location freezes on iOS the moment the screen locks.** The driver app only has `locationWhenInUsePermission`. iOS kills background location without the `background` mode + foreground service notification configured.

4. **The live production backend has `NODE_ENV=development`.** This means the test phone `+962790000001` and OTP `123456` work against the real database. Anyone who reads the code can bypass OTP.

5. **EAS builds fail silently on Supabase auth.** `eas.json` injects `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` but `lib/supabase.ts` reads `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The Supabase client gets `undefined` in every standalone build.

---

## Phase 1 — Database Blockers

### Task 1: Migration 010 — Fix Schema Blockers

**What it fixes:** PostGIS NOT NULL blocker, missing performance indexes, missing uniqueness constraint, env variable name mismatch in EAS, waitlist RLS.

**Files:**
- Create: `backend/supabase/migrations/010_schema_fixes.sql`
- Modify: `driver/eas.json` (rename env key)
- Modify: `rider/eas.json` (rename env key, create if missing)

---

**Step 1: Write migration `010_schema_fixes.sql`**

Create `/Users/radalzubi/Desktop/WASELMVP/backend/supabase/migrations/010_schema_fixes.sql`:

```sql
-- =========================================================================
-- Migration 010: Schema Fixes for MVP Launch
-- Run via Supabase Dashboard → SQL Editor, or supabase db push
-- =========================================================================

-- ── 1. Fix PostGIS NOT NULL blocker ───────────────────────────────────────
-- The backend never writes pickup_location / dropoff_location (PostGIS geography
-- columns). They were declared NOT NULL in 002 but the app exclusively uses the
-- plain float equivalents (pickup_lat/lng, dropoff_lat/lng). Without this fix,
-- every POST /api/trips fails with a 23502 NOT NULL constraint violation.
ALTER TABLE trips
  ALTER COLUMN pickup_location  DROP NOT NULL,
  ALTER COLUMN dropoff_location DROP NOT NULL;

-- ── 2. Partial unique index — one active trip per rider ───────────────────
-- Prevents a TOCTOU race where two concurrent requests both pass the
-- "active trip check" SELECT before either INSERT commits, creating two
-- active trips for the same rider. The WHERE clause excludes terminal states.
-- NOTE: This index is referenced in a comment in trips.ts but was never created.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_rider
  ON trips (rider_id)
  WHERE status NOT IN ('completed', 'cancelled');

-- ── 3. Performance indexes ────────────────────────────────────────────────
-- The dispatch poller runs every 5 s querying trip_offers by status + expires_at.
-- No indexes on these columns currently exist beyond the FK on trip_id.
CREATE INDEX IF NOT EXISTS trip_offers_status_expires_idx
  ON trip_offers (status, expires_at);

CREATE INDEX IF NOT EXISTS trip_offers_driver_id_idx
  ON trip_offers (driver_id);

-- Dispatch engine queries trips by status frequently; existing trips_status_idx
-- may not cover composite queries with rider/driver filters.
CREATE INDEX IF NOT EXISTS trips_status_created_idx
  ON trips (status, created_at);

-- Subscription tier lookups in dispatch engine: driver_id IN (...) AND expires_at > now()
CREATE INDEX IF NOT EXISTS subscriptions_driver_expires_idx
  ON subscriptions (driver_id, expires_at);

-- ── 4. Push token columns ─────────────────────────────────────────────────
-- Stores the Expo push token for each user so the backend can send
-- notifications. One token per user (overwritten on each login/app start).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE riders  ADD COLUMN IF NOT EXISTS push_token text;

-- ── 5. Waitlist RLS ───────────────────────────────────────────────────────
-- The waitlist table has no RLS. All phone numbers and names are public PII.
-- Enable RLS and allow only public INSERT (signup), deny direct SELECT.
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "waitlist_public_insert"
  ON waitlist FOR INSERT
  WITH CHECK (true);
-- No SELECT policy → only service_role (backend) can read waitlist rows.

-- ── 6. Dead column: drivers.idle_time_minutes ────────────────────────────
-- This column was replaced by became_available_at in migration 006 and has
-- never been written to since. Remove it to reduce confusion.
ALTER TABLE drivers DROP COLUMN IF EXISTS idle_time_minutes;

-- ── 7. CHECK constraint on trip_status_history.status ────────────────────
-- Mirrors the constraint on trips.status to prevent garbage values in the audit log.
ALTER TABLE trip_status_history
  ADD CONSTRAINT IF NOT EXISTS trip_status_history_status_check
  CHECK (status IN ('requested','dispatching','accepted','en_route','arrived','in_progress','completed','cancelled'));
```

**Step 2: Run the migration**

Run the SQL in Supabase Dashboard → SQL Editor → paste file content → Run.

Expected: All statements succeed. The `one_active_trip_per_rider` index creation may take a second on large tables.

Verify in Dashboard → Table Editor → `trips` table: `pickup_location` column should show "nullable" in the schema view.

**Step 3: Fix the EAS env variable name mismatch**

The driver `eas.json` sets `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` but `driver/lib/supabase.ts` reads `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Every standalone EAS build has a broken Supabase client.

Modify `/Users/radalzubi/Desktop/WASELMVP/driver/eas.json` — in all three `env` blocks (development, preview, production) rename the key:

```json
"EXPO_PUBLIC_SUPABASE_ANON_KEY": "<SUPABASE_PUBLISHABLE_KEY>"
```

(The value is the same — it's the same publishable/anon key, just under the correct name.)

Also create `/Users/radalzubi/Desktop/WASELMVP/rider/eas.json` if it does not exist:

```json
{
  "cli": { "version": ">= 14.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://wasel-mvp-production.up.railway.app",
        "EXPO_PUBLIC_SUPABASE_URL": "https://javvotaghswskyuzrgwr.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<SUPABASE_PUBLISHABLE_KEY>"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://wasel-mvp-production.up.railway.app",
        "EXPO_PUBLIC_SUPABASE_URL": "https://javvotaghswskyuzrgwr.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<SUPABASE_PUBLISHABLE_KEY>"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_API_URL": "https://wasel-mvp-production.up.railway.app",
        "EXPO_PUBLIC_SUPABASE_URL": "https://javvotaghswskyuzrgwr.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<SUPABASE_PUBLISHABLE_KEY>"
      }
    }
  }
}
```

**Step 4: Commit**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
git add backend/supabase/migrations/010_schema_fixes.sql driver/eas.json rider/eas.json
git commit -m "fix(schema): migration 010 — drop PostGIS NOT NULL, add indexes, push_token cols, waitlist RLS, fix EAS env key name"
```

---

### Task 2: Remove PostGIS Dead Code from Backend

**What it fixes:** The backend writes `SRID=4326;POINT(...)` to PostGIS columns that are never read. Now that we've made them nullable, these writes are harmless but misleading. Remove them.

**Files:**
- Modify: `backend/src/routes/trips.ts` (remove pickup_location and dropoff_location writes)
- Modify: `backend/src/routes/drivers.ts` (remove current_location write if it exists)

---

**Step 1: Check drivers.ts for any PostGIS write**

Grep for `current_location` or `SRID` in drivers.ts. Based on the audit, the PATCH `/api/drivers/location` already only writes `location_lat`/`location_lng`. No change needed there.

Check trips.ts for `pickup_location` and `dropoff_location` writes in the INSERT block. If the previous PostGIS cleanup plan (in `docs/plans/linear-exploring-clarke.md`) was already executed (commit `dc0846f` references this), these may already be removed. Verify with:

```bash
grep -n "pickup_location\|dropoff_location\|SRID\|current_location" \
  backend/src/routes/trips.ts backend/src/routes/drivers.ts
```

**Step 2: If any `SRID=4326;POINT` writes remain, remove them**

In `backend/src/routes/trips.ts`, in the trip INSERT object, remove any lines like:
```typescript
pickup_location:  `SRID=4326;POINT(${pickup_lng} ${pickup_lat})`,
dropoff_location: `SRID=4326;POINT(${dropoff_lng} ${dropoff_lat})`,
```

**Step 3: Verify TypeScript compiles**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add backend/src/routes/trips.ts backend/src/routes/drivers.ts
git commit -m "fix(backend): remove dead PostGIS column writes from trips and drivers routes"
```

---

## Phase 2 — Push Notifications

> **Why this is Phase 2:** Without push notifications, a driver who puts their phone in their pocket never receives a trip offer. The entire ridehail model breaks. This is the highest-impact feature gap.

### Task 3: Backend Push Notification Infrastructure

**What it builds:** An `expo-server-sdk` integration in the backend to send Expo push notifications. A new endpoint to register push tokens. A `sendPushNotification()` utility called by the dispatch engine and trip routes.

**Files:**
- Modify: `backend/package.json` (add `expo-server-sdk`)
- Create: `backend/src/lib/push.ts`
- Modify: `backend/src/routes/drivers.ts` (add PATCH /push-token endpoint)
- Modify: `backend/src/routes/riders.ts` (add PATCH /push-token endpoint)

---

**Step 1: Install expo-server-sdk**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend
npm install expo-server-sdk
```

**Step 2: Create `backend/src/lib/push.ts`**

```typescript
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

// Singleton Expo client — handles chunking, error parsing, and receipt tracking.
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Sends a push notification to a single Expo push token.
 * Fire-and-forget: logs errors but never throws — a push failure
 * must never break the API response that triggered it.
 *
 * @param token  - Expo push token (e.g. "ExponentPushToken[xxxxxx]")
 * @param title  - Notification title
 * @param body   - Notification body text
 * @param data   - Optional payload delivered to the app on tap
 */
export async function sendPush(
  token: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!token) return;
  if (!Expo.isExpoPushToken(token)) {
    console.warn('[push] invalid Expo push token, skipping:', token);
    return;
  }

  const message: ExpoPushMessage = {
    to: token,
    sound: 'default',
    title,
    body,
    data: data ?? {},
    // Android: high-priority channel for ride offers so they wake the screen.
    priority: 'high',
    channelId: 'wasel-trips',
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error('[push] send error:', ticket.message, ticket.details);
        }
      }
    }
  } catch (err) {
    console.error('[push] unexpected error sending push:', err);
  }
}
```

**Step 3: Add PATCH /api/drivers/push-token endpoint to `backend/src/routes/drivers.ts`**

Insert before the `export default router` line:

```typescript
// PATCH /api/drivers/push-token — register or refresh Expo push token
router.patch('/push-token', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const PushTokenSchema = z.object({
    token: z.string().min(1),
  });
  const parsed = PushTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase
    .from('drivers')
    .update({ push_token: parsed.data.token })
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: 'Failed to save push token' });
  res.json({ ok: true });
});
```

**Step 4: Add PATCH /api/riders/push-token endpoint to `backend/src/routes/riders.ts`**

Read the current `riders.ts` file, then add before `export default router`:

```typescript
// PATCH /api/riders/push-token — register or refresh Expo push token
router.patch('/push-token', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const PushTokenSchema = z.object({
    token: z.string().min(1),
  });
  const parsed = PushTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase
    .from('riders')
    .update({ push_token: parsed.data.token })
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: 'Failed to save push token' });
  res.json({ ok: true });
});
```

Make sure to add the `requireRider` import if it's not already imported from `../middleware/auth`.

**Step 5: Verify TypeScript compiles**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend
npx tsc --noEmit
```

Expected: No errors.

**Step 6: Commit**

```bash
git add backend/src/lib/push.ts backend/src/routes/drivers.ts backend/src/routes/riders.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): add push notification infrastructure — expo-server-sdk, push token endpoints"
```

---

### Task 4: Wire Push Notifications into Dispatch Engine and Trip Routes

**What it builds:** Actual push sends triggered at the right moments: offer to driver, confirmation to rider, cancellation alert to both sides.

**Files:**
- Modify: `backend/src/dispatch/engine.ts` (push to driver when offer is created)
- Modify: `backend/src/routes/trips.ts` (push to rider on accept; push to either party on cancel/status advance)

---

**Step 1: Add push trigger in `dispatchTrip()` after offer INSERT**

In `backend/src/dispatch/engine.ts`, add the import at the top:

```typescript
import { sendPush } from '../lib/push';
```

After the offer INSERT succeeds (the block around line 165+ where the offer is inserted and `winner.driverId` is confirmed), add:

```typescript
// Push the driver — fire-and-forget, never block dispatch on push failure.
supabase
  .from('drivers')
  .select('push_token')
  .eq('id', winner.driverId)
  .maybeSingle()
  .then(({ data }) => {
    if (data?.push_token) {
      sendPush(
        data.push_token,
        '🚗 New Ride Request',
        `Pickup: ${pickupLat.toFixed(4)}, ${pickupLng.toFixed(4)} — Accept within 15 seconds`,
        { type: 'new_offer', tripId },
      );
    }
  })
  .catch((err: unknown) => console.error('[dispatch] push fetch failed:', err));
```

**Step 2: Add push trigger in trips.ts accept endpoint**

After the accept endpoint updates the trip to `accepted` (and before `res.json({ ok: true })`), add:

```typescript
// Notify the rider their driver is confirmed.
supabase
  .from('riders')
  .select('push_token')
  .eq('id', trip.rider_id)
  .maybeSingle()
  .then(({ data: rider }) => {
    if (rider?.push_token) {
      sendPush(
        rider.push_token,
        '✅ Driver Confirmed',
        'Your driver is on the way. You can track them live in the app.',
        { type: 'trip_accepted', tripId },
      );
    }
  })
  .catch((err: unknown) => console.error('[trips/accept] rider push failed:', err));
```

**Step 3: Add push trigger in trips.ts status endpoint for `cancelled`**

In the PATCH `/api/trips/:id/status` handler, after the status is set to `cancelled`, determine who cancelled and notify the other party:

```typescript
// Push the counter-party when a trip is cancelled.
if (newStatus === 'cancelled') {
  const cancellerIsRider = req.userId === trip.rider_id;
  if (cancellerIsRider) {
    // Rider cancelled — notify driver (if assigned)
    if (trip.driver_id) {
      supabase.from('drivers').select('push_token').eq('id', trip.driver_id).maybeSingle()
        .then(({ data }) => sendPush(data?.push_token, '❌ Trip Cancelled', 'The rider cancelled this trip.', { type: 'trip_cancelled', tripId }))
        .catch(() => {});
    }
  } else {
    // Driver cancelled — notify rider
    supabase.from('riders').select('push_token').eq('id', trip.rider_id).maybeSingle()
      .then(({ data }) => sendPush(data?.push_token, '❌ Trip Cancelled', 'Your driver cancelled. We\'ll find you another one.', { type: 'trip_cancelled', tripId }))
      .catch(() => {});
  }
}
```

**Step 4: Add push when rider trip is auto-cancelled by poller (no drivers found)**

In `backend/src/dispatch/engine.ts`, in the `startDispatchPoller()` function, when a trip is auto-cancelled (rounds exhausted), add:

```typescript
// Notify rider of auto-cancellation.
supabase.from('riders').select('push_token').eq('id', cancelledTrip.rider_id).maybeSingle()
  .then(({ data }) => sendPush(
    data?.push_token,
    '😔 No Drivers Available',
    'We couldn\'t find a driver nearby. Please try again in a few minutes.',
    { type: 'trip_auto_cancelled', tripId: cancelledTrip.id },
  ))
  .catch(() => {});
```

(You'll need to select `rider_id` in the stale/stuck trip query to have access to it here.)

**Step 5: Add import for sendPush in trips.ts**

```typescript
import { sendPush } from '../lib/push';
```

**Step 6: Verify TypeScript compiles**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend
npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add backend/src/dispatch/engine.ts backend/src/routes/trips.ts
git commit -m "feat(backend): wire push notifications — offer to driver, accept/cancel to rider, auto-cancel alert"
```

---

### Task 5: App-Side Push Notification Setup (Both Apps)

**What it builds:** Both apps request notification permissions on startup, register the Expo push token, and send it to the backend. The driver app also shows a local notification for incoming offers (as a heads-up display when the app is backgrounded).

**Important manual step before coding:** Each app needs a Firebase project + `google-services.json` for Android push notifications.

> **Manual setup required (do once, not in code):**
> 1. Go to [Firebase Console](https://console.firebase.google.com) → Create Project "wasel-rider" and "wasel-driver" (or use one project with two apps)
> 2. Add Android app with package name `com.wasel.rider` (and separately `com.wasel.driver`)
> 3. Download `google-services.json` for each → place at `rider/google-services.json` and `driver/google-services.json`
> 4. For iOS APNs: In EAS Dashboard (expo.dev) → Your project → Credentials → iOS → upload your APNs `.p8` key from Apple Developer Portal
> 5. Set `EXPO_ACCESS_TOKEN` in Railway env vars (get from expo.dev/accounts/[your-account]/settings/access-tokens) — this lets the backend send via Expo's push service

**Files:**
- Modify: `rider/app.config.js` (add expo-notifications plugin)
- Modify: `driver/app.config.js` (add expo-notifications plugin + background location)
- Create: `rider/lib/notifications.ts`
- Create: `driver/lib/notifications.ts`
- Modify: `rider/app/_layout.tsx` (register token on app start)
- Modify: `driver/app/(app)/_layout.tsx` (register token on app start)

---

**Step 1: Install expo-notifications in both apps**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/rider && npx expo install expo-notifications
cd /Users/radalzubi/Desktop/WASELMVP/driver && npx expo install expo-notifications
```

**Step 2: Add expo-notifications plugin to `rider/app.config.js`**

In the `plugins` array (after `'expo-router'` and the `expo-location` entry):

```javascript
[
  'expo-notifications',
  {
    icon: './assets/icon.png',
    color: '#F5A623',
    defaultChannel: 'wasel-trips',
    sounds: [],
  },
],
```

Add the same block to `driver/app.config.js` plugins array.

Also add `google-services.json` path for Android in the `android` section of both configs:

```javascript
android: {
  // ... existing keys ...
  googleServicesFile: './google-services.json',
},
```

**Step 3: Create `rider/lib/notifications.ts`**

```typescript
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Configure how notifications appear while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Requests permission and registers the Expo push token with the backend.
 * Call once on app start (after the user is signed in).
 * Safe to call multiple times — silently no-ops if permission is denied.
 */
export async function registerPushToken(accessToken: string): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[push] notification permission denied');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] EAS projectId not configured — skipping push token registration');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await fetch(`${API_URL}/api/riders/push-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    // Never throw — push token registration is best-effort.
    console.warn('[push] token registration failed:', err);
  }
}
```

**Step 4: Create `driver/lib/notifications.ts`** (same structure, different endpoint)

```typescript
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export async function registerPushToken(accessToken: string): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[push] notification permission denied');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] EAS projectId not configured — skipping push token registration');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await fetch(`${API_URL}/api/drivers/push-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn('[push] token registration failed:', err);
  }
}
```

**Step 5: Add EAS projectId to driver app.config.js**

The driver `app.config.js` currently has no `extra.eas.projectId`. Add it — get the projectId from `eas.json` or `expo.dev`:

```javascript
extra: {
  eas: {
    projectId: 'YOUR_DRIVER_EAS_PROJECT_ID',  // from expo.dev or eas.json
  },
},
```

**Step 6: Call `registerPushToken` in rider `_layout.tsx` after session is confirmed**

In `rider/app/_layout.tsx`, import `registerPushToken` and call it when `session` becomes non-null:

```typescript
import { registerPushToken } from '../lib/notifications';

// Inside the root layout component, add a useEffect:
useEffect(() => {
  if (!session?.access_token) return;
  registerPushToken(session.access_token);
}, [session?.access_token]);
```

**Step 7: Call `registerPushToken` in driver `app/(app)/_layout.tsx` (tab layout)**

Same pattern — import and call when session is available:

```typescript
import { registerPushToken } from '../../lib/notifications';

useEffect(() => {
  if (!session?.access_token) return;
  registerPushToken(session.access_token);
}, [session?.access_token]);
```

**Step 8: Verify no TypeScript errors**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/rider && npx tsc --noEmit
cd /Users/radalzubi/Desktop/WASELMVP/driver && npx tsc --noEmit
```

**Step 9: Commit**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
git add rider/ driver/
git commit -m "feat(apps): add expo-notifications — push token registration for rider and driver on app start"
```

---

## Phase 3 — Background Location for Drivers

### Task 6: Driver Background GPS

**Why critical:** iOS stops location updates the moment the screen locks unless background mode is configured. A driver puts their phone in a cup holder and their location freezes on the rider's map within 30 seconds.

**Files:**
- Modify: `driver/app.config.js` (add background location plugin config + UIBackgroundModes)
- Modify: `driver/app/(app)/dashboard.tsx` (switch to `Background` accuracy mode + request background permission)

---

**Step 1: Update `driver/app.config.js` for background location**

Replace the existing `expo-location` plugin entry:

```javascript
[
  'expo-location',
  {
    // iOS — must explicitly request "Always" permission for background location.
    locationAlwaysAndWhenInUsePermission:
      'Wasel needs your location in the background to show riders your position while driving.',
    locationWhenInUsePermission:
      'Wasel needs your location to show you nearby trips.',
    // Android — declares the foreground service for background location.
    isAndroidForegroundServiceEnabled: true,
    isAndroidBackgroundLocationEnabled: true,
    androidForegroundServiceNotificationTitle: 'Wasel — Active',
    androidForegroundServiceNotificationBody:  'Location is being shared with riders.',
  },
],
```

Also add `UIBackgroundModes` for iOS (in the `ios` section):

```javascript
ios: {
  bundleIdentifier: 'com.wasel.driver',
  supportsTablet: false,
  infoPlist: {
    UIBackgroundModes: ['location', 'fetch'],
  },
  config: {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
},
```

**Step 2: Update `driver/app/(app)/dashboard.tsx` — request background permission**

Add a permission request at the point where `toggleOnline(true)` is called (before starting the location subscription). Replace the existing `watchPositionAsync` setup block with:

```typescript
// In the useEffect that starts location tracking when isOnline becomes true:
useEffect(() => {
  if (!isOnline) return;

  let subscription: Location.LocationSubscription | null = null;
  let cancelled = false;

  (async () => {
    // Request foreground permission first (required before background).
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      console.warn('[location] foreground permission denied');
      return;
    }

    // Request background permission (iOS "Always Allow", Android foreground service).
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      console.warn('[location] background permission denied — location will pause when screen locks');
      // Don't abort — continue with foreground-only location.
    }

    if (cancelled) return;

    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10_000,
        distanceInterval: 30,
      },
      async (loc) => {
        if (cancelled) return;
        const { latitude: lat, longitude: lng } = loc.coords;
        setLocation({ latitude: lat, longitude: lng });

        try {
          const session = await supabase.auth.getSession();
          const token = session.data.session?.access_token;
          if (!token) return;
          await fetch(`${API_URL}/api/drivers/location`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ lat, lng }),
          });
        } catch (err) {
          console.warn('[location] PATCH failed:', err);
        }
      },
    );
  })();

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}, [isOnline]);
```

**Step 3: Add Android notification channel for location foreground service**

In `dashboard.tsx`, in the component init `useEffect` (runs once on mount), add:

```typescript
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// In component useEffect([]):
useEffect(() => {
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('wasel-trips', {
      name: 'Wasel Trip Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
    Notifications.setNotificationChannelAsync('wasel-location', {
      name: 'Wasel Location Tracking',
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
    });
  }
}, []);
```

**Step 4: Commit**

```bash
git add driver/app.config.js driver/app/\(app\)/dashboard.tsx
git commit -m "feat(driver): background location — iOS Always permission + Android foreground service config"
```

---

## Phase 4 — Google Maps & Dark Mode Map

### Task 7: Configure Google Maps API Key + Dark Mode Map Tiles

**What it fixes:** Standalone builds have a broken map because `GOOGLE_MAPS_API_KEY` is missing from `.env`. Dark mode map tiles match the app's dark UI theme.

**Files:**
- Modify: `rider/.env` and `driver/.env` (add key)
- Create: `rider/lib/mapStyle.ts` and `driver/lib/mapStyle.ts`
- Modify: `rider/app/(app)/home.tsx` (apply dark style + fix duplicate `showsUserLocation` note)
- Modify: `driver/app/(app)/dashboard.tsx` (apply dark style + remove duplicate location indicator)

---

**Step 1: Add Google Maps API key to both `.env` files**

> **Manual prerequisite:** Get a Google Maps API key from [Google Cloud Console](https://console.cloud.google.com). Enable these APIs: Maps SDK for iOS, Maps SDK for Android, Directions API, Places API (Nearby Search).
>
> **Key restrictions:** Restrict the key to the two app bundle IDs (`com.wasel.rider`, `com.wasel.driver`) to prevent unauthorized use.

Add to `rider/.env`:
```
GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
```

Add to `driver/.env`:
```
GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
```

**Step 2: Create `rider/lib/mapStyle.ts`**

```typescript
// Dark mode map style for react-native-maps.
// Generated from Google Maps Styling Wizard, customized for Wasel's #0A0A0A background.
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#333333' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'poi.park', elementType: 'labels.text.stroke', stylers: [{ color: '#1b1b1b' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c3c' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#4e4e4e' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d3d3d' }] },
];
```

Copy the same file to `driver/lib/mapStyle.ts`.

**Step 3: Apply dark style in `rider/app/(app)/home.tsx`**

Import:
```typescript
import { DARK_MAP_STYLE } from '../../lib/mapStyle';
```

Add `customMapStyle` prop to the `<MapView>`:
```tsx
<MapView
  // ... existing props ...
  customMapStyle={DARK_MAP_STYLE}
/>
```

**Step 4: Apply dark style + fix duplicate location indicator in `driver/app/(app)/dashboard.tsx`**

Import:
```typescript
import { DARK_MAP_STYLE } from '../../lib/mapStyle';
```

Add `customMapStyle` to the `<MapView>` and remove `showsUserLocation={true}` (the custom orange dot marker already shows the driver's location — having both creates a confusing double indicator):

```tsx
<MapView
  // ... existing props ...
  showsUserLocation={false}   // Remove the built-in blue dot; custom marker is used instead.
  customMapStyle={DARK_MAP_STYLE}
/>
```

**Step 5: Commit**

```bash
git add rider/lib/mapStyle.ts driver/lib/mapStyle.ts rider/app/\(app\)/home.tsx driver/app/\(app\)/dashboard.tsx rider/.env driver/.env
git commit -m "feat(maps): dark mode map tiles + fix duplicate driver location indicator"
```

---

## Phase 5 — Driver Self-Registration

### Task 8: Driver Onboarding Flow

**Context:** Currently drivers must be manually inserted into the DB. There is no `POST /api/drivers` endpoint and the OTP verify route returns 403 if no driver row exists. This must be solved for any driver to use the app without manual admin intervention.

**Design choice for MVP:** A lightweight two-step onboarding. After the driver verifies their OTP, if they don't have a profile row the backend returns a new status `{ status: 'pending_registration' }` instead of 403. The driver app catches this and routes to a registration screen where they enter name + vehicle info. The backend creates the profile and marks the driver as `is_approved: false`. An admin must flip `is_approved: true` to let them go online. This preserves safety (no unvetted driver takes trips) while eliminating the manual DB insert.

**Files:**
- Modify: `backend/supabase/migrations/` → create `011_driver_approval.sql`
- Modify: `backend/src/routes/auth.ts` (return `pending_registration` instead of 403)
- Create: `backend/src/routes/drivers.ts` → add `POST /api/drivers/register` endpoint
- Create: `driver/app/(auth)/register.tsx` (name + vehicle form)
- Modify: `driver/app/(auth)/verify.tsx` (handle `pending_registration` response)
- Modify: `driver/app/(app)/dashboard.tsx` (block going online if not approved)

---

**Step 1: Create migration `011_driver_approval.sql`**

```sql
-- Migration 011: Driver approval gate
-- Adds is_approved column so admins can vet drivers before they go live.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- Existing drivers who were manually inserted are considered approved.
UPDATE drivers SET is_approved = true WHERE is_approved = false;

-- Add RLS: allow driver to read their own is_approved field (already in self-read policy).
-- No additional policy needed — existing drivers_self_read covers all columns.
```

Run in Supabase SQL Editor.

**Step 2: Modify `backend/src/routes/auth.ts` verify endpoint**

Find the section in the `POST /api/auth/verify` handler where it returns 403 for drivers without a profile:

```typescript
// Change FROM:
if (!existingDriver) return res.status(403).json({ error: 'Driver account not found. Contact support.' });

// Change TO:
if (!existingDriver) {
  return res.status(200).json({ status: 'pending_registration', session });
  // The driver app will route to the registration screen when it sees this status.
}
```

**Step 3: Add `POST /api/drivers/register` endpoint in `drivers.ts`**

```typescript
const RegisterSchema = z.object({
  name:          z.string().min(2).max(80),
  vehicle_make:  z.string().min(1).max(40),
  vehicle_model: z.string().min(1).max(40),
  vehicle_plate: z.string().min(2).max(20),
});

// POST /api/drivers/register — first-time driver profile creation.
// Called after OTP verify returns { status: 'pending_registration' }.
// The driver is created with is_approved=false; admin must approve before they go online.
router.post('/register', requireAuth, async (req: AuthRequest, res) => {
  // Only allow if no driver row exists yet (prevent overwriting an approved profile).
  const { data: existing } = await supabase
    .from('drivers')
    .select('id')
    .eq('id', req.userId)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Driver profile already exists' });

  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data: session } = await supabase.auth.admin.getUserById(req.userId);
  const phone = session?.user?.phone ?? '';

  const { error } = await supabase.from('drivers').insert({
    id:            req.userId,
    phone,
    name:          parsed.data.name,
    vehicle_make:  parsed.data.vehicle_make,
    vehicle_model: parsed.data.vehicle_model,
    vehicle_plate: parsed.data.vehicle_plate,
    is_approved:   false,
    is_online:     false,
    is_available:  false,
  });

  if (error) return res.status(500).json({ error: 'Failed to create driver profile' });
  res.status(201).json({ ok: true, status: 'pending_approval' });
});
```

**Step 4: Create `driver/app/(auth)/register.tsx`**

```tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !make.trim() || !model.trim() || !plate.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');

      const res = await fetch(`${API_URL}/api/drivers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          vehicle_make: make.trim(),
          vehicle_model: model.trim(),
          vehicle_plate: plate.trim().toUpperCase(),
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // Navigate to a "pending approval" screen.
      router.replace('/(auth)/pending' as any);
    } catch (e: unknown) {
      Alert.alert('Registration failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>Complete Your Profile</Text>
          <Text style={s.sub}>Enter your details to register as a Wasel driver.</Text>

          <Text style={s.label}>Full name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Ahmad Al-Khalidi" placeholderTextColor="#444" autoCapitalize="words" />

          <Text style={s.label}>Vehicle make</Text>
          <TextInput style={s.input} value={make} onChangeText={setMake} placeholder="e.g. Toyota" placeholderTextColor="#444" autoCapitalize="words" />

          <Text style={s.label}>Vehicle model</Text>
          <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="e.g. Corolla" placeholderTextColor="#444" autoCapitalize="words" />

          <Text style={s.label}>Plate number</Text>
          <TextInput style={s.input} value={plate} onChangeText={setPlate} placeholder="e.g. 12-34-ABC" placeholderTextColor="#444" autoCapitalize="characters" />

          <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleSubmit} disabled={loading}>
            <Text style={s.btnTxt}>{loading ? 'Submitting…' : 'Submit Application'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#0A0A0A' },
  scroll:      { padding: 24, paddingBottom: 48 },
  title:       { fontSize: 26, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  sub:         { fontSize: 14, color: '#666', marginBottom: 32, lineHeight: 20 },
  label:       { fontSize: 13, color: '#888', fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 12, padding: 14, color: '#FFF', fontSize: 16,
    marginBottom: 20,
  },
  btn: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt:      { color: '#000', fontSize: 16, fontWeight: '700' },
});
```

**Step 5: Create `driver/app/(auth)/pending.tsx`** (approval waiting screen)

```tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';

export default function PendingApprovalScreen() {
  const { signOut } = useAuth();
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <View style={s.icon}><Ionicons name="time-outline" size={48} color="#F5A623" /></View>
        <Text style={s.title}>Application Submitted</Text>
        <Text style={s.body}>
          Your driver application is under review. You'll receive a notification
          once approved — typically within 24 hours.
        </Text>
        <TouchableOpacity onPress={signOut} style={s.link}>
          <Text style={s.linkTxt}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon:   { marginBottom: 24 },
  title:  { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12, textAlign: 'center' },
  body:   { fontSize: 15, color: '#666', lineHeight: 24, textAlign: 'center', marginBottom: 32 },
  link:   { padding: 12 },
  linkTxt:{ color: '#F5A623', fontWeight: '600', fontSize: 15 },
});
```

**Step 6: Handle `pending_registration` in `driver/app/(auth)/verify.tsx`**

After the `POST /api/auth/verify` call succeeds and the session is set, check for `pending_registration`:

```typescript
if (data.status === 'pending_registration') {
  // Session is set, driver needs to complete their profile.
  router.replace('/(auth)/register' as any);
  return;
}
```

**Step 7: Block unapproved drivers from going online in `dashboard.tsx`**

In the `GET /api/drivers/me` profile fetch that runs on mount, check `is_approved`:

```typescript
if (!data.is_approved) {
  // Show an info banner rather than crashing — they can still see the UI.
  setIsApproved(false);
} else {
  setIsApproved(true);
}
```

Add `isApproved` state and gate the "Go Online" toggle behind it:

```typescript
const [isApproved, setIsApproved] = useState(true); // optimistic until profile loads

// In the online toggle button:
disabled={!isApproved}
// When disabled, show a tooltip: "Your account is pending approval"
```

**Step 8: Commit**

```bash
git add backend/supabase/migrations/011_driver_approval.sql \
  backend/src/routes/auth.ts backend/src/routes/drivers.ts \
  driver/app/\(auth\)/register.tsx driver/app/\(auth\)/pending.tsx \
  driver/app/\(auth\)/verify.tsx driver/app/\(app\)/dashboard.tsx
git commit -m "feat: driver self-registration flow — profile form, pending approval gate, admin is_approved flag"
```

---

## Phase 6 — Trip History & Earnings

### Task 9: Backend Trip History Endpoints

**What it builds:** `GET /api/riders/trips` (last 20 completed trips for rider) and `GET /api/drivers/trips` (last 20 completed trips for driver with total earnings).

**Files:**
- Modify: `backend/src/routes/riders.ts`
- Modify: `backend/src/routes/drivers.ts`

---

**Step 1: Add `GET /api/riders/trips` to riders.ts**

```typescript
// GET /api/riders/trips — last 20 completed/cancelled trips for the rider
router.get('/trips', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('trips')
    .select(`
      id, status, pickup_address, dropoff_address,
      fare_amount, created_at, completed_at, driver_rating,
      driver:driver_id (name, vehicle_make, vehicle_model)
    `)
    .eq('rider_id', req.userId)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Failed to fetch trips' });
  res.json(data ?? []);
});
```

**Step 2: Add `GET /api/drivers/trips` to drivers.ts**

```typescript
// GET /api/drivers/trips — last 20 completed trips + earnings summary
router.get('/trips', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('trips')
    .select(`
      id, status, pickup_address, dropoff_address,
      fare_amount, created_at, completed_at, rider_rating
    `)
    .eq('driver_id', req.userId)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Failed to fetch trips' });

  const trips = data ?? [];
  const completed = trips.filter(t => t.status === 'completed');
  const totalEarnings = completed.reduce((sum, t) => sum + (t.fare_amount ?? 0), 0);
  const todayEarnings = completed
    .filter(t => t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString())
    .reduce((sum, t) => sum + (t.fare_amount ?? 0), 0);

  res.json({
    trips,
    summary: {
      total_trips: completed.length,
      total_earnings_jd: Number(totalEarnings.toFixed(2)),
      today_earnings_jd: Number(todayEarnings.toFixed(2)),
    },
  });
});
```

**Step 3: Commit**

```bash
git add backend/src/routes/riders.ts backend/src/routes/drivers.ts
git commit -m "feat(backend): trip history endpoints — GET /api/riders/trips + GET /api/drivers/trips with earnings summary"
```

---

### Task 10: Trip History Screens (Rider + Driver)

**Files:**
- Create: `rider/app/(app)/trips.tsx`
- Create: `driver/app/(app)/earnings.tsx`
- Modify: `rider/app/(app)/_layout.tsx` (add Trips tab)
- Modify: `driver/app/(app)/_layout.tsx` (add Earnings tab)

---

**Step 1: Create `rider/app/(app)/trips.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface TripRecord {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  created_at: string;
  driver_rating: number | null;
  driver: { name: string; vehicle_make: string; vehicle_model: string } | null;
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'completed' ? '#4CAF50' : '#FF5252';
  return (
    <View style={[pill.wrap, { borderColor: color }]}>
      <Text style={[pill.txt, { color }]}>{status}</Text>
    </View>
  );
}
const pill = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  txt:  { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
});

export default function TripsScreen() {
  const { t } = useLanguage();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`${API_URL}/api/riders/trips`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TripRecord[] = await res.json();
      setTrips(data);
    } catch {
      // Silent — stale data is fine
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(true), []);

  function renderItem({ item }: { item: TripRecord }) {
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <View style={s.card}>
        <View style={s.cardTop}>
          <Text style={s.date}>{date}</Text>
          <StatusPill status={item.status} />
        </View>
        <View style={s.route}>
          <View style={s.routeDot} />
          <Text style={s.addr} numberOfLines={1}>{item.pickup_address || 'Pickup'}</Text>
        </View>
        <View style={s.route}>
          <View style={[s.routeDot, { backgroundColor: '#4CAF50' }]} />
          <Text style={s.addr} numberOfLines={1}>{item.dropoff_address || 'Dropoff'}</Text>
        </View>
        <View style={s.cardBottom}>
          {item.driver ? (
            <Text style={s.driver}>{item.driver.name} · {item.driver.vehicle_make} {item.driver.vehicle_model}</Text>
          ) : null}
          {item.fare_amount != null ? (
            <Text style={s.fare}>{item.fare_amount.toFixed(2)} JD</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A0A0A' }}>
        <View style={s.header}>
          <Text style={s.headerTitle}>My Trips</Text>
        </View>
      </SafeAreaView>
      {loading ? (
        <View style={s.center}><ActivityIndicator color="#F5A623" size="large" /></View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F5A623" colors={['#F5A623']} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="car-outline" size={40} color="#333" />
              <Text style={s.emptyTxt}>No trips yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0A0A0A' },
  header:      { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  date:       { fontSize: 12, color: '#666' },
  route:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  routeDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5A623' },
  addr:       { flex: 1, fontSize: 13, color: '#CCC' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  driver:     { fontSize: 12, color: '#666', flex: 1 },
  fare:       { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  empty:      { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt:   { color: '#444', fontSize: 15 },
});
```

**Step 2: Create `driver/app/(app)/earnings.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface TripRecord {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  created_at: string;
  rider_rating: number | null;
}

interface Summary {
  total_trips: number;
  total_earnings_jd: number;
  today_earnings_jd: number;
}

export default function EarningsScreen() {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`${API_URL}/api/drivers/trips`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTrips(data.trips ?? []);
      setSummary(data.summary ?? null);
    } catch {
      // Silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(true), []);

  function renderItem({ item }: { item: TripRecord }) {
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
    const time = new Date(item.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
    return (
      <View style={s.card}>
        <View style={s.cardLeft}>
          <Text style={s.dateTime}>{date} · {time}</Text>
          <Text style={s.addr} numberOfLines={1}>{item.pickup_address || 'Pickup'}</Text>
          <Text style={s.addrTo} numberOfLines={1}>→ {item.dropoff_address || 'Dropoff'}</Text>
        </View>
        <Text style={s.fare}>
          {item.fare_amount != null ? `${item.fare_amount.toFixed(2)} JD` : '—'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A0A0A' }}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Earnings</Text>
        </View>
        {summary && (
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{summary.today_earnings_jd.toFixed(2)} JD</Text>
              <Text style={s.summaryLbl}>Today</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{summary.total_earnings_jd.toFixed(2)} JD</Text>
              <Text style={s.summaryLbl}>All time</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{summary.total_trips}</Text>
              <Text style={s.summaryLbl}>Trips</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
      {loading ? (
        <View style={s.center}><ActivityIndicator color="#F5A623" size="large" /></View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F5A623" colors={['#F5A623']} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="wallet-outline" size={40} color="#333" />
              <Text style={s.emptyTxt}>No completed trips yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0A0A0A' },
  header:      { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },
  summaryRow:  { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: '#111', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#1E1E1E', alignItems: 'center',
  },
  summaryVal:  { fontSize: 18, fontWeight: '700', color: '#F5A623' },
  summaryLbl:  { fontSize: 11, color: '#666', marginTop: 2 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardLeft: { flex: 1, marginRight: 12 },
  dateTime: { fontSize: 11, color: '#555', marginBottom: 4 },
  addr:     { fontSize: 13, color: '#CCC', fontWeight: '500' },
  addrTo:   { fontSize: 12, color: '#555', marginTop: 2 },
  fare:     { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  empty:    { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt: { color: '#444', fontSize: 15 },
});
```

**Step 3: Add Trips tab to rider `app/(app)/_layout.tsx`**

Read the current file and add a new `<Tabs.Screen>` for the trips screen:

```tsx
<Tabs.Screen
  name="trips"
  options={{
    title: 'Trips',
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="time-outline" size={size} color={color} />
    ),
  }}
/>
```

**Step 4: Add Earnings tab to driver `app/(app)/_layout.tsx`**

Add a new `<Tabs.Screen>` for earnings:

```tsx
<Tabs.Screen
  name="earnings"
  options={{
    title: 'Earnings',
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>
```

**Step 5: Commit**

```bash
git add rider/app/\(app\)/trips.tsx driver/app/\(app\)/earnings.tsx \
  rider/app/\(app\)/_layout.tsx driver/app/\(app\)/_layout.tsx \
  backend/src/routes/riders.ts backend/src/routes/drivers.ts
git commit -m "feat: trip history screen (rider) + earnings screen (driver) with summary stats"
```

---

## Phase 7 — Navigation & Routing

### Task 11: "Navigate to Pickup" Button for Drivers

**What it builds:** A "Navigate" button in the driver dashboard during `accepted` and `en_route` states that deep-links to Google Maps / Apple Maps with the pickup address as the destination.

**Files:**
- Modify: `driver/app/(app)/dashboard.tsx`

---

**Step 1: Add `openNavigation` helper in dashboard.tsx**

```typescript
import { Linking, Platform, Alert } from 'react-native';

function openNavigation(lat: number, lng: number, address?: string | null) {
  const label = encodeURIComponent(address ?? 'Pickup');
  const googleUrl = Platform.OS === 'ios'
    ? `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`
    : `google.navigation:q=${lat},${lng}`;
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const appleUrl = `maps://?daddr=${lat},${lng}`;

  if (Platform.OS === 'ios') {
    // Try Google Maps, fall back to Apple Maps.
    Linking.canOpenURL(googleUrl)
      .then(can => Linking.openURL(can ? googleUrl : appleUrl))
      .catch(() => Linking.openURL(fallbackUrl));
  } else {
    Linking.openURL(googleUrl).catch(() => Linking.openURL(fallbackUrl));
  }
}
```

**Step 2: Add the Navigate button to the trip action panel**

In the driver dashboard, find where `TRIP_ACTIONS[currentTrip?.status]` renders the action button. Add a "Navigate" button alongside it, shown only during `accepted` and `en_route` states:

```tsx
{currentTrip && ['accepted', 'en_route'].includes(currentTrip.status) && tripDetails && (
  <TouchableOpacity
    style={[s.actionBtn, s.navBtn]}
    onPress={() => openNavigation(
      tripDetails.pickup_lat,
      tripDetails.pickup_lng,
      tripDetails.pickup_address,
    )}
    activeOpacity={0.8}
  >
    <Ionicons name="navigate-outline" size={18} color="#000" />
    <Text style={s.navBtnTxt}>Navigate</Text>
  </TouchableOpacity>
)}
```

Add styles:

```typescript
navBtn:    { backgroundColor: '#F5A623', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
navBtnTxt: { color: '#000', fontWeight: '700', fontSize: 15 },
```

**Step 3: Commit**

```bash
git add driver/app/\(app\)/dashboard.tsx
git commit -m "feat(driver): Navigate to Pickup button — deep-links to Google Maps/Apple Maps during en_route"
```

---

### Task 12: Fare Estimate Endpoint + Real Route Polyline

**What it builds:** A server-side `GET /api/trips/estimate` endpoint that calls the Google Directions API to return authoritative fare, distance, duration, and the encoded polyline. The rider app uses this to show a real route preview on the map instead of a straight line.

**Files:**
- Create: `backend/src/routes/estimate.ts`
- Modify: `backend/src/index.ts` (mount new route)
- Modify: `rider/app/(app)/home.tsx` (fetch estimate on destination confirm, render real polyline)

---

**Step 1: Create `backend/src/routes/estimate.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

const EstimateQuerySchema = z.object({
  pickup_lat:  z.coerce.number().min(-90).max(90),
  pickup_lng:  z.coerce.number().min(-180).max(180),
  dropoff_lat: z.coerce.number().min(-90).max(90),
  dropoff_lng: z.coerce.number().min(-180).max(180),
});

// GET /api/trips/estimate — returns fare, distance, duration, and encoded polyline.
// No auth required — public endpoint so the rider can preview before booking.
router.get('/', async (req, res) => {
  const parsed = EstimateQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = parsed.data;

  const key = process.env.GOOGLE_DIRECTIONS_API_KEY;
  if (!key) {
    // Graceful fallback: compute haversine distance and return straight-line polyline.
    const R = 6371;
    const dLat = ((dropoff_lat - pickup_lat) * Math.PI) / 180;
    const dLng = ((dropoff_lng - pickup_lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((pickup_lat * Math.PI) / 180) *
      Math.cos((dropoff_lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const fare = Math.max(1.5, 0.5 + distKm * 0.35);
    return res.json({
      fare_jd:      Number(fare.toFixed(2)),
      distance_km:  Number(distKm.toFixed(1)),
      duration_min: Math.max(1, Math.round(distKm / 25 * 60)),
      polyline:     null, // no real polyline without key
      source:       'haversine',
    });
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${pickup_lat},${pickup_lng}`);
    url.searchParams.set('destination', `${dropoff_lat},${dropoff_lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', key);

    const gRes = await fetch(url.toString());
    if (!gRes.ok) throw new Error(`Directions API HTTP ${gRes.status}`);
    const gData = await gRes.json();

    if (gData.status !== 'OK' || !gData.routes?.length) {
      throw new Error(`Directions API status: ${gData.status}`);
    }

    const leg = gData.routes[0].legs[0];
    const distKm = leg.distance.value / 1000;
    const durationMin = Math.ceil(leg.duration.value / 60);
    const fare = Math.max(1.5, 0.5 + distKm * 0.35);
    const polyline = gData.routes[0].overview_polyline.points;

    res.json({
      fare_jd:      Number(fare.toFixed(2)),
      distance_km:  Number(distKm.toFixed(1)),
      duration_min: durationMin,
      polyline,
      source:       'directions',
    });
  } catch (err) {
    console.error('[estimate] Directions API error:', err);
    res.status(502).json({ error: 'Failed to get route estimate' });
  }
});

export default router;
```

**Step 2: Mount the estimate route in `backend/src/index.ts`**

Add before the trips route mount:

```typescript
import estimateRouter from './routes/estimate';
// ...
app.use('/api/trips/estimate', estimateRouter);
```

Note: Must be mounted BEFORE `/api/trips` to avoid the `/:id` wildcard catching `/estimate`.

**Step 3: Add `GOOGLE_DIRECTIONS_API_KEY` env var to backend**

In Railway: add `GOOGLE_DIRECTIONS_API_KEY=<your-key>`.

In `backend/.env.example`:
```
GOOGLE_DIRECTIONS_API_KEY=       # Google Directions API key (optional — falls back to haversine)
```

**Step 4: Update `rider/app/(app)/home.tsx` to fetch estimate and render real polyline**

Add a new state variable:
```typescript
const [routePolyline, setRoutePolyline] = useState<string | null>(null);
```

Replace the existing client-side fare calculation block (runs when `dropoffCoords` is confirmed) with a server call:

```typescript
async function fetchEstimate(pickupLat: number, pickupLng: number, dropLat: number, dropLng: number) {
  try {
    const url = `${API_URL}/api/trips/estimate?pickup_lat=${pickupLat}&pickup_lng=${pickupLng}&dropoff_lat=${dropLat}&dropoff_lng=${dropLng}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setFare(data.fare_jd);
    setRoutePolyline(data.polyline ?? null);
  } catch {
    // Fallback: client-side haversine (existing formula)
    const dist = haversineKm(/* pickup */, /* dropoff */);
    setFare(Math.max(1.5, 0.5 + dist * 0.35));
    setRoutePolyline(null);
  }
}
```

Call `fetchEstimate(userLocation.latitude, userLocation.longitude, dropoffCoords.latitude, dropoffCoords.longitude)` when `dropoffCoords` is set.

To decode the Google encoded polyline in React Native, install `@mapbox/polyline`:

```bash
cd /Users/radalzubi/Desktop/WASELMVP/rider
npx expo install @mapbox/polyline
```

In home.tsx, decode the polyline for the map:

```typescript
import Polyline from '@mapbox/polyline';

// In renderMap:
const routeCoords = routePolyline
  ? Polyline.decode(routePolyline).map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
  : null;
```

Replace the straight-line `<Polyline>` for the route preview with a real road-following polyline when available:

```tsx
{routeCoords && searchMode === 'confirmed' && (
  <Polyline
    coordinates={routeCoords}
    strokeColor="#F5A623"
    strokeWidth={3}
  />
)}
{!routeCoords && /* existing straight-line fallback */ }
```

**Step 5: Commit**

```bash
git add backend/src/routes/estimate.ts backend/src/index.ts \
  rider/app/\(app\)/home.tsx rider/package.json rider/package-lock.json
git commit -m "feat: fare estimate endpoint (Directions API with haversine fallback) + real route polyline in rider app"
```

---

## Phase 8 — Production Hardening

### Task 13: Production Environment Hardening

**What it fixes:** The live backend has `NODE_ENV=development`, enabling the test OTP bypass for anyone who reads the code. CORS origins are unset (warning in logs). No security audit trail.

**Files:**
- Modify: Railway environment variables (manual, not in code)
- Modify: `backend/.env.example` (document all required vars)
- Modify: `rider/app/(auth)/login.tsx` + `rider/app/(auth)/verify.tsx` (gate dev bypass on `__DEV__` AND a runtime flag)
- Modify: `driver/app/(auth)/login.tsx` + `driver/app/(auth)/verify.tsx` (same)

---

**Step 1: Update Railway environment variables**

In [Railway Dashboard](https://railway.app) → wasel-mvp-production service → Variables, set:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://wasel.jo,exp+wasel-rider://,exp+wasel-driver://` |
| `TEST_BYPASS_ENABLED` | `false` |
| `EXPO_ACCESS_TOKEN` | `<your expo access token from expo.dev>` |
| `GOOGLE_DIRECTIONS_API_KEY` | `<your Directions API key>` |

The `NODE_ENV=production` change **immediately disables** `POST /api/auth/dev-login` (line in auth.ts: `if (process.env.NODE_ENV !== 'development') return res.status(404)...`).

**Step 2: Add dev UI bypass guard in both apps**

The dev button pre-fill is already gated on `__DEV__` in both apps, which means it only appears in development builds (not in EAS preview/production). This is correct. No code change needed — just confirm it.

Verify in `rider/app/(auth)/login.tsx`:
```tsx
{__DEV__ && (
  <TouchableOpacity onPress={() => setPhone('+962790000001')}>
    <Text>DEV: Use test phone</Text>
  </TouchableOpacity>
)}
```

If the `__DEV__` check is missing and the button is unconditional, add it now.

**Step 3: Fix `waitlist-success.tsx` dead ends in both apps**

Both `rider/app/waitlist-success.tsx` and `driver/app/waitlist-success.tsx` have no navigation buttons. Add a "Go to Login" link:

In rider:
```tsx
<TouchableOpacity
  style={{ marginTop: 24 }}
  onPress={() => router.replace('/(auth)/login')}
>
  <Text style={{ color: '#F5A623', fontWeight: '600', fontSize: 15 }}>
    Already have an account? Sign in
  </Text>
</TouchableOpacity>
```

Same in driver.

**Step 4: Delete the dead `App.tsx` stub in rider**

```bash
rm /Users/radalzubi/Desktop/WASELMVP/rider/App.tsx
```

This is the default Expo template file — it is never used (the entry point is `index.ts` → `expo-router`). Leaving it causes confusion.

**Step 5: Update `backend/.env.example` with all required variables**

```
# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=production                     # Set to 'production' on Railway
ALLOWED_ORIGINS=https://wasel.jo        # Comma-separated list of allowed origins
WAITLIST_MODE=false                     # Set to 'true' to block operational endpoints

# ── Security (dev only) ───────────────────────────────────────────────────────
TEST_BYPASS_ENABLED=false               # NEVER set to true in production
DEV_TEST_PASSWORD=change-me-dev-password         # Dev account password — irrelevant in production

# ── External APIs ─────────────────────────────────────────────────────────────
GOOGLE_PLACES_API_KEY=                  # Optional: powers Explore tab with live data
GOOGLE_DIRECTIONS_API_KEY=              # Optional: powers fare estimate + route polyline

# ── Push Notifications ────────────────────────────────────────────────────────
EXPO_ACCESS_TOKEN=                      # From expo.dev/accounts/.../access-tokens
                                        # Required to send push notifications via Expo
```

**Step 6: Commit**

```bash
git add backend/.env.example \
  rider/app/waitlist-success.tsx driver/app/waitlist-success.tsx \
  rider/app/\(auth\)/login.tsx rider/app/\(auth\)/verify.tsx \
  driver/app/\(auth\)/login.tsx driver/app/\(auth\)/verify.tsx
# Remove App.tsx from tracking if it's still committed:
git rm --cached rider/App.tsx 2>/dev/null || true
git commit -m "fix(prod): remove dead App.tsx stub, fix waitlist-success dead ends, document all env vars"
```

---

## Verification Checklist (End-to-End)

After completing all tasks, test the full flow:

### Rider App
- [ ] App starts, map renders with dark tiles
- [ ] Phone OTP sign-in works (real Supabase SMS)
- [ ] Searching a destination returns autocomplete results
- [ ] Confirming a destination shows fare estimate and route polyline
- [ ] Tapping "Request Wasel" creates a trip (verify in Supabase: `trips` table row appears with valid status)
- [ ] Dispatch creates a `trip_offers` row for the correct driver
- [ ] Push notification arrives on driver's device within 5 seconds (even with phone locked)
- [ ] After driver accepts, rider sees driver name/vehicle/ETA
- [ ] Driver location updates every ~10 seconds on rider's map
- [ ] Tapping "Call Driver" opens phone dialer
- [ ] Driver completing trip shows rating modal
- [ ] Trips tab shows the completed trip
- [ ] Sign-out clears state and returns to login

### Driver App
- [ ] App starts, driver logs in, profile shows vehicle info
- [ ] Tapping "Go Online" changes status and requests location permission
- [ ] With app backgrounded (screen locked), driver location still updates (check Supabase `drivers.location_lat` changes)
- [ ] When a ride is dispatched, push notification arrives on locked device with 15-second countdown
- [ ] Tapping notification opens the accept modal
- [ ] Accepting a ride shows pickup pin on map
- [ ] "Navigate" button opens Google Maps / Apple Maps with correct destination
- [ ] Status advance: Start Drive → I've Arrived → Start Trip → Complete Trip works
- [ ] Earnings screen shows the completed trip and updated total
- [ ] Sign-out works cleanly

### Backend
- [ ] `NODE_ENV=production` in Railway → `/api/auth/dev-login` returns 404
- [ ] `POST /api/trips` with valid auth creates a trip (Supabase row appears)
- [ ] `GET /api/trips/estimate` returns fare + polyline (or haversine fallback)
- [ ] `PATCH /api/drivers/push-token` stores token in `drivers.push_token`

---

## Manual Prerequisites (Do Before Starting Code)

These cannot be automated — they require accounts and external configuration:

1. **Google Cloud Console:** Create API key → enable Maps SDK for iOS, Maps SDK for Android, Directions API, Places API. Restrict to your bundle IDs.
2. **Firebase:** Create two Android apps (`com.wasel.rider`, `com.wasel.driver`) → download `google-services.json` for each → place at `rider/google-services.json` and `driver/google-services.json`.
3. **Apple Developer Portal:** Create APNs `.p8` key → upload to EAS Dashboard (expo.dev) under each app's iOS credentials.
4. **Expo:** Get an `EXPO_ACCESS_TOKEN` from expo.dev → set it in Railway env vars.
5. **Railway:** Set `NODE_ENV=production`, `EXPO_ACCESS_TOKEN`, `GOOGLE_DIRECTIONS_API_KEY`, `ALLOWED_ORIGINS`.
6. **Supabase SQL Editor:** Run migration 010 and 011 before deploying any backend code changes that depend on the new columns.
