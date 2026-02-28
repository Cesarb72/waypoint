import type { Plan, PlanSignals } from './types';

export type ReflectionSummary = {
  // Saved plans ordered by revisit count; no recommendation implied.
  mostRevisited: Plan[];
  // Explicitly chosen but not completed; not a progress judgment.
  chosenNotCompleted: Plan[];
  // Explicitly completed, ordered by completion timestamp; not a quality signal.
  recentlyCompleted: Plan[];
  // Optional: plans ordered by latest explicit signal timestamp or updated time.
  recentlyTouched: Plan[];
};

type ReflectionOptions = {
  includeRecentlyTouched?: boolean;
};

const DEFAULT_SIGNALS: PlanSignals = {
  chosen: false,
  chosenAt: null,
  completed: false,
  completedAt: null,
  revisitedCount: 0,
  revisitedAt: [],
  sentiment: null,
  sentimentAt: undefined,
  feedbackNotes: null,
};

function withSignals(plan: Plan): PlanSignals {
  return {
    ...DEFAULT_SIGNALS,
    ...(plan.planSignals ?? {}),
  };
}

function asTime(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getTouchTime(plan: Plan, signals: PlanSignals): number {
  const chosenAt = asTime(signals.chosenAt);
  const completedAt = asTime(signals.completedAt);
  const updatedAt = asTime(plan.metadata?.lastUpdated);
  return Math.max(chosenAt, completedAt, updatedAt);
}

export function buildReflectionSummary(
  plans: Plan[],
  opts?: ReflectionOptions
): ReflectionSummary {
  const includeRecentlyTouched = opts?.includeRecentlyTouched ?? true;
  const savedPlans = plans.filter((plan) => Boolean(plan?.id));

  const mostRevisited = [...savedPlans].sort((a, b) => {
    const aSignals = withSignals(a);
    const bSignals = withSignals(b);
    return bSignals.revisitedCount - aSignals.revisitedCount;
  });

  const chosenNotCompleted = savedPlans.filter((plan) => {
    const signals = withSignals(plan);
    return signals.chosen && !signals.completed;
  });

  const recentlyCompleted = savedPlans
    .filter((plan) => withSignals(plan).completed)
    .sort((a, b) => {
      const aSignals = withSignals(a);
      const bSignals = withSignals(b);
      return asTime(bSignals.completedAt) - asTime(aSignals.completedAt);
    });

  const recentlyTouched = includeRecentlyTouched
    ? [...savedPlans].sort((a, b) => {
        const aSignals = withSignals(a);
        const bSignals = withSignals(b);
        return getTouchTime(b, bSignals) - getTouchTime(a, aSignals);
      })
    : [];

  return {
    mostRevisited,
    chosenNotCompleted,
    recentlyCompleted,
    recentlyTouched,
  };
}
