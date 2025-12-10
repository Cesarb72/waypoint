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
  date: string;      // "2025-12-06"
  time: string;      // "19:30"
  dateTime?: string; // ISO string derived from date + time
  attendees?: string;
  notes?: string;
  stops: StoredStop[];
  location?: string; // e.g. waypoint / place name
};

const STORAGE_KEY = 'waypoint_plans_v1';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAllPlans(): StoredPlan[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredPlan[];
  } catch {
    return [];
  }
}

function writeAllPlans(plans: StoredPlan[]): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // ignore quota / private mode errors for now
  }
}

function computeDateTime(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const dt = new Date(`${date}T${time}`);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

/**
 * Return all saved plans.
 */
export function loadPlans(): StoredPlan[] {
  return readAllPlans();
}

/**
 * Lookup a single plan by id.
 */
export function loadPlanById(id: string): StoredPlan | null {
  if (!id) return null;
  const plans = readAllPlans();
  const match = plans.find((p) => p.id === id);
  return match ?? null;
}

/**
 * Insert or update a plan, and return the saved version.
 */
export function upsertPlan(input: {
  id?: string;
  title: string;
  date: string;
  time: string;
  attendees?: string;
  notes?: string;
  stops: StoredStop[];
  location?: string;
}): StoredPlan {
  const plans = readAllPlans();

  const id =
    input.id ||
    (typeof crypto !== 'undefined'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const dateTime = computeDateTime(input.date, input.time);

  const next: StoredPlan = {
    id,
    title: input.title,
    date: input.date,
    time: input.time,
    dateTime,
    attendees: input.attendees ?? '',
    notes: input.notes ?? '',
    stops: input.stops ?? [],
    location: input.location,
  };

  const existingIndex = plans.findIndex((p) => p.id === id);
  if (existingIndex >= 0) {
    plans[existingIndex] = next;
  } else {
    plans.unshift(next);
  }

  writeAllPlans(plans);
  return next;
}

/**
 * Delete a single plan by id.
 */
export function deletePlan(id: string): void {
  const plans = readAllPlans();
  const next = plans.filter((p) => p.id !== id);
  writeAllPlans(next);
}

/**
 * Clear all saved plans for this app.
 */
export function clearPlans(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
