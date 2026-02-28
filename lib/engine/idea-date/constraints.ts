export enum ConstraintKind {
  MaxTravelEdge = 'max_travel_edge',
  RoleOrder = 'role_order',
  DuplicateFamily = 'duplicate_family',
  LateSpike = 'late_spike',
}

export type ConstraintSeverity = 'hard' | 'soft';

export type ConstraintViolation = {
  kind: ConstraintKind;
  severity: ConstraintSeverity;
  message: string;
  stopIds?: string[];
  edge?: {
    fromStopId: string;
    toStopId: string;
  };
  meta?: Record<string, unknown>;
};

export type ConstraintEvalResult = {
  violations: ConstraintViolation[];
  hardCount: number;
  softCount: number;
  narratives: string[];
};

export type ConstraintEvalInput = {
  stops: Array<{
    id: string;
    role: 'start' | 'main' | 'windDown' | 'flex';
    types?: string[];
  }>;
  travelEdges: Array<{
    minutes: number;
  }>;
  arc: {
    noTaper: boolean;
  };
  limits?: {
    hardMaxTravelEdgeMinutes?: number;
  };
};

const DEFAULT_HARD_MAX_TRAVEL_EDGE_MINUTES = 25;

function expectedRoleForIndex(index: number, stopCount: number): 'start' | 'main' | 'windDown' {
  if (stopCount <= 1) return 'start';
  if (index === 0) return 'start';
  if (index === stopCount - 1) return 'windDown';
  return 'main';
}

function classifyFamily(types: string[] | undefined): string {
  if (!types || types.length === 0) return 'other';
  const set = new Set(types.map((entry) => entry.toLowerCase()));
  const hasAny = (candidates: string[]) => candidates.some((candidate) => set.has(candidate));

  if (hasAny(['restaurant', 'cafe', 'bakery', 'meal_takeaway', 'food', 'dessert_shop', 'tea_house'])) {
    return 'food';
  }
  if (hasAny(['bar', 'cocktail_bar', 'night_club'])) return 'nightlife';
  if (hasAny(['museum', 'art_gallery', 'cultural_center', 'historical_landmark', 'book_store'])) {
    return 'culture';
  }
  if (hasAny(['park', 'hiking_area', 'tourist_attraction'])) return 'outdoors';
  return 'other';
}

function buildNarratives(violations: ConstraintViolation[]): string[] {
  const byKind = new Set(violations.map((violation) => violation.kind));
  const orderedKinds: ConstraintKind[] = [
    ConstraintKind.MaxTravelEdge,
    ConstraintKind.RoleOrder,
    ConstraintKind.DuplicateFamily,
    ConstraintKind.LateSpike,
  ];
  const linesByKind: Record<ConstraintKind, string> = {
    [ConstraintKind.MaxTravelEdge]: 'long transfer risk',
    [ConstraintKind.RoleOrder]: 'stop role order risk',
    [ConstraintKind.DuplicateFamily]: 'stop variety risk',
    [ConstraintKind.LateSpike]: 'late spike risk',
  };
  const lines: string[] = [];
  for (const kind of orderedKinds) {
    if (!byKind.has(kind)) continue;
    lines.push(linesByKind[kind]);
  }
  return lines;
}

export function evaluateConstraints(input: ConstraintEvalInput): ConstraintEvalResult {
  const violations: ConstraintViolation[] = [];
  const hardMaxTravelEdgeMinutes = input.limits?.hardMaxTravelEdgeMinutes ?? DEFAULT_HARD_MAX_TRAVEL_EDGE_MINUTES;
  const stops = input.stops ?? [];
  const travelEdges = input.travelEdges ?? [];

  for (let edgeIndex = 0; edgeIndex < travelEdges.length; edgeIndex += 1) {
    const edge = travelEdges[edgeIndex];
    if (!(edge.minutes > hardMaxTravelEdgeMinutes)) continue;
    const fromStopId = stops[edgeIndex]?.id ?? `edge_${edgeIndex}_from`;
    const toStopId = stops[edgeIndex + 1]?.id ?? `edge_${edgeIndex}_to`;
    violations.push({
      kind: ConstraintKind.MaxTravelEdge,
      severity: 'hard',
      message: 'One transfer is too long for a hard travel constraint.',
      stopIds: [fromStopId, toStopId],
      edge: { fromStopId, toStopId },
      meta: {
        edgeIndex,
        minutes: edge.minutes,
        thresholdMinutes: hardMaxTravelEdgeMinutes,
      },
    });
  }

  const roleOrderMismatchStopIds: string[] = [];
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const expectedRole = expectedRoleForIndex(index, stops.length);
    if (stop.role !== expectedRole) {
      roleOrderMismatchStopIds.push(stop.id);
    }
  }
  if (roleOrderMismatchStopIds.length > 0) {
    violations.push({
      kind: ConstraintKind.RoleOrder,
      severity: 'hard',
      message: 'Stop roles are out of the expected start-main-windDown order.',
      stopIds: roleOrderMismatchStopIds,
      meta: {
        expectedOrder: 'start-main-windDown',
      },
    });
  }

  const familyStopIds = new Map<string, string[]>();
  for (const stop of stops) {
    const family = classifyFamily(stop.types);
    if (!familyStopIds.has(family)) familyStopIds.set(family, []);
    familyStopIds.get(family)?.push(stop.id);
  }
  const duplicatedFamilies = [...familyStopIds.entries()]
    .filter(([family, stopIds]) => family !== 'other' && stopIds.length > 1)
    .sort((left, right) => {
      if (right[1].length !== left[1].length) return right[1].length - left[1].length;
      return left[0].localeCompare(right[0]);
    });
  if (duplicatedFamilies.length > 0) {
    const [family, stopIds] = duplicatedFamilies[0];
    violations.push({
      kind: ConstraintKind.DuplicateFamily,
      severity: 'soft',
      message: 'Several stops cluster in the same place family.',
      stopIds,
      meta: { family },
    });
  }

  if (input.arc.noTaper) {
    violations.push({
      kind: ConstraintKind.LateSpike,
      severity: 'soft',
      message: 'Ending energy does not taper cleanly.',
    });
  }

  const hardCount = violations.filter((violation) => violation.severity === 'hard').length;
  const softCount = violations.filter((violation) => violation.severity === 'soft').length;
  return {
    violations,
    hardCount,
    softCount,
    narratives: buildNarratives(violations),
  };
}
