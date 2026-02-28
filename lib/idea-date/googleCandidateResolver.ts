import type { Stop } from '@/app/plan-engine/types';
import type { IdeaDateRole } from '@/lib/engine/idea-date/ideaDateConfig';
import type { IdeaDateSearchCandidate, SearchCandidates } from '@/lib/engine/idea-date/replacement';

type GoogleSearchResponse = {
  ok?: boolean;
  error?: string;
  results?: GoogleSearchResult[];
};

type GoogleSearchResult = {
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  types?: string[];
  priceLevel?: number;
  editorialSummary?: string;
};

type RoleTemplateKey = 'start' | 'main' | 'windDown' | 'generic';

type RoleQueryTemplate = {
  includedTypes: string[];
  keywords: string[];
  radiusBias: number;
  maxRadiusPerRole: number;
};

export const roleQueryTemplates: Record<RoleTemplateKey, RoleQueryTemplate> = {
  start: {
    includedTypes: ['cafe', 'coffee_shop', 'bakery', 'tea_house'],
    keywords: ['date', 'cafe', 'coffee'],
    radiusBias: 0.8,
    maxRadiusPerRole: 3000,
  },
  main: {
    includedTypes: ['art_gallery', 'museum', 'tourist_attraction', 'performing_arts_theater'],
    keywords: ['gallery', 'museum', 'experience'],
    radiusBias: 1.0,
    maxRadiusPerRole: 6000,
  },
  windDown: {
    includedTypes: ['dessert_shop', 'bar', 'cocktail_bar', 'tea_house'],
    keywords: ['dessert', 'lounge', 'bar'],
    radiusBias: 1.0,
    maxRadiusPerRole: 6000,
  },
  generic: {
    includedTypes: ['cafe', 'restaurant', 'art_gallery', 'dessert_shop'],
    keywords: ['date', 'spot'],
    radiusBias: 1.0,
    maxRadiusPerRole: 6000,
  },
};

const GENERIC_TEMPLATE = roleQueryTemplates.generic;

function normalizeType(value: string): string {
  return value.trim().toLowerCase();
}

function dedupeTypes(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeType(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function readExistingTypes(stop: Stop): string[] {
  const raw = Array.isArray(stop.placeLite?.types) ? stop.placeLite.types : [];
  return dedupeTypes(raw);
}

function readExistingKeyword(stop: Stop): string {
  const raw =
    (typeof stop.placeRef?.query === 'string' ? stop.placeRef.query : null) ??
    (typeof stop.resolve?.q === 'string' ? stop.resolve.q : null) ??
    '';
  return raw.trim().replace(/\s+/g, ' ');
}

function clampRadiusMeters(value: number): number {
  const rounded = Math.round(value);
  return Math.max(250, Math.min(8000, Number.isFinite(rounded) ? rounded : 1200));
}

function pickRoleTemplate(role: IdeaDateRole): RoleTemplateKey {
  if (role === 'start' || role === 'main' || role === 'windDown') return role;
  return 'generic';
}

function buildRoleShapedQuery(input: {
  role: IdeaDateRole;
  stop: Stop;
  radiusMeters: number;
}): {
  templateUsed: NonNullable<IdeaDateSearchCandidate['debugRoleQuery']>['templateUsed'];
  includedTypes: string[];
  keyword: string;
  radiusMeters: number;
} {
  const roleTemplateKey = pickRoleTemplate(input.role);
  const template = roleQueryTemplates[roleTemplateKey] ?? GENERIC_TEMPLATE;
  const existingTypes = readExistingTypes(input.stop);
  const existingKeyword = readExistingKeyword(input.stop);
  const templateKeywordPhrase = template.keywords.join(' ').trim() || GENERIC_TEMPLATE.keywords.join(' ').trim();
  const mergedTypes = dedupeTypes([...existingTypes, ...template.includedTypes]);
  const includedTypes = mergedTypes.length > 0 ? mergedTypes : [...GENERIC_TEMPLATE.includedTypes];
  const mergedKeyword = [existingKeyword, templateKeywordPhrase].join(' ').trim().replace(/\s+/g, ' ');
  const keyword = mergedKeyword.length > 0 ? mergedKeyword : GENERIC_TEMPLATE.keywords.join(' ');
  const existingRadius = Number.isFinite(input.radiusMeters) ? input.radiusMeters : 1200;
  const radiusMeters = clampRadiusMeters(
    Math.min(existingRadius * template.radiusBias, template.maxRadiusPerRole)
  );
  return {
    templateUsed: roleTemplateKey,
    includedTypes,
    keyword,
    radiusMeters,
  };
}

function normalizeCandidate(
  item: GoogleSearchResult,
  debugRoleQuery: IdeaDateSearchCandidate['debugRoleQuery']
): IdeaDateSearchCandidate | null {
  const placeId = item?.placeId?.trim() ?? '';
  const name = item?.name?.trim() ?? '';
  const lat = item?.lat;
  const lng = item?.lng;
  if (!placeId || !name) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return {
    placeId,
    name,
    lat,
    lng,
    types: Array.isArray(item?.types) ? item.types : [],
    priceLevel: typeof item?.priceLevel === 'number' ? item.priceLevel : undefined,
    editorialSummary:
      typeof item?.editorialSummary === 'string' && item.editorialSummary.trim().length > 0
        ? item.editorialSummary.trim()
        : undefined,
    debugRoleQuery,
  };
}

function dedupeByPlaceId(candidates: IdeaDateSearchCandidate[]): IdeaDateSearchCandidate[] {
  const deduped = new Map<string, IdeaDateSearchCandidate>();
  for (const candidate of candidates) {
    if (!deduped.has(candidate.placeId)) {
      deduped.set(candidate.placeId, candidate);
    }
  }
  return [...deduped.values()];
}

export const searchGoogleCandidates: SearchCandidates = async ({
  role,
  stop,
  radiusMeters,
  limit,
}) => {
  const latLng = stop.placeRef?.latLng;
  if (!latLng || !Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) {
    return [];
  }
  const shapedQuery = buildRoleShapedQuery({
    role,
    stop,
    radiusMeters,
  });
  const debugRoleQuery: NonNullable<IdeaDateSearchCandidate['debugRoleQuery']> = {
    templateUsed: shapedQuery.templateUsed,
    typesCount: shapedQuery.includedTypes.length,
    keywordUsed: shapedQuery.keyword.length > 0,
    radiusMeters: shapedQuery.radiusMeters,
  };

  try {
    const res = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lat: latLng.lat,
        lng: latLng.lng,
        radiusMeters: shapedQuery.radiusMeters,
        includedTypes: shapedQuery.includedTypes,
        keyword: shapedQuery.keyword,
        limit: Math.max(1, Math.min(20, limit)),
      }),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as GoogleSearchResponse;
    if (!data.ok || !Array.isArray(data.results)) return [];

    const normalized = data.results
      .map((item) => normalizeCandidate(item, debugRoleQuery))
      .filter((item): item is NonNullable<ReturnType<typeof normalizeCandidate>> => Boolean(item));
    return dedupeByPlaceId(normalized)
      .sort((a, b) => {
        const placeIdDelta = a.placeId.localeCompare(b.placeId);
        if (placeIdDelta !== 0) return placeIdDelta;
        const nameDelta = a.name.localeCompare(b.name);
        if (nameDelta !== 0) return nameDelta;
        return 0;
      })
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
};
