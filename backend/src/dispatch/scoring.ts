// BMP: score = 0.40×proximity + 0.30×subscription + 0.20×activity + 0.10×idle

export interface DriverCandidate {
  id: string;
  subscription_tier: 1 | 2 | 3; // 1=Silver 2=Gold 3=Platinum
  activity_score: number;         // 0–1
  idle_time_minutes: number;
}

const SUBSCRIPTION_WEIGHTS: Record<1 | 2 | 3, number> = { 1: 0.40, 2: 0.70, 3: 1.00 };
const MAX_DISTANCE_KM = 10;

export function bmpScore(
  driver: DriverCandidate,
  distanceKm: number
): number {
  const proximityScore = Math.max(0, 1 - distanceKm / MAX_DISTANCE_KM);
  const subscriptionScore = SUBSCRIPTION_WEIGHTS[driver.subscription_tier];
  const activityScore = Math.min(1, Math.max(0, driver.activity_score));
  const idleScore = Math.min(1, driver.idle_time_minutes / 30);

  return (
    0.40 * proximityScore +
    0.30 * subscriptionScore +
    0.20 * activityScore +
    0.10 * idleScore
  );
}
