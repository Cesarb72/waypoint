// lib/entitySource.ts

import { entities, type Entity } from '@/data/entities';

/**
 * Temporary data source for Waypoint entities.
 * Right now this just wraps the in-memory data.
 * Later, you can replace this with a real API call.
 */
export async function fetchEntities(): Promise<Entity[]> {
  // Simulate a tiny bit of network latency so loading states are real
  await new Promise((resolve) => setTimeout(resolve, 80));
  return entities;
}
