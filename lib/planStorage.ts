// lib/planStorage.ts
import type { PlanSignals } from '@/app/plan-engine';
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
  planSignals?: PlanSignals;
  // Legacy signal fields kept for backward compatibility.
  chosen?: boolean;
  chosenAt?: string | null;
  completed?: boolean | null;
  completedAt?: string | null;
  sentiment?: 'good' | 'meh' | 'bad' | null;
  feedbackNotes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type UpsertInput = Omit<StoredPlan, 'id' | 'createdAt' | 'updatedAt' | 'dateTime'> & {
  id?: string;
};

const STORAGE_KEY = 'waypoint.plans';
const DEFAULT_PLAN_SIGNALS: PlanSignals = {
  chosen: false,
  chosenAt: null,
  completed: false,
  completedAt: null,
  skipped: false,
  skippedAt: null,
  revisitedCount: 0,
  revisitedAt: [],
  sentiment: null,
  sentimentAt: undefined,
  feedbackNotes: null,
};

function enforceOutcomeExclusivity(signals: PlanSignals): PlanSignals {
  if (signals.completed) {
    return { ...signals, skipped: false };
  }
  if (signals.skipped) {
    return { ...signals, completed: false };
  }
  return signals;
}

function mapLegacySentiment(
  sentiment?: StoredPlan['sentiment'] | null
): PlanSignals['sentiment'] {
  if (!sentiment) return null;
  if (sentiment === 'good') return 'positive';
  if (sentiment === 'meh') return 'neutral';
  if (sentiment === 'bad') return 'negative';
  return null;
}

function normalizePlanSignals(plan: StoredPlan): PlanSignals {
  const legacySentiment = mapLegacySentiment(plan.sentiment);
  const normalized: PlanSignals = {
    ...DEFAULT_PLAN_SIGNALS,
    ...plan.planSignals,
    chosen: plan.planSignals?.chosen ?? plan.chosen ?? DEFAULT_PLAN_SIGNALS.chosen,
    chosenAt: plan.planSignals?.chosenAt ?? plan.chosenAt ?? DEFAULT_PLAN_SIGNALS.chosenAt,
    completed: plan.planSignals?.completed ?? plan.completed ?? DEFAULT_PLAN_SIGNALS.completed,
    completedAt: plan.planSignals?.completedAt ?? plan.completedAt ?? DEFAULT_PLAN_SIGNALS.completedAt,
    skipped: plan.planSignals?.skipped ?? DEFAULT_PLAN_SIGNALS.skipped,
    skippedAt: plan.planSignals?.skippedAt ?? DEFAULT_PLAN_SIGNALS.skippedAt,
    revisitedCount: plan.planSignals?.revisitedCount ?? DEFAULT_PLAN_SIGNALS.revisitedCount,
    revisitedAt: plan.planSignals?.revisitedAt ?? DEFAULT_PLAN_SIGNALS.revisitedAt,
    sentiment:
      plan.planSignals?.sentiment ??
      legacySentiment ??
      DEFAULT_PLAN_SIGNALS.sentiment,
    sentimentAt: plan.planSignals?.sentimentAt ?? DEFAULT_PLAN_SIGNALS.sentimentAt,
    feedbackNotes:
      plan.planSignals?.feedbackNotes ??
      plan.feedbackNotes ??
      DEFAULT_PLAN_SIGNALS.feedbackNotes,
  };
  return enforceOutcomeExclusivity(normalized);
}

function normalizeStoredPlan(plan: StoredPlan): StoredPlan {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit legacy fields
  const { chosen, chosenAt, completed, completedAt, sentiment, feedbackNotes, ...rest } = plan;
  return {
    ...rest,
    planSignals: normalizePlanSignals(plan),
  };
}

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
    return (parsed as StoredPlan[]).map((plan) => normalizeStoredPlan(plan));
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

  const merged: StoredPlan = {
    ...existing,
    ...input,
    id,
    createdAt,
    updatedAt: now,
  };
  const next = withDateTime(normalizeStoredPlan(merged));

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

export function updatePlanChosen(
  id: string,
  chosen: boolean,
  chosenAt: string | null
): StoredPlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((plan) => plan.id === id);
  if (idx === -1) return null;

  const existing = plans[idx];
  const nextSignals = {
    ...normalizePlanSignals(existing),
    chosen,
    chosenAt,
  };
  const next: StoredPlan = {
    ...normalizeStoredPlan(existing),
    planSignals: nextSignals,
  };

  plans[idx] = next;
  writePlans(plans);
  return withDateTime(next);
}

export function updatePlanOutcome(
  id: string,
  outcome: 'completed' | 'skipped' | 'clear'
): StoredPlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((plan) => plan.id === id);
  if (idx === -1) return null;

  const existing = plans[idx];
  const base = normalizePlanSignals(existing);
  const now = new Date().toISOString();
  const nextSignals =
    outcome === 'completed'
      ? {
          ...base,
          completed: true,
          completedAt: now,
          skipped: false,
          skippedAt: null,
        }
      : outcome === 'skipped'
      ? {
          ...base,
          completed: false,
          completedAt: null,
          skipped: true,
          skippedAt: now,
        }
      : {
          ...base,
          completed: false,
          completedAt: null,
          skipped: false,
          skippedAt: null,
        };
  const next: StoredPlan = {
    ...normalizeStoredPlan(existing),
    planSignals: nextSignals,
  };

  plans[idx] = next;
  writePlans(plans);
  return withDateTime(next);
}

export function updatePlanSentiment(
  id: string,
  sentiment: PlanSignals['sentiment']
): StoredPlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((plan) => plan.id === id);
  if (idx === -1) return null;

  const existing = plans[idx];
  const nextSignals = {
    ...normalizePlanSignals(existing),
    sentiment,
  };
  const next: StoredPlan = {
    ...normalizeStoredPlan(existing),
    planSignals: nextSignals,
  };

  plans[idx] = next;
  writePlans(plans);
  return withDateTime(next);
}

export function updatePlanFeedbackNotes(
  id: string,
  feedbackNotes: string | null
): StoredPlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((plan) => plan.id === id);
  if (idx === -1) return null;

  const existing = plans[idx];
  const nextSignals = {
    ...normalizePlanSignals(existing),
    feedbackNotes,
  };
  const next: StoredPlan = {
    ...normalizeStoredPlan(existing),
    planSignals: nextSignals,
  };

  plans[idx] = next;
  writePlans(plans);
  return withDateTime(next);
}

export function updatePlanRevisited(id: string, revisitedAt?: string): StoredPlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((plan) => plan.id === id);
  if (idx === -1) return null;

  const existing = plans[idx];
  const nextSignals = normalizePlanSignals(existing);
  const timestamp = revisitedAt ?? new Date().toISOString();
  const next: StoredPlan = {
    ...normalizeStoredPlan(existing),
    planSignals: {
      ...nextSignals,
      revisitedCount: nextSignals.revisitedCount + 1,
      revisitedAt: [...nextSignals.revisitedAt, timestamp],
    },
  };

  plans[idx] = next;
  writePlans(plans);
  return withDateTime(next);
}
