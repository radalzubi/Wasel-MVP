# Wasel MVP — Scaffold & Waitlist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold a clean Wasel MVP monorepo with Expo apps (rider + driver), Node/Express backend, Supabase integration, BMP dispatch engine, and a waitlist mode toggle for pre-launch.

**Architecture:** Monorepo at `/Users/radalzubi/Desktop/WASELMVP` with three packages: `backend` (Express+TS), `rider` (Expo), `driver` (Expo). A single `WAITLIST_MODE` env flag switches both apps between waitlist signup and full app. Supabase handles auth (Phone OTP), database (PostgreSQL+PostGIS), and realtime dispatch delivery.

**Tech Stack:** Node.js 20, Express, TypeScript, Supabase, Expo SDK 51, React Native, NativeWind (Tailwind for RN), Zod, React Navigation

---

## Task 1: Init Monorepo & Git

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

**Step 1: Initialize git and root package.json**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
git init
```

```json
// package.json
{
  "name": "wasel-mvp",
  "private": true,
  "workspaces": ["backend", "rider", "driver"],
  "scripts": {
    "backend": "npm run dev --workspace=backend",
    "rider": "npm run start --workspace=rider",
    "driver": "npm run start --workspace=driver"
  }
}
```

**Step 2: Create .gitignore**

```gitignore
# Env
.env
.env.local
*.env
!.env.example

# Node
node_modules/
npm-debug.log*

# Expo
.expo/
dist/
web-build/

# TypeScript
*.tsbuildinfo

# OS
.DS_Store
```

**Step 3: Create .env.example**

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# App
WAITLIST_MODE=true
PORT=3001
```

**Step 4: Initial commit**

```bash
git add .
git commit -m "chore: init monorepo"
```

---

## Task 2: Backend Scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/src/index.ts`
- Create: `backend/src/lib/supabase.ts`
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/.env.example`

**Step 1: Create backend/package.json**

```json
{
  "name": "@wasel/backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.3"
  }
}
```

**Step 2: Create backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create backend/src/index.ts**

```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', waitlistMode: process.env.WAITLIST_MODE === 'true' });
});

// Routes (added in later tasks)
// app.use('/api/auth', authRouter);
// app.use('/api/trips', tripsRouter);
// app.use('/api/drivers', driversRouter);
// app.use('/api/waitlist', waitlistRouter);

app.listen(PORT, () => {
  console.log(`Wasel backend running on port ${PORT}`);
  console.log(`Waitlist mode: ${process.env.WAITLIST_MODE === 'true'}`);
});

export default app;
```

**Step 4: Create backend/src/lib/supabase.ts**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Step 5: Create backend/src/middleware/auth.ts**

```typescript
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: 'rider' | 'driver';
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.userId = user.id;
  next();
}

export function requireDriver(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'driver') return res.status(403).json({ error: 'Driver only' });
  next();
}
```

**Step 6: Install dependencies and verify**

```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend && npm install
```

Expected: `node_modules` created, no errors.

**Step 7: Commit**

```bash
git add backend/
git commit -m "feat: backend scaffold with Express + Supabase"
```

---

## Task 3: Waitlist Backend Route

**Files:**
- Create: `backend/src/routes/waitlist.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create backend/src/routes/waitlist.ts**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const router = Router();

const WaitlistSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().min(1).max(100),
  role: z.enum(['rider', 'driver']),
  city: z.string().optional(),
  vehicle_type: z.string().optional(), // drivers only
  referral_code: z.string().optional(),
});

// POST /api/waitlist
router.post('/', async (req, res) => {
  const parsed = WaitlistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data, error } = await supabase
    .from('waitlist')
    .insert(parsed.data)
    .select('id, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already on waitlist' });
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }

  res.status(201).json({ message: 'Successfully joined waitlist', id: data.id });
});

// GET /api/waitlist/count (admin use)
router.get('/count', async (_req, res) => {
  const { count } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true });

  res.json({ count });
});

export default router;
```

**Step 2: Wire into index.ts**

In `backend/src/index.ts`, uncomment and add:
```typescript
import waitlistRouter from './routes/waitlist';
// ...
app.use('/api/waitlist', waitlistRouter);
```

**Step 3: Commit**

```bash
git add backend/src/routes/waitlist.ts backend/src/index.ts
git commit -m "feat: waitlist API route with phone + role signup"
```

---

## Task 4: Supabase — Waitlist & Core Schema

**Files:**
- Create: `backend/supabase/migrations/001_waitlist.sql`
- Create: `backend/supabase/migrations/002_core_tables.sql`

**Step 1: Create migrations/001_waitlist.sql**

```sql
-- Waitlist table
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text not null,
  role text not null check (role in ('rider', 'driver')),
  city text,
  vehicle_type text,
  referral_code text,
  created_at timestamptz default now()
);

create index waitlist_role_idx on waitlist(role);
create index waitlist_created_at_idx on waitlist(created_at);
```

**Step 2: Create migrations/002_core_tables.sql**

```sql
-- Enable PostGIS
create extension if not exists postgis;

-- Riders
create table if not exists riders (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  name text,
  created_at timestamptz default now()
);

-- Drivers
create table if not exists drivers (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  name text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  is_online boolean default false,
  is_available boolean default true,
  subscription_tier int default 1 check (subscription_tier in (1, 2, 3)), -- 1=Silver 2=Gold 3=Platinum
  activity_score float default 0.5,
  idle_time_minutes int default 0,
  current_location geography(Point, 4326),
  created_at timestamptz default now()
);

-- Trips
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references riders(id),
  driver_id uuid references drivers(id),
  status text not null default 'requested' 
    check (status in ('requested','dispatching','accepted','en_route','arrived','in_progress','completed','cancelled')),
  pickup_location geography(Point, 4326) not null,
  dropoff_location geography(Point, 4326) not null,
  pickup_address text,
  dropoff_address text,
  fare_amount decimal(10,2),
  payment_method text default 'cash' check (payment_method in ('cash', 'cliq')),
  bmp_score float,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Trip offers (realtime dispatch)
create table if not exists trip_offers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  driver_id uuid references drivers(id),
  status text default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz default (now() + interval '15 seconds'),
  created_at timestamptz default now()
);

-- Enable realtime on trip_offers
alter publication supabase_realtime add table trip_offers;

-- Subscriptions
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references drivers(id),
  tier int not null check (tier in (1, 2, 3)),
  started_at timestamptz default now(),
  expires_at timestamptz not null,
  amount_jd decimal(10,2)
);
```

**Step 3: Apply migrations in Supabase dashboard**

Go to Supabase → SQL Editor → run each migration file in order.

**Step 4: Commit**

```bash
git add backend/supabase/
git commit -m "feat: supabase schema — waitlist + core tables"
```

---

## Task 5: BMP Dispatch Engine

**Files:**
- Create: `backend/src/dispatch/scoring.ts`
- Create: `backend/src/dispatch/geo.ts`
- Create: `backend/src/dispatch/engine.ts`

**Step 1: Create geo.ts**

```typescript
// Haversine distance in km
export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

**Step 2: Create scoring.ts**

```typescript
// BMP: score = 0.40×proximity + 0.30×subscription + 0.20×activity + 0.10×idle

export interface DriverCandidate {
  id: string;
  lat: number;
  lng: number;
  subscription_tier: 1 | 2 | 3; // 1=Silver 2=Gold 3=Platinum
  activity_score: number;        // 0–1
  idle_time_minutes: number;
}

const SUBSCRIPTION_WEIGHTS = { 1: 0.40, 2: 0.70, 3: 1.00 };
const MAX_DISTANCE_KM = 10;

export function bmpScore(
  driver: DriverCandidate,
  pickupLat: number,
  pickupLng: number,
  distanceKm: number
): number {
  const proximityScore = Math.max(0, 1 - distanceKm / MAX_DISTANCE_KM);
  const subscriptionScore = SUBSCRIPTION_WEIGHTS[driver.subscription_tier];
  const activityScore = Math.min(1, Math.max(0, driver.activity_score));
  const idleScore = Math.min(1, driver.idle_time_minutes / 30); // reward drivers waiting up to 30min

  return (
    0.40 * proximityScore +
    0.30 * subscriptionScore +
    0.20 * activityScore +
    0.10 * idleScore
  );
}
```

**Step 3: Create engine.ts**

```typescript
import { supabase } from '../lib/supabase';
import { haversineKm } from './geo';
import { bmpScore, DriverCandidate } from './scoring';

const OFFER_TIMEOUT_SECONDS = 15;
const MAX_SEARCH_RADIUS_KM = 10;

export async function dispatchTrip(tripId: string, pickupLat: number, pickupLng: number) {
  // 1. Find online + available drivers
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, current_location, subscription_tier, activity_score, idle_time_minutes')
    .eq('is_online', true)
    .eq('is_available', true);

  if (error || !drivers?.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  // 2. Score each driver
  const scored = drivers
    .map((d) => {
      const coords = d.current_location?.coordinates; // [lng, lat] in PostGIS
      if (!coords) return null;
      const [lng, lat] = coords;
      const distKm = haversineKm(pickupLat, pickupLng, lat, lng);
      if (distKm > MAX_SEARCH_RADIUS_KM) return null;

      const score = bmpScore(
        { id: d.id, lat, lng, subscription_tier: d.subscription_tier, activity_score: d.activity_score, idle_time_minutes: d.idle_time_minutes },
        pickupLat, pickupLng, distKm
      );
      return { driverId: d.id, score, distKm };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score);

  if (!scored.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  const winner = scored[0]!;

  // 3. Update trip + create offer
  await supabase.from('trips').update({
    status: 'dispatching',
    driver_id: winner.driverId,
    bmp_score: winner.score,
  }).eq('id', tripId);

  const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();
  await supabase.from('trip_offers').insert({
    trip_id: tripId,
    driver_id: winner.driverId,
    expires_at: expiresAt,
  });

  // 4. Auto-expire after timeout
  setTimeout(async () => {
    const { data: offer } = await supabase
      .from('trip_offers')
      .select('status')
      .eq('trip_id', tripId)
      .eq('driver_id', winner.driverId)
      .single();

    if (offer?.status === 'pending') {
      await supabase.from('trip_offers').update({ status: 'expired' })
        .eq('trip_id', tripId).eq('driver_id', winner.driverId);
      // TODO: re-dispatch to next candidate
    }
  }, OFFER_TIMEOUT_SECONDS * 1000);

  return winner.driverId;
}
```

**Step 4: Commit**

```bash
git add backend/src/dispatch/
git commit -m "feat: BMP dispatch engine — geo scoring + trip offer delivery"
```

---

## Task 6: Rider App Scaffold (Expo)

**Files:**
- Create: `rider/` (Expo project)

**Step 1: Create Expo app**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
npx create-expo-app@latest rider --template blank-typescript
```

**Step 2: Install core dependencies**

```bash
cd rider
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
npm install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill nativewind
npm install --save-dev tailwindcss
```

**Step 3: Add app config `rider/app.json`** — update the `name` and `slug`:

```json
{
  "expo": {
    "name": "Wasel Rider",
    "slug": "wasel-rider",
    "version": "1.0.0",
    "scheme": "wasel-rider",
    "platforms": ["ios", "android"],
    "ios": { "bundleIdentifier": "com.wasel.rider" },
    "android": { "package": "com.wasel.rider" }
  }
}
```

**Step 4: Create `rider/lib/supabase.ts`**

```typescript
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

**Step 5: Create `rider/.env.example`**

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_WAITLIST_MODE=true
```

**Step 6: Commit**

```bash
git add rider/
git commit -m "feat: rider app Expo scaffold"
```

---

## Task 7: Rider Waitlist Screen

**Files:**
- Create: `rider/app/_layout.tsx`
- Create: `rider/app/index.tsx` (routes to waitlist or home based on env)
- Create: `rider/app/waitlist.tsx`
- Create: `rider/app/waitlist-success.tsx`

**Step 1: Create `rider/app/_layout.tsx`**

```typescript
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="waitlist" />
      <Stack.Screen name="waitlist-success" />
    </Stack>
  );
}
```

**Step 2: Create `rider/app/index.tsx`** (mode gate)

```typescript
import { Redirect } from 'expo-router';

const WAITLIST_MODE = process.env.EXPO_PUBLIC_WAITLIST_MODE === 'true';

export default function Index() {
  if (WAITLIST_MODE) return <Redirect href="/waitlist" />;
  return <Redirect href="/home" />;
}
```

**Step 3: Create `rider/app/waitlist.tsx`**

```typescript
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { router } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function WaitlistScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing info', 'Please enter your name and phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), city: city.trim(), role: 'rider' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');
      router.replace('/waitlist-success');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Logo / Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>وصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
          <Text style={styles.tagline}>The ride-hailing app built for Jordan</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Ahmad Al-Khalidi"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="+962 7X XXX XXXX"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>City (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Amman, Zarqa, Irbid..."
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
          />

          <TouchableOpacity style={styles.button} onPress={handleJoin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Join the Waitlist</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            We'll notify you when Wasel launches in your city. No spam.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 56, fontWeight: '700', color: '#F5A623', letterSpacing: 2 },
  logoEn: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginTop: -8 },
  tagline: { fontSize: 14, color: '#888', marginTop: 8, textAlign: 'center' },
  form: { gap: 4 },
  label: { color: '#CCC', fontSize: 13, marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#FFF',
  },
  button: {
    backgroundColor: '#F5A623',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 16 },
  disclaimer: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 16 },
});
```

**Step 4: Create `rider/app/waitlist-success.tsx`**

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function WaitlistSuccess() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🎉</Text>
      <Text style={styles.title}>You're on the list!</Text>
      <Text style={styles.subtitle}>
        We'll reach out when Wasel launches in your city.{'\n'}Tell your friends — the more sign up, the faster we launch.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center', padding: 32 },
  emoji: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 16, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24 },
});
```

**Step 5: Commit**

```bash
git add rider/app/
git commit -m "feat: rider waitlist screen with success state"
```

---

## Task 8: Driver App Scaffold + Waitlist Screen

Same pattern as Tasks 6–7 but for drivers.

**Step 1: Scaffold**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
npx create-expo-app@latest driver --template blank-typescript
cd driver
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
npm install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
```

**Step 2: Create `driver/app.json`**

```json
{
  "expo": {
    "name": "Wasel Driver",
    "slug": "wasel-driver",
    "version": "1.0.0",
    "scheme": "wasel-driver",
    "platforms": ["ios", "android"],
    "ios": { "bundleIdentifier": "com.wasel.driver" },
    "android": { "package": "com.wasel.driver" }
  }
}
```

**Step 3: Create `driver/app/waitlist.tsx`**

Same structure as rider waitlist but with extra driver fields:

```typescript
// role: 'driver'
// Extra fields: vehicle_type (Sedan, SUV, Van)
```

Full screen mirrors rider waitlist screen but includes:
- Vehicle type picker (Sedan / SUV / Van)
- Submission posts `role: 'driver'` + `vehicle_type`

**Step 4: Commit**

```bash
git add driver/
git commit -m "feat: driver app scaffold + waitlist screen"
```

---

## Task 9: Connect Repo to GitHub

**Step 1: After creating repo at github.com/radalzubi/Wasel-MVP**

```bash
cd /Users/radalzubi/Desktop/WASELMVP
git remote add origin https://github.com/radalzubi/Wasel-MVP.git
git branch -M main
git push -u origin main
```

---

## Task 10: Verify Everything Runs

**Step 1: Start backend**
```bash
cd /Users/radalzubi/Desktop/WASELMVP/backend && npm run dev
```
Expected: `Wasel backend running on port 3001`

**Step 2: Test health endpoint**
```bash
curl http://localhost:3001/health
```
Expected: `{"status":"ok","waitlistMode":true}`

**Step 3: Test waitlist signup**
```bash
curl -X POST http://localhost:3001/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"name":"Ahmad","phone":"+962790000003","role":"rider","city":"Amman"}'
```
Expected: `{"message":"Successfully joined waitlist","id":"..."}`

**Step 4: Start rider app**
```bash
cd /Users/radalzubi/Desktop/WASELMVP/rider && npx expo start
```
Scan QR with Expo Go — should show waitlist screen.

**Step 5: Start driver app**
```bash
cd /Users/radalzubi/Desktop/WASELMVP/driver && npx expo start --port 8082
```

---

## Summary

| What | Tech | Status |
|---|---|---|
| Monorepo | npm workspaces | Task 1 |
| Backend API | Express + TS | Task 2 |
| Waitlist API | Zod validated | Task 3 |
| Database schema | Supabase SQL | Task 4 |
| BMP Dispatch Engine | Custom algorithm | Task 5 |
| Rider App | Expo | Task 6–7 |
| Driver App | Expo | Task 8 |
| GitHub | Remote push | Task 9 |

**Next after this:** Auth (Phone OTP), trip request flow, real-time driver tracking, subscription management.
