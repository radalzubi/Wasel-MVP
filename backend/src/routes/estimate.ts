import { Router } from 'express';
import { z } from 'zod';

const router = Router();

const EstimateQuerySchema = z.object({
  pickup_lat:  z.coerce.number().min(-90).max(90),
  pickup_lng:  z.coerce.number().min(-180).max(180),
  dropoff_lat: z.coerce.number().min(-90).max(90),
  dropoff_lng: z.coerce.number().min(-180).max(180),
});

// GET /api/trips/estimate
// Public endpoint — no auth required. Returns fare, distance, duration, and encoded polyline.
// Uses Google Directions API when GOOGLE_DIRECTIONS_API_KEY is set; falls back to haversine.
router.get('/', async (req, res) => {
  const parsed = EstimateQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = parsed.data;

  const key = process.env.GOOGLE_DIRECTIONS_API_KEY;
  if (!key) {
    // Haversine fallback — straight-line distance, no polyline.
    const R = 6371;
    const dLat = ((dropoff_lat - pickup_lat) * Math.PI) / 180;
    const dLng = ((dropoff_lng - pickup_lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((pickup_lat * Math.PI) / 180) *
        Math.cos((dropoff_lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const fare = Math.max(1.5, 0.5 + distKm * 0.35);
    return res.json({
      fare_jd:      Number(fare.toFixed(2)),
      distance_km:  Number(distKm.toFixed(1)),
      duration_min: Math.max(1, Math.round((distKm / 25) * 60)),
      polyline:     null,
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
    const gData = await gRes.json() as {
      status: string;
      routes?: Array<{
        overview_polyline: { points: string };
        legs: Array<{
          distance: { value: number };
          duration: { value: number };
        }>;
      }>;
    };

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
