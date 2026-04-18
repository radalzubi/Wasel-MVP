import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: 'rider' | 'driver';
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  // Always use supabaseAdmin (service-role client that is never polluted by
  // signInWithPassword calls) to validate the incoming JWT.
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.userId = user.id;

  // Primary: read role from app_metadata (set server-side during registration,
  // never writable by the client). This avoids a DB round-trip on every request
  // and is immune to cross-contamination when the same phone is used in both apps.
  const metaRole = user.app_metadata?.role as string | undefined;
  if (metaRole === 'driver' || metaRole === 'rider') {
    req.userRole = metaRole;
    return next();
  }

  // Fallback: DB lookup for accounts created before app_metadata was introduced.
  // supabaseAdmin bypasses RLS so the lookup always returns the correct row.
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
