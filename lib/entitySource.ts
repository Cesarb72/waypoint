// lib/entitySource.ts

import type { Entity } from '@/data/entities';

export type EntityQueryOptions = {
  query?: string;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Data source for Waypoint entities.
 * Calls the internal /api/entities route with optional query + location.
 */
export async function fetchEntities(
  options: EntityQueryOptions = {}
): Promise<Entity[]> {
  const params = new URLSearchParams();

  if (options.query && options.query.trim().length > 0) {
    params.set('q', options.query.trim());
  }

  if (typeof options.lat === 'number' && typeof options.lng === 'number') {
    params.set('lat', String(options.lat));
    params.set('lng', String(options.lng));
  }

  const url = params.toString() ? `/api/entities?${params.toString()}` : '/api/entities';

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch entities: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { entities: Entity[] };

  return data.entities;
}
