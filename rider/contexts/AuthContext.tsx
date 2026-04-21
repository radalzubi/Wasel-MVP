import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ────────────────────────────────────────────────────────────────────
// AuthContext contract
//
// Feature screens must NEVER call supabase.auth.getSession() directly.
// Use `getAccessToken()` to obtain the current token (read from a ref that
// is kept in sync by onAuthStateChange — no extra SDK round-trip), or
// use `authFetch()` which automatically attaches Bearer + handles 401.
//
// Centralizing this gives us: one place to log auth activity, one place to
// handle 401 → signOut, and protection against the 18+ ad-hoc call sites
// that each had subtle differences in error handling.
// ────────────────────────────────────────────────────────────────────

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Read the current access token synchronously (from ref populated by onAuthStateChange). */
  getAccessToken: () => string | null;
  /** Fetch wrapper: attaches Bearer automatically, signs the user out on persistent 401. */
  authFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  getAccessToken: () => null,
  authFetch: async () => { throw new Error('AuthContext not mounted'); },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Ref mirrors the current access token so sync callers can read it without
  // awaiting supabase.auth.getSession() (which hits storage + may round-trip
  // to the SDK's refresh machinery).
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Prime tokenRef, session, user, and loading from storage immediately.
    // This guarantees setLoading(false) is called even if onAuthStateChange
    // fires TOKEN_REFRESHED as the first event (token expired at startup),
    // which has an early return that skips setLoading — without this call the
    // app would hang on the loading spinner until iOS watchdog kills it (~20s).
    //
    // .catch() is CRITICAL: AsyncStorage corruption, SDK errors during
    // deserialisation, or a rejected storage read would otherwise become an
    // unhandled promise rejection AND leave setLoading(false) unreached,
    // which is the exact "hang → watchdog kill" crash surface we keep
    // chasing. On rejection we treat it as "no session" and proceed to
    // the signed-out path so index.tsx can route to /login.
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        tokenRef.current = session?.access_token ?? null;
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('[AuthContext] getSession rejected — treating as signed-out:', err);
        tokenRef.current = null;
        setSession(null);
        setUser(null);
        setLoading(false);
      });

    // Keep ref + state in sync with every subsequent auth event.
    // TOKEN_REFRESHED only rotates the JWT — update tokenRef and session but
    // skip setUser so [user?.id]-keyed effects don't re-run hourly (prevents
    // push-token churn, profile re-fetch, etc.).
    //
    // The handler body is wrapped in try/catch — a synchronous throw inside
    // a Supabase auth listener propagates up through the SDK's internal
    // event emitter and can take the JS runtime down. In 99% of cases the
    // only thing that can throw is a malformed nextSession object; our
    // handler only reads primitives off it, but the guard is still cheap
    // and removes any possibility of this failure mode.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      try {
        tokenRef.current = nextSession?.access_token ?? null;
        if (event === 'TOKEN_REFRESHED') {
          setSession(nextSession);
          return;
        }
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setLoading(false);
      } catch (err) {
        console.warn('[AuthContext] onAuthStateChange handler threw:', err);
        // Fail safe: clear loading so we don't hang on the spinner.
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const getAccessToken = useCallback((): string | null => tokenRef.current, []);

  // authFetch attaches Bearer token and handles 401 uniformly.
  // On 401: try a single refreshSession(); if the retry still 401s, signOut.
  // Callers still see the final Response so they can decide how to surface
  // errors — authFetch never swallows bodies.
  const authFetch = useCallback(async (input: RequestInfo, init: RequestInit = {}): Promise<Response> => {
    const attach = (token: string | null): RequestInit => {
      const headers = new Headers(init.headers ?? {});
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return { ...init, headers };
    };

    let token = tokenRef.current;
    let response = await fetch(input, attach(token));

    if (response.status === 401) {
      // Token may have expired mid-request or been revoked server-side.
      // Attempt a single refresh, then retry once.
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.access_token) {
        tokenRef.current = data.session.access_token;
        token = data.session.access_token;
        response = await fetch(input, attach(token));
      }
      // If still 401 after the refresh attempt, the session is not recoverable.
      // Sign out so AuthGuard redirects to login — better than leaving the
      // user stuck on a screen with perpetual 401 alerts.
      if (response.status === 401) {
        await supabase.auth.signOut().catch(() => {});
      }
    }

    return response;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, loading, signOut, getAccessToken, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
