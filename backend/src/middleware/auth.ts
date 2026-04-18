import { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin } from '../lib/supabase';

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

  // NOTE: This makes an extra DB round-trip on every authenticated request to
  // determine the caller's role. Under high concurrency this adds latency and
  // can become a DoS amplification vector (one incoming request → two Supabase
  // round-trips). Consider encoding the role in the JWT custom claims (set via
  // a Supabase Auth hook) so role can be read from the token without a DB query.
  // For now, role-guarded endpoints rely on requireDriver/requireRider being
  // chained immediately after requireAuth in the route definition.
  //
  // supabaseAdmin is used here (not supabase) to avoid the user-JWT session
  // pollution described in lib/supabase.ts. The shared `supabase` client's
  // in-memory auth state may hold a different user's JWT from a recent
  // signInWithPassword() call in auth routes, causing the role lookup to run
  // under the wrong uid and return no rows even for valid drivers.
  const { data: driver, error: roleErr } = await supabaseAdmin
    .from('drivers')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (roleErr) {
    console.error('[requireAuth] role lookup failed for user', user.id, ':', roleErr.message);
    return res.status(503).json({ error: 'Unable to verify role. Please try again.' });
  }

  req.userRole = driver ? 'driver' : 'rider';
  next();
}

export function requireDriver(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'driver') return res.status(403).json({ error: 'Driver access only' });
  next();
}

export function requireRider(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'rider') return res.status(403).json({ error: 'Rider access only' });
  next();
}
