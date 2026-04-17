import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// General-purpose client — used by all routes and the dispatch engine.
// NOTE: auth routes that call signInWithPassword() on this client will
// temporarily overwrite its in-memory auth state with the user JWT.
// Do not use this client for DB writes inside auth routes after a
// signInWithPassword() call — use supabaseAdmin instead (see below).
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Dedicated service-role client for DB writes inside auth routes.
//
// Problem: supabase.auth.signInWithPassword() stores the user's JWT in
// the shared client's in-memory auth state.  Any subsequent from() call
// on that same client sends the user JWT (subject to RLS) instead of the
// service role key (bypasses RLS).  Auth routes need to INSERT into
// drivers/riders — operations that have no RLS policy — so they must
// use a client whose auth state is never polluted by user sign-ins.
//
// This client is a separate instance with identical credentials.  It is
// ONLY used for direct DB writes in auth.ts helper functions and NEVER
// called with any auth.signIn* method.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
