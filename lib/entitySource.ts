// lib/entitySource.ts
import { ENTITIES, type Entity } from '@/data/entities';
import type { NormalizedPlaceEntity } from '@/lib/places/normalizePlaceToEntity';

export type FetchEntitiesOptions = {
  query?: string;
  lat?: number;
  lng?: number;
};

type PlacesSearchResponse = {
  ok?: boolean;
  results?: NormalizedPlaceEntity[];
};

const DEFAULT_PLACE_MOOD: Entity['mood'] = 'chill';

function toEntityFromPlace(place: NormalizedPlaceEntity): Entity {
  return {
    id: place.id,
    name: place.name,
    description: place.description,
    mood: DEFAULT_PLACE_MOOD,
    location: place.location,
    cost: place.cost,
    tags: place.tags,
    lat: place.lat,
    lng: place.lng,
  };
}

function mergeEntities(base: Entity[], extra: Entity[]): Entity[] {
  if (extra.length === 0) return base;

  const seenIds = new Set(base.map((entity) => entity.id));
  const seenNames = new Set(base.map((entity) => entity.name.toLowerCase()));
  const merged = base.slice();

  for (const entity of extra) {
    const nameKey = entity.name.trim().toLowerCase();
    if (seenIds.has(entity.id) || (nameKey && seenNames.has(nameKey))) {
      continue;
    }
    merged.push(entity);
    seenIds.add(entity.id);
    if (nameKey) seenNames.add(nameKey);
  }

  return merged;
}

async function fetchPlaces(
  query: string,
  options: FetchEntitiesOptions
): Promise<Entity[]> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options.lat !== undefined) params.set('lat', String(options.lat));
  if (options.lng !== undefined) params.set('lng', String(options.lng));

  const res = await fetch(`/api/places/search?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const json = (await res.json()) as PlacesSearchResponse;
  if (!json?.ok || !Array.isArray(json.results)) return [];

  return json.results.map(toEntityFromPlace);
}

/**
 * Fetch entities from the app API; falls back to local data if the request fails.
 */
export async function fetchEntities(options: FetchEntitiesOptions = {}): Promise<Entity[]> {
  const query = options.query?.trim() ?? '';
  const shouldFetchPlaces = query.length >= 2;
  let baseResults: Entity[] | null = null;

  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    // Lat/lng currently unused by the API, but keep them for future compatibility.
    if (options.lat !== undefined) params.set('lat', String(options.lat));
    if (options.lng !== undefined) params.set('lng', String(options.lng));

    const res = await fetch(`/api/entities?${params.toString()}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const json = (await res.json()) as { ENTITIES?: Entity[] };
      if (Array.isArray(json?.ENTITIES)) {
        baseResults = json.ENTITIES;
      }
    }
  } catch {
    // Fall back to local data
  }

  if (!baseResults) {
    if (!query) {
      baseResults = ENTITIES;
    } else {
      const q = query.toLowerCase();
      baseResults = ENTITIES.filter((entity) => {
        const haystack = `${entity.name} ${entity.description} ${entity.location ?? ''}`.toLowerCase();
        return haystack.includes(q);
      });
    }
  }

  if (shouldFetchPlaces) {
    try {
      const places = await fetchPlaces(query, options);
      if (places.length > 0) {
        return mergeEntities(baseResults, places);
      }
    } catch {
      // Ignore Places errors and return local results.
    }
  }

  return baseResults;
}
