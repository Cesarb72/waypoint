import { NextResponse } from 'next/server';
import {
  normalizePlaceToEntity,
  type NormalizedPlaceEntity,
  type PlacesTextSearchResult,
} from '@/lib/places/normalizePlaceToEntity';
import { createServerTtlCache } from '@/lib/idea-date/serverCache';

type PlacesTextSearchResponse = {
  status?: string;
  results?: PlacesTextSearchResult[];
  error_message?: string;
};

type NearbySearchRequestBody = {
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  includedTypes?: string[];
  keyword?: string;
  limit?: number;
  requestId?: string;
};

type NearbySearchResult = {
  place_id?: string;
  name?: string;
  price_level?: number;
  types?: string[];
  editorial_summary?: {
    overview?: string;
  };
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

type NearbySearchResponse = {
  status?: string;
  results?: NearbySearchResult[];
  error_message?: string;
};

type PlaceSearchCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
  priceLevel?: number;
  editorialSummary?: string;
};

type SearchAttemptConfig = {
  stepUsed: string;
  radiusMeters: number;
  keyword: string;
  includedTypes: string[];
};

type NearbySearchDebugMeta = {
  stepUsed: string;
  finalRadiusMeters: number;
  keywordUsed: boolean;
  typesUsed: string[];
};

type NearbySearchCacheEntry = {
  results: PlaceSearchCandidate[];
  debug: NearbySearchDebugMeta;
};

const DEFAULT_RADIUS_METERS = 1200;
const DEFAULT_LIMIT = 8;
const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 8000;
const MAX_LIMIT = 10;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 250;
const MAX_INCLUDED_TYPES = 8;
const MAX_INCLUDED_TYPE_LENGTH = 64;
const MAX_KEYWORD_LENGTH = 80;
const FALLBACK_CHEAP_LIMIT = 5;
const RADIUS_BROADENING_STEPS = [1000, 2000, 4000] as const;
const CURATED_TYPE_SUPERSET = [
  'point_of_interest',
  'cultural_center',
  'theater',
  'performing_arts_theater',
  'historical_landmark',
  'park',
] as const;
const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
const nearbySearchCache = createServerTtlCache<string, NearbySearchCacheEntry>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
});

function withDebugMeta<T extends Record<string, unknown>>(
  payload: T,
  requestId: string,
  options?: {
    cacheHit?: boolean;
    nearbySearch?: NearbySearchDebugMeta;
  }
): T & {
  requestId: string;
  _debug?: {
    route: '/api/places/search';
    cacheHit?: boolean;
    stepUsed?: string;
    finalRadiusMeters?: number;
    keywordUsed?: boolean;
    typesUsed?: string[];
  };
} {
  if (debug) {
    return {
      ...payload,
      requestId,
      _debug: {
        route: '/api/places/search',
        ...(typeof options?.cacheHit === 'boolean' ? { cacheHit: options.cacheHit } : {}),
        ...(options?.nearbySearch ?? {}),
      },
    };
  }
  return {
    ...payload,
    requestId,
  };
}

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTypeList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value) => value.length > 0);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function normalizeKeyword(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ');
}

function sanitizeRequestId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.trim();
  if (!compact) return null;
  if (compact.length > 120) return compact.slice(0, 120);
  return compact;
}

function dedupeCandidatesByPlaceId(candidates: PlaceSearchCandidate[]): PlaceSearchCandidate[] {
  const seen = new Set<string>();
  const deduped: PlaceSearchCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.placeId) continue;
    if (seen.has(candidate.placeId)) continue;
    seen.add(candidate.placeId);
    deduped.push(candidate);
  }
  return deduped;
}

function mergeUniqueTypes(base: string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...base, ...additions]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function pushAttempt(
  attempts: SearchAttemptConfig[],
  seen: Set<string>,
  attempt: SearchAttemptConfig
): void {
  const key = `${attempt.radiusMeters}|${attempt.keyword.toLowerCase()}|${attempt.includedTypes.join(',')}`;
  if (seen.has(key)) return;
  seen.add(key);
  attempts.push(attempt);
}

function buildSearchAttempts(input: {
  radiusMeters: number;
  keyword: string;
  includedTypes: string[];
}): SearchAttemptConfig[] {
  const attempts: SearchAttemptConfig[] = [];
  const seen = new Set<string>();
  const baseTypes = input.includedTypes.slice();
  const broadenedTypes = mergeUniqueTypes(baseTypes, CURATED_TYPE_SUPERSET);

  pushAttempt(attempts, seen, {
    stepUsed: 'initial',
    radiusMeters: input.radiusMeters,
    keyword: input.keyword,
    includedTypes: baseTypes,
  });

  for (const radiusMeters of RADIUS_BROADENING_STEPS) {
    if (radiusMeters <= input.radiusMeters) continue;
    pushAttempt(attempts, seen, {
      stepUsed: `radius_${radiusMeters}`,
      radiusMeters,
      keyword: input.keyword,
      includedTypes: baseTypes,
    });
  }

  pushAttempt(attempts, seen, {
    stepUsed: 'types_only_4000',
    radiusMeters: 4000,
    keyword: '',
    includedTypes: baseTypes,
  });

  pushAttempt(attempts, seen, {
    stepUsed: 'types_only_8000',
    radiusMeters: 8000,
    keyword: '',
    includedTypes: baseTypes,
  });

  pushAttempt(attempts, seen, {
    stepUsed: 'types_expanded_8000',
    radiusMeters: 8000,
    keyword: '',
    includedTypes: broadenedTypes,
  });

  return attempts;
}

function toCacheKey(input: {
  lat: number;
  lng: number;
  radiusMeters: number;
  includedTypes: string[];
  keyword: string;
  limit: number;
}): string {
  const sortedTypes = input.includedTypes.slice().sort((a, b) => a.localeCompare(b));
  return [
    input.lat.toFixed(5),
    input.lng.toFixed(5),
    String(input.radiusMeters),
    sortedTypes.join(','),
    input.keyword.toLowerCase(),
    String(input.limit),
  ].join('|');
}

function parseNearbySearchInput(body: unknown): {
  ok: true;
  lat: number;
  lng: number;
  radiusMeters: number;
  includedTypes: string[];
  keyword: string;
  limit: number;
  requestId: string | null;
} | {
  ok: false;
  error: string;
} {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'invalid_body' };
  }

  const record = body as NearbySearchRequestBody;
  const lat = typeof record.lat === 'number' ? record.lat : NaN;
  const lng = typeof record.lng === 'number' ? record.lng : NaN;
  if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) {
    return { ok: false, error: 'invalid_coordinates' };
  }

  if (record.includedTypes !== undefined && !Array.isArray(record.includedTypes)) {
    return { ok: false, error: 'invalid_included_types' };
  }

  const includedTypes = normalizeTypeList(record.includedTypes);
  if (includedTypes.length > MAX_INCLUDED_TYPES) {
    return { ok: false, error: 'invalid_included_types' };
  }
  if (includedTypes.some((type) => type.length === 0 || type.length > MAX_INCLUDED_TYPE_LENGTH)) {
    return { ok: false, error: 'invalid_included_types' };
  }

  if (record.keyword !== undefined && typeof record.keyword !== 'string') {
    return { ok: false, error: 'invalid_keyword' };
  }
  const keyword = normalizeKeyword(record.keyword);
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: 'invalid_keyword' };
  }

  const radiusMeters = clampInteger(
    record.radiusMeters,
    MIN_RADIUS_METERS,
    MAX_RADIUS_METERS,
    DEFAULT_RADIUS_METERS
  );
  let limit = clampInteger(record.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  if (includedTypes.length === 0 && keyword.length === 0) {
    limit = Math.min(limit, FALLBACK_CHEAP_LIMIT);
  }

  return {
    ok: true,
    lat,
    lng,
    radiusMeters,
    includedTypes,
    keyword,
    limit,
    requestId: sanitizeRequestId(record.requestId),
  };
}

function intersectsTypes(types: string[], includedTypes: string[]): boolean {
  if (includedTypes.length === 0) return true;
  const set = new Set(types.map((value) => value.toLowerCase()));
  return includedTypes.some((value) => set.has(value));
}

function toCandidate(item: NearbySearchResult): PlaceSearchCandidate | null {
  const placeId = item.place_id?.trim() ?? '';
  const name = item.name?.trim() ?? '';
  const lat = item.geometry?.location?.lat;
  const lng = item.geometry?.location?.lng;
  if (!placeId || !name) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return {
    placeId,
    name,
    lat,
    lng,
    types: Array.isArray(item.types) ? item.types : [],
    priceLevel: typeof item.price_level === 'number' ? item.price_level : undefined,
    editorialSummary: item.editorial_summary?.overview?.trim() || undefined,
  };
}

async function fetchNearbyCandidates(input: {
  apiKey: string;
  lat: number;
  lng: number;
  attempt: SearchAttemptConfig;
}): Promise<
  | {
      ok: true;
      candidates: PlaceSearchCandidate[];
    }
  | {
      ok: false;
    }
> {
  const params = new URLSearchParams({
    key: input.apiKey,
    location: `${input.lat},${input.lng}`,
    radius: String(input.attempt.radiusMeters),
  });
  if (input.attempt.keyword.length > 0) {
    params.set('keyword', input.attempt.keyword);
  }

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return { ok: false };
  }

  const data = (await res.json()) as NearbySearchResponse;
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return { ok: false };
  }

  const raw = Array.isArray(data.results) ? data.results : [];
  const candidates = dedupeCandidatesByPlaceId(
    raw
      .map((item) => toCandidate(item))
      .filter((item): item is PlaceSearchCandidate => Boolean(item))
      .filter((item) => intersectsTypes(item.types, input.attempt.includedTypes))
  );

  return { ok: true, candidates };
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(withDebugMeta({ ok: false, error: 'missing_key', results: [] }, requestId));
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  if (!q) {
    return NextResponse.json(withDebugMeta({ ok: true, results: [] }, requestId));
  }

  const lat = parseNumber(searchParams.get('lat'));
  const lng = parseNumber(searchParams.get('lng'));
  const radius = parseNumber(searchParams.get('radius'));

  const params = new URLSearchParams({ query: q, key: apiKey });
  if (lat !== undefined && lng !== undefined) {
    params.set('location', `${lat},${lng}`);
  }
  if (radius !== undefined) {
    params.set('radius', String(Math.round(radius)));
  }

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(withDebugMeta({ ok: false, error: 'upstream_error', results: [] }, requestId));
    }

    const data = (await res.json()) as PlacesTextSearchResponse;
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return NextResponse.json(withDebugMeta({ ok: false, error: 'upstream_error', results: [] }, requestId));
    }

    const rawResults = Array.isArray(data.results) ? data.results : [];
    const results = rawResults
      .map(normalizePlaceToEntity)
      .filter((item): item is NormalizedPlaceEntity => Boolean(item));

    return NextResponse.json(withDebugMeta({ ok: true, results }, requestId));
  } catch {
    return NextResponse.json(withDebugMeta({ ok: false, error: 'upstream_error', results: [] }, requestId));
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(withDebugMeta({ ok: false, error: 'missing_key', results: [] }, crypto.randomUUID()));
  }

  let rawBody: unknown;
  try {
    rawBody = (await request.json()) as unknown;
  } catch {
    return NextResponse.json(withDebugMeta({ ok: false, error: 'invalid_body', results: [] }, crypto.randomUUID()), {
      status: 400,
    });
  }
  const parsed = parseNearbySearchInput(rawBody);
  const requestId = parsed.ok && parsed.requestId ? parsed.requestId : crypto.randomUUID();
  if (!parsed.ok) {
    return NextResponse.json(withDebugMeta({ ok: false, error: parsed.error, results: [] }, requestId), {
      status: 400,
    });
  }

  const cacheKey = toCacheKey({
    lat: parsed.lat,
    lng: parsed.lng,
    radiusMeters: parsed.radiusMeters,
    includedTypes: parsed.includedTypes,
    keyword: parsed.keyword,
    limit: parsed.limit,
  });
  const cached = nearbySearchCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(
      withDebugMeta({ ok: true, results: cached.results.slice(0, parsed.limit) }, requestId, {
        cacheHit: true,
        nearbySearch: cached.debug,
      })
    );
  }

  try {
    const attempts = buildSearchAttempts({
      radiusMeters: parsed.radiusMeters,
      keyword: parsed.keyword,
      includedTypes: parsed.includedTypes,
    });
    let aggregated: PlaceSearchCandidate[] = [];
    let finalDebugMeta: NearbySearchDebugMeta = {
      stepUsed: attempts[0]?.stepUsed ?? 'initial',
      finalRadiusMeters: attempts[0]?.radiusMeters ?? parsed.radiusMeters,
      keywordUsed: (attempts[0]?.keyword.length ?? parsed.keyword.length) > 0,
      typesUsed: attempts[0]?.includedTypes ?? parsed.includedTypes,
    };

    for (const attempt of attempts) {
      const stepResult = await fetchNearbyCandidates({
        apiKey,
        lat: parsed.lat,
        lng: parsed.lng,
        attempt,
      });
      if (!stepResult.ok) {
        return NextResponse.json(
          withDebugMeta({ ok: false, error: 'upstream_error', results: [] }, requestId, {
            cacheHit: false,
            nearbySearch: finalDebugMeta,
          }),
          { status: 502 }
        );
      }

      aggregated = dedupeCandidatesByPlaceId([...aggregated, ...stepResult.candidates]);
      finalDebugMeta = {
        stepUsed: attempt.stepUsed,
        finalRadiusMeters: attempt.radiusMeters,
        keywordUsed: attempt.keyword.length > 0,
        typesUsed: attempt.includedTypes,
      };
      if (aggregated.length >= parsed.limit) break;
    }

    const normalized = aggregated.slice(0, parsed.limit);
    nearbySearchCache.set(cacheKey, {
      results: normalized,
      debug: finalDebugMeta,
    });
    return NextResponse.json(
      withDebugMeta({ ok: true, results: normalized }, requestId, {
        cacheHit: false,
        nearbySearch: finalDebugMeta,
      })
    );
  } catch {
    return NextResponse.json(
      withDebugMeta({ ok: false, error: 'upstream_error', results: [] }, requestId, { cacheHit: false }),
      {
        status: 502,
      }
    );
  }
}
