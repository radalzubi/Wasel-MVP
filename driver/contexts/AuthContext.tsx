import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ────────────────────────────────────────────────────────────────────
// AuthContext contract — see rider/contexts/AuthContext.tsx for full rationale.
// Feature screens must use getAccessToken() or authFetch(), NOT supabase.auth.getSession().
// ────────────────────────────────────────────────────────────────────

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  getAccessToken: () => string | null;
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
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      tokenRef.current = session?.access_token ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      tokenRef.current = nextSession?.access_token ?? null;
      if (event === 'TOKEN_REFRESHED') {
        setSession(nextSession);
        return;
      }
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const getAccessToken = useCallback((): string | null => tokenRef.current, []);

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
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.access_token) {
        tokenRef.current = data.session.access_token;
        token = data.session.access_token;
        response = await fetch(input, attach(token));
      }
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
