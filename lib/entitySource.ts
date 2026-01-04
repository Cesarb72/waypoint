// lib/entitySource.ts
import { ENTITIES, type Entity } from '@/data/entities';

export type FetchEntitiesOptions = {
  query?: string;
  lat?: number;
  lng?: number;
};

/**
 * Fetch entities from the app API; falls back to local data if the request fails.
 */
export async function fetchEntities(options: FetchEntitiesOptions = {}): Promise<Entity[]> {
  const query = options.query?.trim() ?? '';

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
        return json.ENTITIES;
      }
    }
  } catch {
    // Fall back to local data
  }

  if (!query) return ENTITIES;

  const q = query.toLowerCase();
  return ENTITIES.filter((entity) => {
    const haystack = `${entity.name} ${entity.description} ${entity.location ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}
