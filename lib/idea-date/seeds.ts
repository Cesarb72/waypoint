import type { Plan, Stop } from '@/app/plan-engine/types';
import { PLAN_VERSION } from '@/app/plan-engine/types';
import type { IdeaDateRole, IdeaDateVibeId } from '@/lib/engine/idea-date/ideaDateConfig';
import { haversineDistanceM } from '@/lib/engine/idea-date/travelEstimate';
import candidateDataset from './data/replacementCandidates.json';

export type IdeaDateSeedStop = {
  name: string;
  categories: string[];
  lat: number;
  lng: number;
  role: 'start' | 'main' | 'windDown';
  priceTier?: number;
  shortTagline?: string;
  ideaDate?: {
    intentVector?: {
      intimacy: number;
      energy: number;
      novelty: number;
      discovery: number;
      pretense: number;
      pressure: number;
    };
    energyLevel?: number;
    durationMin?: number;
    sourceGoogleType?: string;
    overrides?: {
      chillLively: number;
      relaxedActive: number;
      quickLingering: number;
    };
  };
};

type IdeaDateCandidateDatasetRow = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types?: string[];
  priceLevel?: number;
  editorialSummary?: string;
  roles?: IdeaDateRole[];
  vibes?: IdeaDateVibeId[];
};

type LatLng = { lat: number; lng: number };
type SeedResolverUsed = 'google' | 'local' | 'mock' | 'unknown';

export type IdeaDateSeedResolverTelemetry = {
  used: SeedResolverUsed;
  count: number;
  error: string | null;
  requestId?: string | null;
};

type GoogleSeedCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
  priceLevel?: number;
  editorialSummary?: string;
};

type GoogleSeedSearchResponse = {
  ok?: boolean;
  error?: string;
  results?: GoogleSeedSearchResult[];
  requestId?: string;
};

type GoogleSeedSearchResult = {
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  types?: string[];
  priceLevel?: number;
  editorialSummary?: string;
};

type GoogleCallBudget = {
  remaining: number;
};

const SURPRISE_CLUSTER_RADII_M = [1200, 2000, 3500] as const;
const SURPRISE_DEFAULT_VIBE: IdeaDateVibeId = 'first_date_low_pressure';
const SURPRISE_MIN_STOPS = 3;
const SURPRISE_GOOGLE_LIMIT = 12;
const SURPRISE_GOOGLE_MIN_CANDIDATES = 3;
const SURPRISE_GOOGLE_MAX_CALLS = 7;
const SURPRISE_DEFAULT_CENTER: LatLng = { lat: 37.7784, lng: -122.4231 };
const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';

const START_TYPE_HINTS = ['restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery'] as const;
const MAIN_TYPE_HINTS = ['art_gallery', 'museum', 'amusement_center', 'tourist_attraction'] as const;
const WIND_DOWN_TYPE_HINTS = ['bar', 'cocktail_bar', 'dessert_shop', 'tea_house'] as const;

const GOOGLE_ROLE_CONFIG: Record<
  IdeaDateRole,
  { includedTypes: string[]; keyword: string }
> = {
  start: {
    includedTypes: ['cafe', 'coffee_shop', 'restaurant', 'tea_house', 'bakery'],
    keyword: 'date cafe restaurant',
  },
  main: {
    includedTypes: ['museum', 'art_gallery', 'tourist_attraction', 'amusement_center'],
    keyword: 'museum gallery attraction activity',
  },
  windDown: {
    includedTypes: ['bar', 'dessert_shop', 'cocktail_bar', 'coffee_shop'],
    keyword: 'dessert lounge bar coffee',
  },
  flex: {
    includedTypes: ['cafe', 'restaurant', 'tourist_attraction'],
    keyword: 'date spot',
  },
};

const SURPRISE_DATASET = (candidateDataset as IdeaDateCandidateDatasetRow[])
  .slice()
  .sort((a, b) => a.placeId.localeCompare(b.placeId));

export const IDEA_DATE_MESSY_SEED: IdeaDateSeedStop[] = [
  {
    name: 'Lantern Alley Coffee Bar',
    categories: ['cafe', 'coffee_shop'],
    lat: 37.7887,
    lng: -122.4069,
    role: 'start',
    priceTier: 2,
    shortTagline: 'Buzzing counter seating with fast turnover near Union Square.',
    ideaDate: {
      intentVector: {
        intimacy: 0,
        energy: 1,
        novelty: 1,
        discovery: 1,
        pretense: 1,
        pressure: 1,
      },
      energyLevel: 1,
      durationMin: 180,
      sourceGoogleType: 'coffee_shop',
      overrides: {
        chillLively: 0,
        relaxedActive: 0,
        quickLingering: 0,
      },
    },
  },
  {
    name: 'Civic Atrium Gallery',
    categories: ['art_gallery', 'museum'],
    lat: 37.7869,
    lng: -122.4016,
    role: 'main',
    priceTier: 2,
    shortTagline: 'Large rotating exhibit halls with evening docent talks.',
  },
  {
    name: 'Harborline Late-Night Lounge',
    categories: ['bar', 'cocktail_bar'],
    lat: 37.8047,
    lng: -122.4192,
    role: 'windDown',
    priceTier: 4,
    shortTagline: 'High-volume lounge service that ramps up late.',
    ideaDate: {
      intentVector: {
        intimacy: 0,
        energy: 1,
        novelty: 1,
        discovery: 1,
        pretense: 1,
        pressure: 1,
      },
      energyLevel: 1,
      durationMin: 220,
      sourceGoogleType: 'bar',
      overrides: {
        chillLively: 0,
        relaxedActive: 0,
        quickLingering: 0,
      },
    },
  },
];

export const IDEA_DATE_CLEAN_SEED: IdeaDateSeedStop[] = [
  {
    name: 'Juniper Corner Cafe',
    categories: ['cafe', 'coffee_shop'],
    lat: 37.7772,
    lng: -122.4246,
    role: 'start',
    priceTier: 2,
    shortTagline: 'Quiet sidewalk tables and mellow acoustic playlist.',
  },
  {
    name: 'Rowan Kitchen & Wine',
    categories: ['restaurant'],
    lat: 37.7778,
    lng: -122.4239,
    role: 'main',
    priceTier: 3,
    shortTagline: 'Seasonal small plates with relaxed pacing for longer conversation.',
  },
  {
    name: 'Willow Dessert Parlor',
    categories: ['dessert_shop', 'tea_house'],
    lat: 37.7782,
    lng: -122.4232,
    role: 'windDown',
    priceTier: 2,
    shortTagline: 'Tea flights and plated desserts in a low-light room.',
  },
];

function toStopRole(role: IdeaDateSeedStop['role'], index: number): Stop['role'] {
  if (role === 'start') return 'anchor';
  if (role === 'main') return 'support';
  return index === 2 ? 'optional' : 'support';
}

function toSeedRole(role: IdeaDateRole): IdeaDateSeedStop['role'] {
  if (role === 'start') return 'start';
  if (role === 'windDown') return 'windDown';
  return 'main';
}

function toRoleSequence(stopCount: number): IdeaDateRole[] {
  const normalized = Math.max(SURPRISE_MIN_STOPS, Math.floor(stopCount || SURPRISE_MIN_STOPS));
  const sequence: IdeaDateRole[] = ['start'];
  for (let index = 0; index < normalized - 2; index += 1) {
    sequence.push('main');
  }
  sequence.push('windDown');
  return sequence;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state = (state + Math.imul(state ^ (state >>> 7), 61 | state)) ^ state;
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitizeResolverError(value: unknown): string | null {
  if (!(value instanceof Error) && typeof value !== 'string') return null;
  const raw = typeof value === 'string' ? value : value.message;
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length === 0) return null;
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 119)}...`;
}

function normalizeGoogleCandidate(value: GoogleSeedSearchResult): GoogleSeedCandidate | null {
  const placeId = value?.placeId?.trim() ?? '';
  const name = value?.name?.trim() ?? '';
  const lat = value?.lat;
  const lng = value?.lng;
  if (!placeId || !name) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return {
    placeId,
    name,
    lat,
    lng,
    types: Array.isArray(value?.types) ? value.types : [],
    priceLevel: typeof value?.priceLevel === 'number' ? value.priceLevel : undefined,
    editorialSummary:
      typeof value?.editorialSummary === 'string' && value.editorialSummary.trim().length > 0
        ? value.editorialSummary.trim()
        : undefined,
  };
}

function sortByDistanceThenName(candidates: GoogleSeedCandidate[], center: LatLng): GoogleSeedCandidate[] {
  return candidates
    .slice()
    .sort((a, b) => {
      const distanceA = haversineDistanceM(center, { lat: a.lat, lng: a.lng });
      const distanceB = haversineDistanceM(center, { lat: b.lat, lng: b.lng });
      const distanceDelta = distanceA - distanceB;
      if (distanceDelta !== 0) return distanceDelta;
      const nameDelta = a.name.localeCompare(b.name);
      if (nameDelta !== 0) return nameDelta;
      return a.placeId.localeCompare(b.placeId);
    });
}

function dedupeCandidates(candidates: GoogleSeedCandidate[]): GoogleSeedCandidate[] {
  const seen = new Set<string>();
  const out: GoogleSeedCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.placeId)) continue;
    seen.add(candidate.placeId);
    out.push(candidate);
  }
  return out;
}

function seededIndex(seedKey: string, size: number): number {
  if (size <= 0) return 0;
  return hashSeed(seedKey) % size;
}

function pickDeterministicCandidate(args: {
  candidates: GoogleSeedCandidate[];
  seedKey: string;
  usedPlaceIds: Set<string>;
}): GoogleSeedCandidate | null {
  const candidates = args.candidates;
  if (candidates.length === 0) return null;
  const startIndex = seededIndex(args.seedKey, candidates.length);
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(startIndex + offset) % candidates.length];
    if (args.usedPlaceIds.has(candidate.placeId)) continue;
    return candidate;
  }
  return null;
}

function attachSeedResolverTelemetry(
  plan: Plan,
  telemetry: IdeaDateSeedResolverTelemetry
): Plan {
  const existingMeta = plan.meta ?? {};
  const existingIdeaDate =
    typeof existingMeta.ideaDate === 'object' && existingMeta.ideaDate !== null
      ? (existingMeta.ideaDate as Record<string, unknown>)
      : {};
  return {
    ...plan,
    meta: {
      ...existingMeta,
      ideaDate: {
        ...existingIdeaDate,
        seedResolverTelemetry: {
          used: telemetry.used,
          count: Number.isFinite(telemetry.count) ? Math.max(0, Math.floor(telemetry.count)) : 0,
          error: telemetry.error,
          requestId:
            typeof telemetry.requestId === 'string' && telemetry.requestId.trim().length > 0
              ? telemetry.requestId.trim()
              : null,
        },
      },
    },
  };
}

export function withIdeaDateSeedResolverTelemetry(
  plan: Plan,
  telemetry: IdeaDateSeedResolverTelemetry
): Plan {
  return attachSeedResolverTelemetry(plan, telemetry);
}

async function fetchGoogleCandidatesForRole(args: {
  role: IdeaDateRole;
  center: LatLng;
  budget: GoogleCallBudget;
}): Promise<{ candidates: GoogleSeedCandidate[]; count: number; requestId: string | null }> {
  const roleConfig = GOOGLE_ROLE_CONFIG[args.role];
  let bestCandidates: GoogleSeedCandidate[] = [];
  let lastRequestId: string | null = null;

  for (const radiusMeters of SURPRISE_CLUSTER_RADII_M) {
    if (args.budget.remaining <= 0) {
      throw new Error('budget_exceeded');
    }
    args.budget.remaining -= 1;
    if (debug) {
      console.log(
        `[idea-date][debug] google_search_request role=${args.role} radiusMeters=${radiusMeters} includedTypes=${roleConfig.includedTypes.join(',')} keyword=${roleConfig.keyword}`
      );
    }
    const response = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lat: args.center.lat,
        lng: args.center.lng,
        radiusMeters,
        includedTypes: roleConfig.includedTypes,
        keyword: roleConfig.keyword,
        limit: SURPRISE_GOOGLE_LIMIT,
      }),
    });

    if (!response.ok) {
      throw new Error(`google_seed_http_${response.status}`);
    }

    const payload = (await response.json()) as GoogleSeedSearchResponse;
    const payloadRequestId =
      typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
        ? payload.requestId.trim()
        : null;
    if (payloadRequestId) {
      lastRequestId = payloadRequestId;
    }
    if (!payload.ok) {
      throw new Error(payload.error?.trim() || 'google_seed_api_error');
    }

    const normalized = dedupeCandidates(
      sortByDistanceThenName(
        (Array.isArray(payload.results) ? payload.results : [])
          .map((item) => normalizeGoogleCandidate(item))
          .filter((item): item is GoogleSeedCandidate => Boolean(item)),
        args.center
      )
    ).slice(0, SURPRISE_GOOGLE_LIMIT);
    if (debug) {
      console.log(
        `[idea-date][debug] google_search_response role=${args.role} radiusMeters=${radiusMeters} includedTypes=${roleConfig.includedTypes.join(',')} keyword=${roleConfig.keyword} candidates=${normalized.length}`
      );
    }

    if (normalized.length > bestCandidates.length) {
      bestCandidates = normalized;
    }
    if (normalized.length >= SURPRISE_GOOGLE_MIN_CANDIDATES) {
      return { candidates: normalized, count: normalized.length, requestId: lastRequestId };
    }
  }

  return { candidates: bestCandidates, count: bestCandidates.length, requestId: lastRequestId };
}

function hasTypeHint(types: string[] | undefined, hints: readonly string[]): boolean {
  if (!types || types.length === 0) return false;
  const lower = new Set(types.map((value) => value.toLowerCase()));
  return hints.some((hint) => lower.has(hint));
}

function roleTypeHints(role: IdeaDateRole): readonly string[] {
  if (role === 'start') return START_TYPE_HINTS;
  if (role === 'windDown') return WIND_DOWN_TYPE_HINTS;
  return MAIN_TYPE_HINTS;
}

function stableRankBySeed<T extends { placeId: string }>(items: T[], seedTag: string): T[] {
  return items
    .slice()
    .sort((a, b) => {
      const scoreA = hashSeed(`${seedTag}|${a.placeId}`);
      const scoreB = hashSeed(`${seedTag}|${b.placeId}`);
      const scoreDelta = scoreA - scoreB;
      if (scoreDelta !== 0) return scoreDelta;
      return a.placeId.localeCompare(b.placeId);
    });
}

function isFiniteLatLng(latLng: LatLng): boolean {
  return Number.isFinite(latLng.lat) && Number.isFinite(latLng.lng);
}

function preferVibe(rows: IdeaDateCandidateDatasetRow[], vibeId: IdeaDateVibeId): IdeaDateCandidateDatasetRow[] {
  const vibeRows = rows.filter((row) => (row.vibes ?? []).includes(vibeId));
  return vibeRows.length > 0 ? vibeRows : rows;
}

function preferRoleTypes(rows: IdeaDateCandidateDatasetRow[], role: IdeaDateRole): IdeaDateCandidateDatasetRow[] {
  const typedRows = rows.filter((row) => hasTypeHint(row.types, roleTypeHints(role)));
  return typedRows.length > 0 ? typedRows : rows;
}

function selectStartCandidate(args: {
  rows: IdeaDateCandidateDatasetRow[];
  vibeId: IdeaDateVibeId;
  centerLatLng?: LatLng;
  seedTag: string;
}): IdeaDateCandidateDatasetRow | null {
  const roleRows = args.rows.filter((row) => (row.roles ?? []).includes('start'));
  if (roleRows.length === 0) return null;
  const startPool = preferRoleTypes(preferVibe(roleRows, args.vibeId), 'start');
  const rankedPool = stableRankBySeed(startPool, args.seedTag);

  if (args.centerLatLng && isFiniteLatLng(args.centerLatLng)) {
    for (const radiusM of SURPRISE_CLUSTER_RADII_M) {
      const nearby = rankedPool.filter(
        (row) => haversineDistanceM(args.centerLatLng as LatLng, { lat: row.lat, lng: row.lng }) <= radiusM
      );
      if (nearby.length > 0) return nearby[0];
    }
  }

  return rankedPool[0] ?? null;
}

function selectByRoleAroundCenter(args: {
  rows: IdeaDateCandidateDatasetRow[];
  role: IdeaDateRole;
  vibeId: IdeaDateVibeId;
  center: LatLng;
  usedPlaceIds: Set<string>;
  seedTag: string;
}): IdeaDateCandidateDatasetRow | null {
  const roleRows = args.rows
    .filter((row) => !args.usedPlaceIds.has(row.placeId))
    .filter((row) => (row.roles ?? []).includes(args.role));
  if (roleRows.length === 0) return null;

  const pool = preferRoleTypes(preferVibe(roleRows, args.vibeId), args.role);
  const rankedPool = stableRankBySeed(pool, args.seedTag);

  for (const radiusM of SURPRISE_CLUSTER_RADII_M) {
    const nearby = rankedPool.filter(
      (row) => haversineDistanceM(args.center, { lat: row.lat, lng: row.lng }) <= radiusM
    );
    if (nearby.length > 0) return nearby[0];
  }

  return rankedPool[0] ?? null;
}

export function buildIdeaDateSeedPlan(args: {
  id: string;
  title?: string;
  seed?: IdeaDateSeedStop[];
}): Plan {
  const seed = args.seed ?? IDEA_DATE_MESSY_SEED;
  const stops: Stop[] = seed.map((item, index) => {
    const stopId = `${args.id}-stop-${index + 1}`;
    const coordinateKey = `${item.lat.toFixed(4)}_${item.lng.toFixed(4)}`.replace(/[^\d_]/g, '_');
    const placeId = `idea_date_seed_${index + 1}_${coordinateKey}`;
    return {
      id: stopId,
      name: item.name,
      role: toStopRole(item.role, index),
      optionality: index === 2 ? 'flexible' : 'required',
      placeRef: {
        provider: 'google',
        placeId,
        latLng: { lat: item.lat, lng: item.lng },
        label: item.name,
      },
      placeLite: {
        placeId,
        name: item.name,
        formattedAddress: 'San Francisco, CA',
        types: item.categories,
        priceLevel: item.priceTier,
        editorialSummary: item.shortTagline,
      },
      ideaDate:
        item.ideaDate
          ? {
              role: item.role,
              ...item.ideaDate,
            }
          : { role: item.role },
    };
  });

  return {
    id: args.id,
    version: PLAN_VERSION,
    title: args.title ?? 'Idea-Date: Surprise Me',
    intent: 'Find a smooth evening flow with strong vibe alignment.',
    audience: '2 people',
    stops,
    meta: {
      ideaDate: {
        vibeId: 'first_date_low_pressure',
        travelMode: 'walk',
      },
    },
  };
}

export async function buildSurpriseMePlanGoogle(args: {
  id: string;
  title?: string;
  centerLatLng?: LatLng;
  vibeId?: IdeaDateVibeId;
  stopCount?: number;
}): Promise<Plan> {
  const vibeId = args.vibeId ?? SURPRISE_DEFAULT_VIBE;
  let lastRequestId: string | null = null;
  try {
    const normalizedStopCount = Math.max(SURPRISE_MIN_STOPS, Math.floor(args.stopCount ?? SURPRISE_MIN_STOPS));
    const roleSequence = toRoleSequence(normalizedStopCount);
    const initialCenter = args.centerLatLng && isFiniteLatLng(args.centerLatLng)
      ? args.centerLatLng
      : SURPRISE_DEFAULT_CENTER;

    const usedPlaceIds = new Set<string>();
    const selected: GoogleSeedCandidate[] = [];
    let totalCandidateCount = 0;
    const callBudget: GoogleCallBudget = { remaining: SURPRISE_GOOGLE_MAX_CALLS };

    const startPool = await fetchGoogleCandidatesForRole({
      role: 'start',
      center: initialCenter,
      budget: callBudget,
    });
    totalCandidateCount += startPool.count;
    if (startPool.requestId) {
      lastRequestId = startPool.requestId;
    }
    const startCandidate = pickDeterministicCandidate({
      candidates: startPool.candidates,
      seedKey: `${args.id}|${vibeId}|start`,
      usedPlaceIds,
    });
    if (!startCandidate) {
      throw new Error('google_seed_missing_start');
    }

    selected.push(startCandidate);
    usedPlaceIds.add(startCandidate.placeId);
    const clusterCenter: LatLng = { lat: startCandidate.lat, lng: startCandidate.lng };

    for (let index = 1; index < roleSequence.length; index += 1) {
      const role = roleSequence[index];
      const rolePool = await fetchGoogleCandidatesForRole({
        role,
        center: clusterCenter,
        budget: callBudget,
      });
      totalCandidateCount += rolePool.count;
      if (rolePool.requestId) {
        lastRequestId = rolePool.requestId;
      }
      const next = pickDeterministicCandidate({
        candidates: rolePool.candidates,
        seedKey: `${args.id}|${vibeId}|${role}|${index}`,
        usedPlaceIds,
      });
      if (!next) continue;
      selected.push(next);
      usedPlaceIds.add(next.placeId);
    }

    if (selected.length < normalizedStopCount) {
      throw new Error(`google_seed_insufficient_stops_${selected.length}`);
    }

    const seedStops: IdeaDateSeedStop[] = selected.slice(0, normalizedStopCount).map((row, index) => {
      const isLast = index === normalizedStopCount - 1;
      const role: IdeaDateSeedStop['role'] = index === 0 ? 'start' : isLast ? 'windDown' : 'main';
      return {
        name: row.name,
        categories: row.types,
        lat: row.lat,
        lng: row.lng,
        role,
        priceTier: row.priceLevel,
        shortTagline: row.editorialSummary,
      };
    });

    const plan = buildIdeaDateSeedPlan({
      id: args.id,
      title: args.title ?? 'Idea-Date: Surprise Me',
      seed: seedStops,
    });

    const withVibe = {
      ...plan,
      meta: {
        ...(plan.meta ?? {}),
        ideaDate: {
          ...(typeof plan.meta?.ideaDate === 'object' && plan.meta.ideaDate
            ? (plan.meta.ideaDate as Record<string, unknown>)
            : {}),
          vibeId,
        },
      },
    };

    return attachSeedResolverTelemetry(withVibe, {
      used: 'google',
      count: totalCandidateCount,
      error: null,
      requestId: lastRequestId,
    });
  } catch (nextError) {
    const fallback = buildSurpriseMePlan({
      id: args.id,
      title: args.title ?? 'Idea-Date: Surprise Me',
      centerLatLng: args.centerLatLng,
      vibeId,
      stopCount: args.stopCount,
    });
    return attachSeedResolverTelemetry(fallback, {
      used: 'local',
      count: 0,
      error: sanitizeResolverError(nextError) ?? 'google_seed_fallback',
      requestId: lastRequestId,
    });
  }
}

export function buildSurpriseMePlan(args: {
  id: string;
  title?: string;
  centerLatLng?: LatLng;
  vibeId?: IdeaDateVibeId;
  stopCount?: number;
}): Plan {
  const vibeId = args.vibeId ?? SURPRISE_DEFAULT_VIBE;
  const seedValue = hashSeed(`${args.id}|${vibeId}`);
  const seedTag = String(seedValue);
  const startCandidate = selectStartCandidate({
    rows: SURPRISE_DATASET,
    vibeId,
    centerLatLng: args.centerLatLng,
    seedTag: `${seedTag}:start`,
  });
  if (!startCandidate) {
    return buildIdeaDateSeedPlan({
      id: args.id,
      title: args.title ?? 'Idea-Date: Surprise Me',
      seed: IDEA_DATE_CLEAN_SEED,
    });
  }
  const center = { lat: startCandidate.lat, lng: startCandidate.lng };

  const selectedRows: IdeaDateCandidateDatasetRow[] = [startCandidate];
  const usedPlaceIds = new Set<string>([startCandidate.placeId]);
  const remainingRoles = toRoleSequence(args.stopCount ?? 3).slice(1);
  for (let index = 0; index < remainingRoles.length; index += 1) {
    const role = remainingRoles[index];
    const selected = selectByRoleAroundCenter({
      rows: SURPRISE_DATASET,
      role,
      vibeId,
      center,
      usedPlaceIds,
      seedTag: `${seedTag}:${role}:${index}`,
    });
    if (!selected) continue;
    selectedRows.push(selected);
    usedPlaceIds.add(selected.placeId);
  }

  if (selectedRows.length < SURPRISE_MIN_STOPS) {
    return buildIdeaDateSeedPlan({
      id: args.id,
      title: args.title ?? 'Idea-Date: Surprise Me',
      seed: IDEA_DATE_CLEAN_SEED,
    });
  }

  const seedStops: IdeaDateSeedStop[] = selectedRows.map((row, index) => {
    const isLast = index === selectedRows.length - 1;
    const role: IdeaDateSeedStop['role'] =
      index === 0 ? 'start' : isLast ? 'windDown' : toSeedRole((row.roles ?? ['main'])[0] ?? 'main');
    return {
      name: row.name,
      categories: row.types ?? [],
      lat: row.lat,
      lng: row.lng,
      role,
      priceTier: row.priceLevel,
      shortTagline: row.editorialSummary,
    };
  });

  const plan = buildIdeaDateSeedPlan({
    id: args.id,
    title: args.title ?? 'Idea-Date: Surprise Me',
    seed: seedStops,
  });
  const withVibe = {
    ...plan,
    meta: {
      ...(plan.meta ?? {}),
      ideaDate: {
        ...(typeof plan.meta?.ideaDate === 'object' && plan.meta.ideaDate ? (plan.meta.ideaDate as Record<string, unknown>) : {}),
        vibeId,
      },
    },
  };
  return attachSeedResolverTelemetry(withVibe, {
    used: 'local',
    count: 0,
    error: null,
  });
}

export function toSeedResolverError(value: unknown): string | null {
  return sanitizeResolverError(value);
}
