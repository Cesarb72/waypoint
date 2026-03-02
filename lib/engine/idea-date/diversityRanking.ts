import type { Stop } from '@/lib/core/planTypes';

export type DiversityPolicy = {
  diversity: {
    enabled: boolean;
    weight: number;
  };
  nearEqualArcDelta: number;
};

export type FamilyKeyAdapter<Candidate> = {
  classifyStopFamilyKey: (stop: Stop) => string;
  classifyCandidateFamilyKey: (candidate: Candidate) => string;
};

export type PlanFamilyCounts = Record<string, number>;

const DEFAULT_NEAR_EQUAL_ARC_DELTA = 0.015;
const MAX_DIVERSITY_WEIGHT = 0.01;

function sanitizeFamilyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'other';
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function disabledDiversityPolicy(): DiversityPolicy {
  return {
    diversity: {
      enabled: false,
      weight: 0,
    },
    nearEqualArcDelta: DEFAULT_NEAR_EQUAL_ARC_DELTA,
  };
}

export function normalizeDiversityPolicy(input?: Partial<DiversityPolicy>): DiversityPolicy {
  const enabled = Boolean(input?.diversity?.enabled);
  const weight = enabled
    ? clampFinite(input?.diversity?.weight ?? 0, 0, MAX_DIVERSITY_WEIGHT, 0)
    : 0;
  const nearEqualArcDelta = clampFinite(
    input?.nearEqualArcDelta ?? DEFAULT_NEAR_EQUAL_ARC_DELTA,
    0,
    1,
    DEFAULT_NEAR_EQUAL_ARC_DELTA
  );
  return {
    diversity: {
      enabled,
      weight,
    },
    nearEqualArcDelta,
  };
}

export function buildPlanFamilyCounts(
  stops: Stop[],
  classifyStopFamilyKey: (stop: Stop) => string
): PlanFamilyCounts {
  const counts: PlanFamilyCounts = {};
  for (const stop of stops) {
    const key = sanitizeFamilyKey(classifyStopFamilyKey(stop));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function classifyCandidateFamilyKey<Candidate>(
  adapter: FamilyKeyAdapter<Candidate>,
  candidate: Candidate
): string {
  return sanitizeFamilyKey(adapter.classifyCandidateFamilyKey(candidate));
}

export function computeDiversityPenalty(input: {
  policy: DiversityPolicy;
  planFamilyCounts: PlanFamilyCounts;
  candidateFamilyKey: string;
}): number {
  if (!input.policy.diversity.enabled) return 0;
  const familyCount = input.planFamilyCounts[input.candidateFamilyKey] ?? 0;
  return input.policy.diversity.weight * familyCount;
}

export function areArcDeltasNearEqual(a: number, b: number, nearEqualArcDelta: number): boolean {
  return Math.abs(a - b) <= nearEqualArcDelta;
}


