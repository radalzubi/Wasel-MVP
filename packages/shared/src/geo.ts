/**
 * Great-circle distance between two lat/lng points in kilometers.
 * Used throughout the app for:
 *   - rendering the driver-to-pickup ETA badge
 *   - guarding fitToCoordinates from globe-spanning animations (see home.tsx / dashboard.tsx)
 *   - client-side fare previews before the server quote arrives
 *
 * The backend has its own copy in backend/src/dispatch/geo.ts — kept separate
 * because the backend is intentionally outside the workspace (see root package.json).
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
