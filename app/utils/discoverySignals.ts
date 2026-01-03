import type { Plan, Stop } from '../plan-engine';

function getStops(plan?: Plan | null): Stop[] {
  if (!plan || !Array.isArray(plan.stops)) return [];
  return plan.stops.filter(Boolean);
}

export function getAnchorWeight(plan?: Plan | null): string {
  const stops = getStops(plan);
  if (stops.length === 0) return 'Balanced';

  const anchorCount = stops.filter((stop) => stop.role === 'anchor').length;
  const supportCount = stops.filter((stop) => stop.role === 'support').length;

  if (anchorCount > supportCount) return 'Anchor-heavy';
  if (supportCount > anchorCount) return 'Support-heavy';
  return 'Balanced';
}

export function getFlexibilityProfile(plan?: Plan | null): string {
  const stops = getStops(plan);
  if (stops.length === 0) return 'Med flex';

  const scoreFor = (stop: Stop): number => {
    if (stop.optionality === 'required') return 0;
    if (stop.optionality === 'flexible') return 1;
    if (stop.optionality === 'fallback') return 0.5;
    return 0.5; // neutral when missing/unknown
  };

  const totalScore = stops.reduce((sum, stop) => sum + scoreFor(stop), 0);
  const avg = totalScore / stops.length;

  if (avg <= 0.33) return 'Low flex';
  if (avg <= 0.66) return 'Med flex';
  return 'High flex';
}

export function getFallbackCoverage(plan?: Plan | null): string {
  const stops = getStops(plan);
  if (stops.length === 0) return 'No fallback';

  const fallbackCount = stops.filter((stop) => stop.optionality === 'fallback').length;
  const ratio = fallbackCount / stops.length;

  if (ratio >= 0.6) return 'Strong fallback';
  if (ratio > 0) return 'Partial fallback';
  return 'No fallback';
}

export function getChangeDistance(plan?: Plan | null, parentPlan?: Plan | null): string {
  const currentStops = getStops(plan);
  const parentStops = getStops(parentPlan);

  if (parentStops.length === 0) return 'Minor change';

  const parentIndexById = new Map<string, number>();
  parentStops.forEach((stop, index) => {
    if (stop?.id) parentIndexById.set(stop.id, index);
  });

  let added = 0;
  let roleChanges = 0;
  let orderChanges = 0;

  currentStops.forEach((stop, index) => {
    if (!stop?.id) return;
    const parentIndex = parentIndexById.get(stop.id);
    if (parentIndex === undefined) {
      added += 1;
      return;
    }

    const parentStop = parentStops[parentIndex];
    if (parentStop && parentStop.role !== stop.role) {
      roleChanges += 1;
    }
    if (parentIndex !== index) {
      orderChanges += 1;
    }
  });

  const removed = parentStops.filter(
    (stop) => stop?.id && !currentStops.find((s) => s?.id === stop.id)
  ).length;

  const totalDelta = added + removed + roleChanges + orderChanges;

  if (totalDelta <= 1) return 'Minor change';
  if (totalDelta <= 3) return 'Moderate change';
  return 'Major change';
}
