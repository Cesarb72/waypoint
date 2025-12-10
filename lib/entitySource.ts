// lib/entitySource.ts
import { ENTITIES as entities, type Entity } from '@/data/entities';


export type FetchEntitiesOptions = {
  query?: string;
  lat?: number;
  lng?: number;
};

/**
 * For the MVP we keep this dead simple:
 * - Ignore query/location
 * - Always return the full list of entities
 *
 * All the smart searching happens on the client in searchEntities().
 */
export async function fetchEntities(
  _opts: FetchEntitiesOptions
): Promise<Entity[]> {
  // Tiny artificial delay so it still "feels" like a fetch
  await new Promise((resolve) => setTimeout(resolve, 120));
  return entities;
}
