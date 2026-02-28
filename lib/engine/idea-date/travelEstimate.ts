import type { IdeaDateTravelMode } from './ideaDateConfig';

export const IDEA_DATE_WALK_SPEED_MPS = 1.4;
export const IDEA_DATE_DRIVE_SPEED_MPS = 9;

const EARTH_RADIUS_M = 6_371_000;

export function haversineDistanceM(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function estimateTravelMinutes(mode: IdeaDateTravelMode, distanceM: number): number {
  const speedMps = mode === 'drive' ? IDEA_DATE_DRIVE_SPEED_MPS : IDEA_DATE_WALK_SPEED_MPS;
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  const seconds = distanceM / speedMps;
  return Math.max(1, Math.round(seconds / 60));
}
