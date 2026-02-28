import type { Plan } from '@/app/plan-engine/types';
import { PLAN_VERSION } from '@/app/plan-engine/types';

const IDEA_DATE_STORAGE_KEY = 'waypoint.ideaDate.plans.v1';
const memoryStore = new Map<string, Plan>();

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clonePlan(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan);
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

function readStorageMap(): Record<string, Plan> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(IDEA_DATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, Plan>;
  } catch {
    return {};
  }
}

function writeStorageMap(next: Record<string, Plan>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(IDEA_DATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage write failures
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idea_date_${Math.random().toString(36).slice(2, 10)}`;
}

export function createPlan(_args: { lens: 'idea-date' }): string {
  const id = generateId();
  const blankPlan: Plan = {
    id,
    version: PLAN_VERSION,
    title: 'Idea-Date',
    intent: '',
    audience: '',
    stops: [],
    meta: {
      mode: 'default',
      ideaDate: {
        vibeId: 'first_date_low_pressure',
        travelMode: 'walk',
      },
    },
  };
  setPlan(id, blankPlan);
  return id;
}

export function getPlan(id: string): Plan | null {
  if (!id) return null;
  if (memoryStore.has(id)) {
    return clonePlan(memoryStore.get(id) as Plan);
  }
  const map = readStorageMap();
  const stored = map[id];
  if (!stored) return null;
  memoryStore.set(id, clonePlan(stored));
  return clonePlan(stored);
}

export function setPlan(id: string, plan: Plan): void {
  if (!id) return;
  const next = clonePlan({ ...plan, id });
  memoryStore.set(id, next);
  const map = readStorageMap();
  map[id] = next;
  writeStorageMap(map);
}
