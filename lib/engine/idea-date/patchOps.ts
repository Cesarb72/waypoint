import type { Plan, Stop } from '@/app/plan-engine/types';
import type { IdeaDatePatchOp } from './types';

function moveStop(stops: Stop[], stopId: string, toIndex: number): Stop[] {
  const fromIndex = stops.findIndex((stop) => stop.id === stopId);
  if (fromIndex === -1) return stops;
  const clampedIndex = Math.max(0, Math.min(toIndex, stops.length - 1));
  if (fromIndex === clampedIndex) return stops;
  const next = [...stops];
  const [item] = next.splice(fromIndex, 1);
  next.splice(clampedIndex, 0, item);
  return next;
}

function replaceStop(stops: Stop[], op: Extract<IdeaDatePatchOp, { op: 'replaceStop' }>): Stop[] {
  return stops.map((stop) => {
    if (stop.id !== op.stopId) return stop;
    return {
      ...stop,
      name: op.newPlace.name ?? stop.name,
      placeRef: op.newPlace.placeRef ?? stop.placeRef,
      placeLite: op.newPlace.placeLite ?? stop.placeLite,
      ideaDate: op.newIdeaDateProfile ?? stop.ideaDate,
    };
  });
}

function readStopPlaceId(stop: Stop): string | null {
  const fromRef = stop.placeRef?.placeId?.trim();
  if (fromRef) return fromRef;
  const fromLite = stop.placeLite?.placeId?.trim();
  if (fromLite) return fromLite;
  return null;
}

function collectDuplicateValues(values: Array<string | null>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return duplicates;
}

type IdeaDateNormalizedRole = 'start' | 'main' | 'windDown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveNormalizedRoleByIndex(index: number, stopCount: number): IdeaDateNormalizedRole {
  if (index <= 0) return 'start';
  if (index >= stopCount - 1) return 'windDown';
  return 'main';
}

export function normalizeRolesByIndex(plan: Plan): Plan {
  const stops = plan.stops ?? [];
  if (stops.length === 0) return plan;

  let changed = false;
  const nextStops = stops.map((stop, index) => {
    const normalizedRole = resolveNormalizedRoleByIndex(index, stops.length);
    const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : {};
    const currentRole = rawIdeaDate.role;
    if (currentRole === normalizedRole) return stop;
    changed = true;
    return {
      ...stop,
      ideaDate: {
        ...rawIdeaDate,
        role: normalizedRole,
      },
    };
  });

  if (!changed) return plan;
  return {
    ...plan,
    stops: nextStops,
  };
}

export function applyIdeaDatePatchOps(plan: Plan, ops: IdeaDatePatchOp[]): Plan {
  const startingStops = [...(plan.stops ?? [])];
  const startStopCount = startingStops.length;
  const startDuplicatePlaceIds = collectDuplicateValues(startingStops.map((stop) => readStopPlaceId(stop)));
  const hasMoveOp = ops.some((op) => op.op === 'moveStop');
  const hasReplaceOp = ops.some((op) => op.op === 'replaceStop');
  let nextStops = startingStops;

  for (const op of ops) {
    if (op.op === 'moveStop') {
      nextStops = moveStop(nextStops, op.stopId, op.toIndex);
      continue;
    }
    if (op.op === 'replaceStop') {
      nextStops = replaceStop(nextStops, op);
    }
  }

  if (hasMoveOp && !hasReplaceOp) {
    const normalized = normalizeRolesByIndex({
      ...plan,
      stops: nextStops,
    });
    nextStops = normalized.stops ?? nextStops;
  }

  if (process.env.NODE_ENV !== 'production') {
    if (hasReplaceOp && nextStops.length !== startStopCount) {
      throw new Error(
        `Idea-Date patch invariant failed: replaceStop changed stop count (${startStopCount} -> ${nextStops.length}).`
      );
    }

    const stopIds = nextStops.map((stop) => stop.id);
    const uniqueStopIds = new Set(stopIds);
    if (uniqueStopIds.size !== stopIds.length) {
      throw new Error('Idea-Date patch invariant failed: duplicate stop IDs after patch application.');
    }

    if (hasReplaceOp) {
      const nextDuplicatePlaceIds = collectDuplicateValues(nextStops.map((stop) => readStopPlaceId(stop)));
      const newlyIntroducedDuplicatePlaceIds = [...nextDuplicatePlaceIds].filter(
        (placeId) => !startDuplicatePlaceIds.has(placeId)
      );
      if (newlyIntroducedDuplicatePlaceIds.length > 0) {
        throw new Error(
          `Idea-Date patch invariant failed: replacement introduced duplicate placeIds (${newlyIntroducedDuplicatePlaceIds.join(', ')}).`
        );
      }
    }
  }

  return {
    ...plan,
    stops: nextStops,
  };
}
