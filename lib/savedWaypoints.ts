'use client';

import type { Entity, Mood } from '@/data/entities';

export type SavedWaypoint = {
  id: string;
  name: string;
  description?: string;
  mood?: Mood;
  location?: string;
  savedAt: string;
};

const STORAGE_KEY = 'waypoint_saved_v1';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadSavedWaypoints(): SavedWaypoint[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as SavedWaypoint[];

    return parsed
      .map((wp) => ({
        ...wp,
        savedAt: wp.savedAt ?? new Date().toISOString(),
      }))
      .sort((a, b) => {
        const aTime = new Date(a.savedAt).getTime();
        const bTime = new Date(b.savedAt).getTime();
        return bTime - aTime;
      });
  } catch {
    return [];
  }
}

export function saveWaypointFromEntity(entity: Entity): void {
  if (!isBrowser()) return;

  const existing = loadSavedWaypoints();

  const snapshot: SavedWaypoint = {
    id: entity.id,
    name: entity.name,
    description: (entity as any).description,
    mood: (entity as any).mood,
    location: (entity as any).location,
    savedAt: new Date().toISOString(),
  };

  const withoutCurrent = existing.filter((wp) => wp.id !== snapshot.id);
  const updated = [snapshot, ...withoutCurrent];

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function removeSavedWaypoint(id: string): void {
  if (!isBrowser()) return;

  const existing = loadSavedWaypoints();
  const filtered = existing.filter((wp) => wp.id !== id);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function isWaypointSaved(id: string): boolean {
  const existing = loadSavedWaypoints();
  return existing.some((wp) => wp.id === id);
}
