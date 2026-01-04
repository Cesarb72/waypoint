// lib/savedWaypoints.ts
import type { Entity, Mood, CostTag, ProximityTag, UseCaseTag } from '@/data/entities';

export type SavedWaypoint = {
  id: string;
  name: string;
  description?: string;
  location?: string;
  mood?: Mood;
  cost?: CostTag;
  proximity?: ProximityTag;
  useCases?: UseCaseTag[];
};

const STORAGE_KEY = 'waypoint.savedWaypoints';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readSaved(): SavedWaypoint[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedWaypoint[];
  } catch {
    return [];
  }
}

function writeSaved(items: SavedWaypoint[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore write errors
  }
}

export function loadSavedWaypoints(): SavedWaypoint[] {
  return readSaved();
}

export function saveWaypointFromEntity(entity: Entity): void {
  const items = readSaved();
  const existingIdx = items.findIndex((item) => item.id === entity.id);
  const next: SavedWaypoint = {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    location: entity.location,
    mood: entity.mood,
    cost: entity.cost,
    proximity: entity.proximity,
    useCases: entity.useCases,
  };

  if (existingIdx >= 0) {
    items[existingIdx] = next;
  } else {
    items.unshift(next);
  }

  writeSaved(items);
}

export function removeSavedWaypoint(id: string): void {
  const items = readSaved().filter((item) => item.id !== id);
  writeSaved(items);
}
