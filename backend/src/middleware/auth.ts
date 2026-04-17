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

  // Determine role by checking which profile table has a row
  const { data: driver } = await supabase
    .from('drivers')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

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
