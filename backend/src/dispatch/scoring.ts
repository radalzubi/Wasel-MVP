// BMP: score = 0.35×proximity + 0.25×subscription + 0.15×activity + 0.10×idle + 0.15×rating
//
// Rating weight (0.15): driver's average_rating [1.0–5.0] normalised to [0.0–1.0].
// Higher-rated drivers score higher on every dispatch round, so they naturally
// receive first offer on better trips — Uber-style quality-tier matching.
//
// Subscription controls QUANTITY via tier-based dispatch radius (see engine.ts):
//   Standard (no sub, tier 0) = 5 km radius
//   Silver  (tier 1)          = 7 km radius
//   Gold    (tier 2)          = 10 km radius
//   Platinum(tier 3)          = 15 km radius
// Higher-tier drivers are in the candidate pool for more trips.

export interface DriverCandidate {
  id: string;
  subscription_tier: 1 | 2 | 3; // 1=Silver 2=Gold 3=Platinum
  activity_score:    number;     // 0–1 EMA
  idle_time_minutes: number;
  average_rating:    number;     // 1.0–5.0; default 5.0 for new drivers
}

/** km radius each tier can be dispatched within */
export const TIER_RADIUS_KM: Record<number, number> = {
  0: 5,  // standard (no subscription)
  1: 7,  // Silver
  2: 10, // Gold
  3: 15, // Platinum
};

const SUBSCRIPTION_WEIGHTS: Record<1 | 2 | 3, number> = { 1: 0.40, 2: 0.70, 3: 1.00 };

export function bmpScore(
  driver: DriverCandidate,
  distanceKm: number
): number {
  // proximity: linear falloff from 1.0 at 0 km to 0.0 at the driver's tier radius
  const tierRadius        = TIER_RADIUS_KM[driver.subscription_tier] ?? TIER_RADIUS_KM[0];
  const proximityScore    = Math.max(0, 1 - distanceKm / tierRadius);
  const subscriptionScore = SUBSCRIPTION_WEIGHTS[driver.subscription_tier];
  const activityScore     = Math.min(1, Math.max(0, driver.activity_score));
  const idleScore         = Math.min(1, driver.idle_time_minutes / 30);
  // rating: map [1.0, 5.0] → [0.0, 1.0]
  const ratingScore       = Math.min(1, Math.max(0, (driver.average_rating - 1) / 4));

  return (
    0.35 * proximityScore    +
    0.25 * subscriptionScore +
    0.15 * activityScore     +
    0.10 * idleScore         +
    0.15 * ratingScore
  );
}
