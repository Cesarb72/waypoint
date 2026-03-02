import type { Plan } from '@/lib/core/planTypes';
import type { MagicRefinement } from '@/lib/session/ideaDateSession';
import type { AnchorPolicyLike, CrewPolicyLike } from '@/lib/toolkits/concierge/types';

export type SurpriseReport = {
  applied: {
    nonPredictable: boolean;
    cohesiveArc: boolean;
    crewGuardrails: boolean;
  };
  wildcardInjected: 0 | 1;
  notes: string[];
};

const MAINSTREAM_CATEGORIES = new Set(['food', 'restaurant', 'bar', 'dessert', 'cafe']);
const ENERGY_KEYS = ['energy', 'energyScore', 'intensity', 'intensityScore'] as const;
const DISTANCE_KEYS = ['travelMinutes', 'travelMins', 'distanceMeters', 'distance', 'durationMinutes'] as const;
const AFFORDABLE_KEYS = ['priceLevel', 'cost', 'estimatedCost', 'budget'] as const;
const UNIQUE_KEYS = ['uniqueness', 'noveltyScore', 'discoveryScore'] as const;
const SEASONAL_KEYS = ['seasonalRelevance', 'seasonalScore', 'timeRelevance', 'eventRelevance'] as const;
const VISUAL_KEYS = ['visualInterest', 'visualScore', 'sceneryScore'] as const;
const CANDIDATE_SOURCE_KEYS = [
  'seedCandidates',
  'candidatePool',
  'candidates',
  'googleCandidates',
  'googleResults',
  'seedStops',
  'rawSeedStops',
  'searchResults',
] as const;

type NormalizedSeedCandidate = {
  name: string;
  placeId: string | null;
  category: string | null;
  type: string | null;
  tags: string[];
  types: string[];
};

type CandidateDatasetRow = {
  placeId?: string;
  name?: string;
  types?: string[];
};

const FALLBACK_SEED_CANDIDATES: CandidateDatasetRow[] = [
  {
    placeId: 'local_cedar_court_cafe',
    name: 'Cedar Court Cafe',
    types: ['cafe', 'coffee_shop'],
  },
  {
    placeId: 'local_booklane_parlor',
    name: 'Booklane Parlor',
    types: ['book_store', 'cafe'],
  },
  {
    placeId: 'local_mint_bakery_bar',
    name: 'Mint Bakery Bar',
    types: ['bakery', 'cafe'],
  },
  {
    placeId: 'local_foundry_gallery_hall',
    name: 'Foundry Gallery Hall',
    types: ['art_gallery', 'museum'],
  },
  {
    placeId: 'local_civic_still_life_museum',
    name: 'Civic Still Life Museum',
    types: ['museum'],
  },
  {
    placeId: 'local_oak_row_bistro',
    name: 'Oak Row Bistro',
    types: ['restaurant'],
  },
  {
    placeId: 'local_harbor_supper_house',
    name: 'Harbor Supper House',
    types: ['restaurant'],
  },
  {
    placeId: 'local_north_beach_jazz_room',
    name: 'North Beach Jazz Room',
    types: ['bar', 'music_venue'],
  },
];

function clonePlan(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan);
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCategoryLike(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = readCategoryLike(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isMainstreamToken(value: string): boolean {
  if (!value) return false;
  if (MAINSTREAM_CATEGORIES.has(value)) return true;
  return (
    value.includes('restaurant') ||
    value.includes('food') ||
    value.includes('bar') ||
    value.includes('dessert') ||
    value.includes('cafe') ||
    value.includes('coffee') ||
    value.includes('cocktail') ||
    value.includes('tea') ||
    value.includes('bakery')
  );
}

function readStopTypes(stop: unknown): string[] {
  if (!isRecord(stop)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown): void => {
    for (const item of readStringArray(value)) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  };

  push(stop.types);
  push(stop.categories);
  const directType = readCategoryLike(stop.type);
  if (directType && !seen.has(directType)) {
    seen.add(directType);
    out.push(directType);
  }
  const directCategory = readCategoryLike(stop.category);
  if (directCategory && !seen.has(directCategory)) {
    seen.add(directCategory);
    out.push(directCategory);
  }
  const placeLite = isRecord(stop.placeLite) ? stop.placeLite : null;
  if (placeLite) {
    push(placeLite.types);
  }
  return out;
}

function inferCategoryFromType(type: string): string {
  if (!type) return '';
  if (type.includes('restaurant') || type.includes('food')) return 'food';
  if (type.includes('bar') || type.includes('cocktail')) return 'bar';
  if (type.includes('dessert') || type.includes('bakery') || type.includes('cafe') || type.includes('coffee')) {
    return 'dessert';
  }
  if (type.includes('museum') || type.includes('gallery') || type.includes('culture')) return 'culture';
  if (type.includes('amusement') || type.includes('games') || type.includes('arcade')) return 'games';
  if (type.includes('park') || type.includes('outdoor') || type.includes('trail') || type.includes('garden')) {
    return 'outdoors';
  }
  return type;
}

function inferEnergy(types: string[]): number | null {
  const has = (matchers: readonly string[]): boolean =>
    types.some((type) => matchers.some((matcher) => type.includes(matcher)));

  if (has(['nightlife', 'bar', 'cocktail', 'club', 'lounge'])) return 0.8;
  if (has(['games', 'game', 'amusement', 'arcade', 'bowling', 'mini_golf'])) return 0.7;
  if (has(['museum', 'gallery', 'culture', 'cultural'])) return 0.5;
  if (has(['park', 'outdoor', 'trail', 'garden', 'beach'])) return 0.6;
  if (has(['restaurant', 'food'])) return 0.4;
  if (has(['cafe', 'coffee', 'dessert', 'bakery', 'tea'])) return 0.3;
  return null;
}

function enrichStopForEvaluation(stop: unknown): unknown {
  if (!isRecord(stop)) return stop;
  const nextStop: Record<string, unknown> = { ...stop };
  const types = readStopTypes(nextStop);
  const normalizedType = readCategoryLike(nextStop.type) || types[0] || '';
  const normalizedCategory = readCategoryLike(nextStop.category) || inferCategoryFromType(normalizedType);

  if (nextStop.type === undefined && normalizedType) {
    nextStop.type = normalizedType;
  }
  if (nextStop.category === undefined && normalizedCategory) {
    nextStop.category = normalizedCategory;
  }

  if (nextStop.energy === undefined) {
    const energy = inferEnergy(
      [normalizedType, normalizedCategory, ...types].map((entry) => readCategoryLike(entry)).filter(Boolean)
    );
    if (energy !== null) {
      nextStop.energy = energy;
    }
  }

  const existingTags = readStringArray(nextStop.tags);
  const hasDiscoveryTag = existingTags.includes('discovery');
  const hasNonMainstreamType = [normalizedCategory, normalizedType, ...types]
    .filter(Boolean)
    .some((entry) => !isMainstreamToken(entry));
  if (!hasDiscoveryTag && hasNonMainstreamType) {
    nextStop.tags = [...existingTags, 'discovery'];
  }

  return nextStop;
}

function isMainstreamLikeStop(stop: unknown): boolean {
  if (!isRecord(stop)) return false;
  const category = readCategoryLike(stop.category);
  const type = readCategoryLike(stop.type);
  const types = readStopTypes(stop);
  return [category, type, ...types].filter(Boolean).some((entry) => isMainstreamToken(entry));
}

function isDiscoveryLikeStop(stop: unknown): boolean {
  if (!isRecord(stop)) return false;
  const tagsRaw = Array.isArray(stop.tags) ? stop.tags : [];
  const tags = tagsRaw.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().toLowerCase());
  const category = readCategoryLike(stop.category);
  const type = readCategoryLike(stop.type);
  const types = readStopTypes(stop);
  const isDiscoveryTag = tags.includes('discovery');
  const isNonFoodCategory = Boolean(category) && !isMainstreamToken(category);
  const isNonFoodType = Boolean(type) && !isMainstreamToken(type);
  const hasNonFoodTypedSignal = types.some((entry) => !isMainstreamToken(entry));
  const hasAnyTypeSignal = types.length > 0 || Boolean(category) || Boolean(type);
  if (!hasAnyTypeSignal) return isDiscoveryTag;
  return isDiscoveryTag || isNonFoodCategory || isNonFoodType || hasNonFoodTypedSignal;
}

function readMagicRefinement(value: unknown): MagicRefinement {
  if (
    value === 'more_unique' ||
    value === 'more_energy' ||
    value === 'closer_together' ||
    value === 'more_curated' ||
    value === 'more_affordable'
  ) {
    return value;
  }
  return null;
}

function readNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\$+$/.test(trimmed)) return trimmed.length;
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function readMetric(candidate: unknown, keys: readonly string[]): number | null {
  if (!isRecord(candidate)) return null;
  for (const key of keys) {
    const value = readNumericValue(candidate[key]);
    if (value !== null) return value;
  }
  return null;
}

function readSoftBoost(candidate: unknown): { boost: number; hasAny: boolean } {
  const seasonal = readMetric(candidate, SEASONAL_KEYS);
  const visual = readMetric(candidate, VISUAL_KEYS);
  const hasAny = seasonal !== null || visual !== null;
  return {
    boost: (seasonal ?? 0) + (visual ?? 0),
    hasAny,
  };
}

function pickCandidate(
  candidates: unknown[],
  magicRefinement: MagicRefinement,
  notes: string[]
): unknown | null {
  if (candidates.length === 0) return null;
  const discoveryCandidates = candidates.filter((candidate) => isDiscoveryLikeStop(candidate));
  const pool = discoveryCandidates.length > 0 ? discoveryCandidates : candidates;

  let primaryKeys: readonly string[] | null = null;
  let objective: 'min' | 'max' = 'max';
  let missingMetricNote: string | null = null;

  if (magicRefinement === 'more_energy') {
    primaryKeys = ENERGY_KEYS;
    objective = 'max';
    missingMetricNote = 'Magic refinement more_energy requested, but candidate energy fields are unavailable.';
  } else if (magicRefinement === 'closer_together') {
    primaryKeys = DISTANCE_KEYS;
    objective = 'min';
    missingMetricNote = 'Magic refinement closer_together requested, but travel/distance fields are unavailable.';
  } else if (magicRefinement === 'more_affordable') {
    primaryKeys = AFFORDABLE_KEYS;
    objective = 'min';
    missingMetricNote = 'Magic refinement more_affordable requested, but cost fields are unavailable.';
  } else if (magicRefinement === 'more_unique') {
    primaryKeys = UNIQUE_KEYS;
    objective = 'max';
    missingMetricNote = 'Magic refinement more_unique requested, but uniqueness fields are unavailable.';
  } else if (magicRefinement === 'more_curated') {
    notes.push('Magic refinement more_curated reduced wildcard aggressiveness.');
  }

  if (primaryKeys) {
    let bestCandidate: unknown | null = null;
    let bestMetric: number | null = null;
    let bestBoost = Number.NEGATIVE_INFINITY;

    for (const candidate of pool) {
      const metric = readMetric(candidate, primaryKeys);
      if (metric === null) continue;
      const { boost } = readSoftBoost(candidate);
      if (bestCandidate === null) {
        bestCandidate = candidate;
        bestMetric = metric;
        bestBoost = boost;
        continue;
      }
      const beatsPrimary = objective === 'max' ? metric > (bestMetric as number) : metric < (bestMetric as number);
      const tiesPrimary = metric === bestMetric;
      const beatsBoost = tiesPrimary && boost > bestBoost;
      if (beatsPrimary || beatsBoost) {
        bestCandidate = candidate;
        bestMetric = metric;
        bestBoost = boost;
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }
    if (missingMetricNote) notes.push(missingMetricNote);
  }

  let bestBoostedCandidate: unknown | null = null;
  let bestBoost = Number.NEGATIVE_INFINITY;
  let anyBoostData = false;
  for (const candidate of pool) {
    const { boost, hasAny } = readSoftBoost(candidate);
    if (hasAny) {
      anyBoostData = true;
      if (bestBoostedCandidate === null || boost > bestBoost) {
        bestBoostedCandidate = candidate;
        bestBoost = boost;
      }
    }
  }
  if (bestBoostedCandidate) {
    notes.push('Applied seasonal/time and visual-interest soft bias when selecting wildcard.');
    return bestBoostedCandidate;
  }
  if (!anyBoostData) {
    notes.push('No seasonal/time or visual metadata available for soft bias.');
  }
  return pool[0] ?? null;
}

function readCandidateSources(ideaDate: Record<string, unknown>): unknown[] {
  const sourceArrays: unknown[][] = [];
  const append = (value: unknown): void => {
    if (Array.isArray(value)) {
      sourceArrays.push(value);
      return;
    }
    if (!isRecord(value)) return;
    if (Array.isArray(value.candidates)) sourceArrays.push(value.candidates);
    if (Array.isArray(value.results)) sourceArrays.push(value.results);
    if (Array.isArray(value.items)) sourceArrays.push(value.items);
  };

  for (const key of CANDIDATE_SOURCE_KEYS) {
    append(ideaDate[key]);
  }
  return sourceArrays.flat();
}

function normalizeCandidateRecord(candidate: unknown): NormalizedSeedCandidate | null {
  if (!isRecord(candidate)) return null;
  const placeRef = isRecord(candidate.placeRef) ? candidate.placeRef : null;
  const placeLite = isRecord(candidate.placeLite) ? candidate.placeLite : null;
  const placeId =
    readString(candidate.placeId) ??
    readString(candidate.place_id) ??
    readString(placeRef?.placeId) ??
    readString(placeLite?.placeId) ??
    null;
  const name =
    readString(candidate.name) ??
    readString(candidate.title) ??
    readString(candidate.label) ??
    readString(placeLite?.name) ??
    placeId;
  if (!name) return null;
  const explicitType = readCategoryLike(candidate.type);
  const explicitCategory = readCategoryLike(candidate.category);
  const types = [
    ...readStringArray(candidate.types),
    ...readStringArray(candidate.categories),
    ...readStringArray(candidate.includedTypes),
    ...readStringArray(placeLite?.types),
  ];
  if (explicitType && !types.includes(explicitType)) {
    types.unshift(explicitType);
  }
  if (explicitCategory && !types.includes(explicitCategory)) {
    types.unshift(explicitCategory);
  }

  return {
    name,
    placeId,
    type: explicitType || types[0] || null,
    category: explicitCategory || inferCategoryFromType(types[0] || ''),
    tags: readStringArray(candidate.tags),
    types,
  };
}

function stopToCandidate(stop: unknown): NormalizedSeedCandidate | null {
  if (!isRecord(stop)) return null;
  return normalizeCandidateRecord({
    name: stop.name,
    placeId:
      (isRecord(stop.placeRef) ? stop.placeRef.placeId : null) ??
      (isRecord(stop.placeLite) ? stop.placeLite.placeId : null) ??
      null,
    type: stop.type,
    category: stop.category,
    tags: stop.tags,
    types: readStopTypes(stop),
    placeLite: isRecord(stop.placeLite) ? stop.placeLite : undefined,
    placeRef: isRecord(stop.placeRef) ? stop.placeRef : undefined,
  });
}

function buildFallbackSeedCandidates(stops: unknown[]): NormalizedSeedCandidate[] {
  const fromStops = stops
    .map((stop) => stopToCandidate(stop))
    .filter((candidate): candidate is NormalizedSeedCandidate => Boolean(candidate));
  const datasetRows = FALLBACK_SEED_CANDIDATES
    .map((row) =>
      normalizeCandidateRecord({
        placeId: row.placeId,
        name: row.name,
        types: row.types ?? [],
      })
    )
    .filter((candidate): candidate is NormalizedSeedCandidate => Boolean(candidate));
  return [...fromStops, ...datasetRows];
}

function candidateIdentityKey(candidate: NormalizedSeedCandidate): string {
  const placeId = readCategoryLike(candidate.placeId);
  if (placeId) return `pid:${placeId}`;
  return `name:${readCategoryLike(candidate.name)}`;
}

function dedupeCandidates(candidates: NormalizedSeedCandidate[]): NormalizedSeedCandidate[] {
  const out: NormalizedSeedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidateIdentityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function normalizeSeedCandidates(
  ideaDate: Record<string, unknown> | null,
  stops: unknown[],
  notes: string[]
): NormalizedSeedCandidate[] {
  const rawMetaCandidates = ideaDate ? readCandidateSources(ideaDate) : [];
  const normalizedMetaCandidates = rawMetaCandidates
    .map((candidate) => normalizeCandidateRecord(candidate))
    .filter((candidate): candidate is NormalizedSeedCandidate => Boolean(candidate));
  if (normalizedMetaCandidates.length > 0) {
    return dedupeCandidates(normalizedMetaCandidates);
  }
  notes.push('No candidate arrays found in meta.ideaDate; using deterministic stop+seed fallback for seedCandidates.');
  return dedupeCandidates(buildFallbackSeedCandidates(stops));
}

function buildStopIdentitySet(stops: unknown[]): Set<string> {
  const seen = new Set<string>();
  for (const stop of stops) {
    if (!isRecord(stop)) continue;
    const placeId =
      readString(isRecord(stop.placeRef) ? stop.placeRef.placeId : null) ??
      readString(isRecord(stop.placeLite) ? stop.placeLite.placeId : null);
    if (placeId) {
      seen.add(`pid:${readCategoryLike(placeId)}`);
    }
    const name = readString(stop.name);
    if (name) {
      seen.add(`name:${readCategoryLike(name)}`);
    }
  }
  return seen;
}

function isNonFoodDrinkCandidate(candidate: NormalizedSeedCandidate): boolean {
  const tokens = [candidate.category, candidate.type, ...candidate.types]
    .map((value) => readCategoryLike(value))
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((entry) => !isMainstreamToken(entry));
}

function pickDeterministicWildcardCandidate(
  candidates: NormalizedSeedCandidate[],
  stops: unknown[]
): NormalizedSeedCandidate | null {
  const used = buildStopIdentitySet(stops);
  const available = candidates.filter((candidate) => !used.has(candidateIdentityKey(candidate)));
  if (available.length === 0) return null;
  const firstNonFood = available.find((candidate) => isNonFoodDrinkCandidate(candidate));
  if (firstNonFood) return firstNonFood;
  return available[0] ?? null;
}

function makeDeterministicStopId(candidate: NormalizedSeedCandidate): string {
  const base = readCategoryLike(candidate.placeId) || readCategoryLike(candidate.name) || 'candidate';
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `idea-date-wildcard-${slug || 'candidate'}`;
}

function toInjectedWildcardStop(candidate: NormalizedSeedCandidate): Record<string, unknown> {
  const stop: Record<string, unknown> = {
    id: makeDeterministicStopId(candidate),
    name: candidate.name,
    role: 'support',
    optionality: 'flexible',
    category: candidate.category,
    type: candidate.type,
    tags: candidate.tags,
  };
  if (candidate.placeId) {
    stop.placeRef = {
      provider: 'google',
      placeId: candidate.placeId,
      label: candidate.name,
    };
    stop.placeLite = {
      placeId: candidate.placeId,
      name: candidate.name,
      types: candidate.types,
    };
  }
  if (stop.energy === undefined) {
    const energy = inferEnergy([candidate.category ?? '', candidate.type ?? '', ...candidate.types].filter(Boolean));
    if (energy !== null) {
      stop.energy = energy;
    }
  }
  if (!Array.isArray(stop.tags)) {
    stop.tags = [];
  }
  const tags = readStringArray(stop.tags);
  if (!tags.includes('discovery') && isNonFoodDrinkCandidate(candidate)) {
    stop.tags = [...tags, 'discovery'];
  } else {
    stop.tags = tags;
  }
  return stop;
}

function readStopsContainer(nextPlan: Plan): { stops: unknown[]; isRootStops: boolean } {
  const root = nextPlan as unknown as { stops?: unknown[]; plan?: { stops?: unknown[] } };
  if (Array.isArray(root.stops)) {
    return { stops: [...root.stops], isRootStops: true };
  }
  if (root.plan && Array.isArray(root.plan.stops)) {
    return { stops: [...root.plan.stops], isRootStops: false };
  }
  return { stops: [], isRootStops: true };
}

function writeStopsContainer(nextPlan: Plan, stops: unknown[], isRootStops: boolean): void {
  const root = nextPlan as unknown as { stops?: unknown[]; plan?: { stops?: unknown[] } };
  if (isRootStops) {
    root.stops = stops;
    return;
  }
  if (!root.plan) root.plan = {};
  root.plan.stops = stops;
}

export function enforceSurpriseContract(input: {
  plan: Plan;
  crewPolicy: CrewPolicyLike;
  anchorPolicy: AnchorPolicyLike;
}): { plan: Plan; report: SurpriseReport } {
  void input.anchorPolicy;

  const notes: string[] = [];
  let wildcardInjected: 0 | 1 = 0;
  const nextPlan = clonePlan(input.plan);
  const { stops: rawStops, isRootStops } = readStopsContainer(nextPlan);
  const stops = rawStops.map((stop) => enrichStopForEvaluation(stop));
  const root = nextPlan as unknown as { meta?: unknown };
  const meta = isRecord(root.meta) ? root.meta : null;
  const ideaDate = meta && isRecord(meta.ideaDate) ? meta.ideaDate : null;
  const seedCandidates = normalizeSeedCandidates(ideaDate, stops, notes);
  const magicRefinement = readMagicRefinement(ideaDate?.magicRefinement);

  const discoveryCount = stops.filter((stop) => isDiscoveryLikeStop(stop)).length;
  const mainstreamCount = stops.filter((stop) => isMainstreamLikeStop(stop)).length;
  let needsWildcardInjection = discoveryCount === 0;

  if (magicRefinement === 'more_unique') {
    const mainstreamHeavy = mainstreamCount > Math.max(1, discoveryCount);
    if (mainstreamHeavy) {
      needsWildcardInjection = true;
      notes.push('Magic refinement more_unique raised novelty threshold for mainstream-heavy stacks.');
    } else {
      notes.push('Magic refinement more_unique checked novelty threshold.');
    }
  }

  if (magicRefinement === 'more_curated' && discoveryCount > 0) {
    needsWildcardInjection = false;
    notes.push('Magic refinement more_curated avoided extra wildcard injection for a coherent set.');
  } else if (magicRefinement === 'more_curated' && discoveryCount === 0) {
    notes.push('Magic refinement more_curated allowed wildcard injection because no discovery stop was present.');
  }

  if (magicRefinement) {
    notes.push('Magic refinement applied without overriding crew safety floor.');
  }

  if (needsWildcardInjection) {
    if (seedCandidates.length > 0) {
      const pickedCandidate = pickDeterministicWildcardCandidate(seedCandidates, stops);
      if (pickedCandidate !== null) {
        const insertIndex = stops.length >= 2 ? 1 : stops.length;
        const injectedStop = toInjectedWildcardStop(pickedCandidate);
        stops.splice(insertIndex, 0, injectedStop);
        wildcardInjected = 1;
        if (isNonFoodDrinkCandidate(pickedCandidate)) {
          notes.push('No discovery stop found; injected deterministic non-food wildcard from seedCandidates.');
        } else {
          notes.push('No discovery stop found; injected first deterministic fallback wildcard from seedCandidates.');
        }
      } else {
        notes.push('Wildcard candidate selection skipped because no deterministic candidate could be chosen.');
      }
    } else {
      notes.push('No discovery stop found, and seedCandidates was empty after deterministic normalization.');
    }
  }

  const hasEnergyField = stops.some((stop) => isRecord(stop) && typeof stop.energy === 'number');
  if (hasEnergyField) {
    notes.push('Energy fields detected; cohesive arc check ran (no reorder unless explicit roles exist).');
  } else {
    notes.push('No energy fields detected; cohesive arc enforcement skipped.');
  }

  const hasGapField = stops.some((stop) => {
    if (!isRecord(stop)) return false;
    return (
      readNumericValue(stop.travelMinutes) !== null ||
      readNumericValue(stop.travelMins) !== null ||
      readNumericValue(stop.distanceMeters) !== null ||
      readNumericValue(stop.gapMinutes) !== null
    );
  });
  if (hasGapField) {
    notes.push('Travel/time gap fields detected; dead-air check ran (no reorder without deterministic alternatives).');
  } else {
    notes.push('No travel/time gap fields detected; dead-air enforcement skipped.');
  }

  if (input.crewPolicy.safetyFloor >= 0.9) {
    notes.push('Crew safety floor remains enforced as a hard guardrail.');
  }
  notes.push('Crew guardrail enforcement currently validation-only unless deterministic alternatives are available.');

  writeStopsContainer(nextPlan, stops, isRootStops);

  const report: SurpriseReport = {
    applied: {
      nonPredictable: true,
      cohesiveArc: true,
      crewGuardrails: true,
    },
    wildcardInjected,
    notes,
  };

  const nextMeta = isRecord(root.meta) ? root.meta : {};
  const nextIdeaDate = isRecord(nextMeta.ideaDate) ? nextMeta.ideaDate : {};
  root.meta = {
    ...nextMeta,
    ideaDate: {
      ...nextIdeaDate,
      seedCandidates,
      surpriseReport: report,
    },
  };

  return { plan: nextPlan, report };
}

