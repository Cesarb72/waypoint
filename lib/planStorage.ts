// lib/planStorage.ts
export type StoredStop = {
  id: string;
  label: string;
  notes?: string;
  time?: string;
};

export type StoredPlan = {
  id: string;
  title: string;
  date?: string;
  time?: string;
  dateTime?: string;
  attendees?: string;
  notes?: string;
  stops?: StoredStop[];
  location?: string;
  createdAt?: string;
  updatedAt?: string;
};

type UpsertInput = Omit<StoredPlan, 'id' | 'createdAt' | 'updatedAt' | 'dateTime'> & {
  id?: string;
};

const STORAGE_KEY = 'waypoint.plans';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readPlans(): StoredPlan[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredPlan[];
  } catch {
    return [];
  }
}

function writePlans(plans: StoredPlan[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // ignore storage failures
  }
}

function withDateTime(plan: StoredPlan): StoredPlan {
  if (plan.date && plan.time) {
    return { ...plan, dateTime: `${plan.date}T${plan.time}` };
  }
  return plan;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `plan_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPlans(): StoredPlan[] {
  const plans = readPlans().map(withDateTime);
  return plans.sort((a, b) => {
    const aTime = new Date(a.updatedAt ?? '').getTime() || 0;
    const bTime = new Date(b.updatedAt ?? '').getTime() || 0;
    return bTime - aTime;
  });
}

export function loadPlanById(id: string): StoredPlan | null {
  const plans = readPlans();
  const found = plans.find((p) => p.id === id);
  return found ? withDateTime(found) : null;
}

export function upsertPlan(input: UpsertInput): StoredPlan {
  const plans = readPlans();
  const now = new Date().toISOString();
  const id = input.id ?? generateId();
  const existingIdx = plans.findIndex((p) => p.id === id);
  const existing = existingIdx >= 0 ? plans[existingIdx] : null;
  const createdAt = existing?.createdAt ?? now;

  const next: StoredPlan = withDateTime({
    ...existing,
    ...input,
    id,
    createdAt,
    updatedAt: now,
  });

  if (existingIdx >= 0) {
    plans[existingIdx] = next;
  } else {
    plans.unshift(next);
  }

  writePlans(plans);
  return next;
}

export function deletePlan(id: string): void {
  const plans = readPlans().filter((plan) => plan.id !== id);
  writePlans(plans);
}

export function clearPlans(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}
