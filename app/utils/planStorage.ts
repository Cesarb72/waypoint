import { deserializePlan, serializePlan, type Plan } from '../plan-engine';
import type { Origin } from '../plan-engine/origin';

export type PlanIndexItem = {
  id: string;
  title: string;
  intent: string;
  audience?: string;
  encoded: string;
  updatedAt: string;
  isSaved: boolean;
  isShared?: boolean;
};

const STORAGE_KEY = 'waypoint.v2.plansIndex';
const SHARED_KEY = 'waypoint.v2.sharedIndex';
const ORIGIN_KEY = 'waypoint.origin.active';
const MAX_RECENT = 25;

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readIndex(): PlanIndexItem[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PlanIndexItem[];
  } catch {
    return [];
  }
}

function savePlansIndex(items: PlanIndexItem[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage failures
  }
}

function sortByUpdated(items: PlanIndexItem[]): PlanIndexItem[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function readSharedSet(): Set<string> {
  if (!hasLocalStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(SHARED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as string[]);
  } catch {
    return new Set();
  }
}

function saveSharedSet(ids: Set<string>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(SHARED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage failures
  }
}

export function purgeInvalidOrLegacyPlans(items: PlanIndexItem[]): PlanIndexItem[] {
  const filtered: PlanIndexItem[] = [];

  items.forEach((item) => {
    if (!item.encoded) return;
    try {
      const plan = deserializePlan(item.encoded);
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          '[originS] loaded plan JSON',
          JSON.stringify({
            id: plan?.id,
            title: plan?.title,
            originTop: (plan as any)?.origin ?? null,
            originMeta: (plan as any)?.meta?.origin ?? null,
          })
        );
      }
      if (plan.version === '2.0') {
        filtered.push(item);
      }
    } catch {
      // drop invalid/legacy items silently
    }
  });

  if (filtered.length !== items.length) {
    savePlansIndex(filtered);
  }

  return filtered;
}

export function getPlansIndex(): PlanIndexItem[] {
  const items = readIndex();
  return purgeInvalidOrLegacyPlans(items);
}

export function upsertRecentPlan(plan: Plan): PlanIndexItem {
  const updatedAt = new Date().toISOString();
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[originS] saving plan JSON',
      JSON.stringify({
        id: plan.id,
        title: plan.title,
        originTop: (plan as any)?.origin ?? null,
        originMeta: (plan as any)?.meta?.origin ?? null,
      })
    );
  }
  const encoded = (() => {
    try {
      return serializePlan(plan);
    } catch {
      return '';
    }
  })();

  const nextItem: PlanIndexItem = {
    id: plan.id,
    title: plan.title,
    intent: plan.intent,
    audience: plan.audience,
    encoded,
    updatedAt,
    isSaved: false,
    isShared: undefined,
  };

  const existing = readIndex();
  const existingIdx = existing.findIndex((item) => item.id === plan.id);
  if (existingIdx >= 0) {
    nextItem.isSaved = existing[existingIdx].isSaved;
    nextItem.isShared = existing[existingIdx].isShared;
    existing.splice(existingIdx, 1);
  }

  const merged = [nextItem, ...existing];
  const capped = merged.slice(0, MAX_RECENT);
  savePlansIndex(capped);
  return nextItem;
}

export function toggleSavedById(id: string): boolean {
  const items = readIndex();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  items[idx] = { ...items[idx], isSaved: !items[idx].isSaved, updatedAt: new Date().toISOString() };
  savePlansIndex(items);
  return true;
}

export function setSavedById(id: string, saved: boolean): boolean {
  const items = readIndex();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  if (items[idx].isSaved === saved) return true;
  items[idx] = { ...items[idx], isSaved: saved, updatedAt: new Date().toISOString() };
  savePlansIndex(items);
  return true;
}

export function getRecentPlans(): PlanIndexItem[] {
  return sortByUpdated(getPlansIndex());
}

export function getSavedPlans(): PlanIndexItem[] {
  return sortByUpdated(getPlansIndex().filter((item) => item.isSaved));
}

export function removePlanById(id: string): void {
  const items = readIndex();
  const next = items.filter((item) => item.id !== id);
  savePlansIndex(next);
}

// Backward compatibility alias
export function removePlanFromIndex(id: string): void {
  removePlanById(id);
}

export function markPlanShared(id: string): void {
  const set = readSharedSet();
  if (!id) return;
  set.add(id);
  saveSharedSet(set);
}

export function isPlanShared(id: string): boolean {
  if (!id) return false;
  const set = readSharedSet();
  return set.has(id);
}

export function saveOrigin(origin: Origin): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    // ignore storage failures
  }
}

export function loadOrigin(): Origin | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(ORIGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Origin;
    if (!parsed || typeof parsed.label !== 'string' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearOrigin(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(ORIGIN_KEY);
  } catch {
    // ignore storage failures
  }
}
