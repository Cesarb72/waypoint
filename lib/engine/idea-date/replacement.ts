import type { PlaceLite, PlaceRef, Plan, Stop } from '@/app/plan-engine/types';
import {
  type IdeaDateRole,
  type IdeaDateVibeId,
} from './ideaDateConfig';
import { buildArcModel } from './arcModel';
import { computeArcContributionByStop } from './arcContribution';
import { evaluateConstraints } from './constraints';
import { evaluateIdeaDateJourney } from './evaluate';
import { hydrateIdeaDateStopProfile } from './ideaDateBaselineResolver';
import { applyOverridesToProfile } from './ideaDateOverrides';
import { applyIdeaDatePatchOps } from './patchOps';
import { recomputeIdeaDateLive, type IdeaDateComputedMetrics } from './recompute';
import {
  buildIdeaDateRefineTiltProfile,
  type IdeaDatePrefTilt,
  type IdeaDateRefineWeightMap,
  type IdeaDateRefineTiltProfile,
} from './refineTilt';
import type { IdeaDateMode } from '@/lib/idea-date/modePolicy';
import { toScore100, computeStopIntentScore } from './scoring';
import { parseIdeaDatePlanProfile, IdeaDateStopProfileSchema, type IdeaDateStopProfile } from './schemas';
import {
  areArcDeltasNearEqual,
  buildPlanFamilyCounts,
  classifyCandidateFamilyKey,
  computeDiversityPenalty,
  disabledDiversityPolicy,
  normalizeDiversityPolicy,
  type DiversityPolicy,
  type FamilyKeyAdapter,
  type PlanFamilyCounts,
} from './diversityRanking';
import type { IdeaDateSuggestion } from './types';

const ADAPTIVE_RADIUS_KM = [0.5, 1.0, 2.0] as const;
const MAX_REPLACEMENTS = 2;
const MAX_EXTERNAL_LIMIT = 8;
const MAX_CANDIDATES_PER_RADIUS = 16;
const MIN_EXTERNAL_CANDIDATES = 3;
const MIN_SIGNAL_EPS = 0.001;
const MIN_ARC_IMPROVEMENT_DELTA = 0.01;
const MAX_JOURNEY_SCORE_DROP = -0.01;
const REPAIR_MAX_JOURNEY_DROP_ONE_VIOLATION_REDUCED = -0.03;
const REPAIR_MAX_JOURNEY_DROP_TWO_VIOLATIONS_REDUCED = -0.05;
const REORDER_REPAIR_MAX_PERMUTATION_STOPS = 5;
const REORDER_REPAIR_MIN_ARC_IMPROVEMENT_DELTA = MIN_SIGNAL_EPS;
export const MAX_REPLACEMENT_CANDIDATES_SEEN_PRIMARY = 60;
export const MAX_REPLACEMENT_CANDIDATES_SEEN_REPAIR = 90;
export const MAX_REORDER_REPAIR_EVALUATED = 12;
const includeDevQueryDebug = process.env.NODE_ENV !== 'production';
const ROLE_TYPE_HINTS: Record<IdeaDateRole, string[]> = {
  start: ['cafe', 'coffee_shop', 'restaurant', 'tea_house', 'bakery'],
  main: [
    'art_gallery',
    'museum',
    'tourist_attraction',
    'amusement_center',
    'cultural_center',
    'theater',
    'performing_arts_theater',
    'historical_landmark',
    'park',
  ],
  windDown: ['dessert_shop', 'bar', 'cocktail_bar', 'tea_house'],
  flex: [],
};
type MaybePromise<T> = T | Promise<T>;
type ReplacementPassUsed = 'primary' | 'repair' | 'reorder_repair';
type ReplacementCandidatePass = 'primary' | 'repair';
type CandidateConstraintCounts = {
  hardCount: number;
  softCount: number;
};

type CandidateOutcome = {
  candidate: IdeaDatePlaceCandidate;
  computed: IdeaDateComputedMetrics;
  patchOps: IdeaDateSuggestion['patchOps'];
  deltaJourney: number;
  deltaArc: number;
  deltaHardConstraints: number;
  deltaSoftConstraints: number;
  hardConstraintCountAfter: number;
  softConstraintCountAfter: number;
  deltaFriction: number;
  deltaViolations: number;
  candidateFamilyKey: string;
  diversityPenalty: number;
  adjustedArcScore: number;
  planFamilyCounts: PlanFamilyCounts;
  passUsed: ReplacementCandidatePass;
};

type ReorderRepairOutcome = {
  id: string;
  finalOrderSignature: string;
  patchOps: IdeaDateSuggestion['patchOps'];
  computed: IdeaDateComputedMetrics;
  deltaJourney: number;
  deltaArc: number;
  deltaHardConstraints: number;
  deltaSoftConstraints: number;
  hardConstraintCountAfter: number;
  softConstraintCountAfter: number;
  deltaFriction: number;
  deltaViolations: number;
  subjectStopId?: string;
};

export type IdeaDateRoleQueryDebug = {
  templateUsed: 'start' | 'main' | 'windDown' | 'generic';
  typesCount: number;
  keywordUsed: boolean;
  radiusMeters: number;
};

export type IdeaDateDiversityDebug = {
  candidateFamilyKey: string;
  planFamilyCounts: Record<string, number>;
  diversityPenalty: number;
  ranking: {
    deltaArc: number;
    adjustedArc: number;
    nearEqualArcDelta: number;
    weight: number;
  };
};

export type IdeaDatePlaceCandidate = {
  id: string;
  name: string;
  placeRef?: PlaceRef;
  placeLite?: PlaceLite;
  debugRoleQuery?: IdeaDateRoleQueryDebug;
};

export type IdeaDateSearchCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types?: string[];
  priceLevel?: number;
  editorialSummary?: string;
  debugRoleQuery?: IdeaDateRoleQueryDebug;
};

export type SearchCandidates = (args: {
  role: IdeaDateRole;
  stop: Stop;
  plan: Plan;
  radiusMeters: number;
  vibeId: IdeaDateVibeId;
  limit: number;
}) => MaybePromise<IdeaDateSearchCandidate[]>;

export type SearchPlacesNear = (args: {
  stop: Stop;
  radiusKm: number;
  limit: number;
}) => MaybePromise<IdeaDatePlaceCandidate[]>;

export type RecomputeCandidatePlan = (plan: Plan) => MaybePromise<{
  computed: IdeaDateComputedMetrics;
}>;

export type IdeaDateReplacementRankingOptions = {
  diversityPolicy?: Partial<DiversityPolicy>;
  familyKeyAdapter?: FamilyKeyAdapter<IdeaDatePlaceCandidate>;
};

export const IDEA_DATE_DISCARD_REASON_ORDER = [
  'duplicate_placeId',
  'invariant_violation',
  'increases_hard_constraints',
  'no_arc_improvement',
  'worsens_journeyScore',
  'increases_violations',
  'role_mismatch',
  'missing_stop_profile',
] as const;

export type IdeaDateDiscardReason = (typeof IDEA_DATE_DISCARD_REASON_ORDER)[number];

export type IdeaDateRefineStats = {
  candidateCount: number;
  evaluatedCount: number;
  discardedCount: number;
  suggestionsGenerated: number;
  discardCounts: Record<IdeaDateDiscardReason, number>;
  debugPlanPrefTilt?: IdeaDatePrefTilt;
  debugModeDefaultPrefTilt?: IdeaDatePrefTilt;
  debugEffectivePrefTilt?: IdeaDatePrefTilt;
  // Backward-compatible alias for debugEffectivePrefTilt.
  debugPrefTilt?: IdeaDatePrefTilt;
  debugTiltWeightMap?: IdeaDateRefineWeightMap;
  debugTiltsApplied?: boolean;
  debugRoleQuery?: IdeaDateRoleQueryDebug;
  debugDiversity?: IdeaDateDiversityDebug;
  debugPlanFamilyCounts?: Record<string, number>;
  debugPassUsed?: ReplacementPassUsed;
  debugRepairThresholds?: {
    maxJourneyDropOneViolationReduced: number;
    maxJourneyDropTwoViolationsReduced: number;
  };
  debugReorderRepair?: {
    candidatesEvaluated: number;
    candidatesKept: number;
    topDeltaArc?: number;
    topDeltaJourney?: number;
    topDeltaViolations?: number;
  };
  debugTopConstraintDelta?: {
    baselineHardCount: number;
    baselineSoftCount: number;
    afterHardCount: number;
    afterSoftCount: number;
    hardDelta: number;
    softDelta: number;
  };
  debugTiming?: {
    totalRefineMs: number;
    resolverFetchMs: number;
    candidatePrepMs: number;
    candidateEvaluationMs: number;
    rankingMs: number;
  };
  debugPassBreakdown?: {
    primaryReplacement: {
      seen: number;
      kept: number;
      discarded: number;
      discardCounts: Record<IdeaDateDiscardReason, number>;
    };
    repairReplacement: {
      seen: number;
      kept: number;
      discarded: number;
      discardCounts: Record<IdeaDateDiscardReason, number>;
    };
    reorderRepair: {
      evaluated: number;
      kept: number;
      topDeltaArc?: number;
      topDeltaJourney?: number;
      topDeltaViolations?: number;
    };
  };
};

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function elapsedMs(startMs: number): number {
  const elapsed = nowMs() - startMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.round(elapsed);
}

function defaultSearchCandidates(): IdeaDateSearchCandidate[] {
  return [];
}

function defaultSearchPlacesNear(): IdeaDatePlaceCandidate[] {
  return [];
}

function defaultFamilyKeyAdapter(): FamilyKeyAdapter<IdeaDatePlaceCandidate> {
  return {
    classifyStopFamilyKey: () => 'other',
    classifyCandidateFamilyKey: () => 'other',
  };
}

function summarizeFamilyCounts(counts: PlanFamilyCounts): Record<string, number> {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  const sorted: Record<string, number> = {};
  for (const [key, value] of entries) {
    sorted[key] = value;
  }
  return sorted;
}

function clampRoleQueryRadius(radiusMeters: number): number {
  const rounded = Math.round(radiusMeters);
  const finite = Number.isFinite(rounded) ? rounded : 1200;
  return Math.max(250, Math.min(8000, finite));
}

function toRoleTemplateUsed(role: IdeaDateRole): IdeaDateRoleQueryDebug['templateUsed'] {
  if (role === 'start' || role === 'main' || role === 'windDown') return role;
  return 'generic';
}

function fallbackTypesCountByTemplate(templateUsed: IdeaDateRoleQueryDebug['templateUsed']): number {
  if (templateUsed === 'start') return 5;
  if (templateUsed === 'main') return 4;
  if (templateUsed === 'windDown') return 4;
  return 4;
}

function createFallbackRoleQueryDebug(role: IdeaDateRole, radiusKm: number): IdeaDateRoleQueryDebug {
  const templateUsed = toRoleTemplateUsed(role);
  return {
    templateUsed,
    typesCount: fallbackTypesCountByTemplate(templateUsed),
    keywordUsed: true,
    radiusMeters: clampRoleQueryRadius(radiusKm * 1000),
  };
}

function getStopProfile(stop: Stop): IdeaDateStopProfile | null {
  const parsed = IdeaDateStopProfileSchema.safeParse(stop.ideaDate);
  return parsed.success ? parsed.data : null;
}

function inferRoleFromIndex(index: number, stopCount: number): IdeaDateRole {
  if (index <= 0) return 'start';
  if (index >= stopCount - 1) return 'windDown';
  return 'main';
}

function resolveTargetRole(input: {
  stop: Stop;
  index: number;
  stopCount: number;
  stopProfile: IdeaDateStopProfile | null;
}): IdeaDateRole {
  if (input.stopProfile) return input.stopProfile.role;
  if (input.stop.role === 'anchor') return 'start';
  if (input.stop.role === 'support') return 'main';
  return inferRoleFromIndex(input.index, input.stopCount);
}

function mockCandidatesFromPlan(plan: Plan, skipStopId: string): IdeaDatePlaceCandidate[] {
  const candidates = (plan.stops ?? [])
    .filter((stop) => stop.id !== skipStopId)
    .map((stop) => {
      const placeId = stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? stop.id;
      return {
        id: `mock:${placeId}`,
        name: stop.name,
        placeRef: stop.placeRef,
        placeLite: stop.placeLite,
      };
    });
  const deduped = new Map<string, IdeaDatePlaceCandidate>();
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    if (!deduped.has(candidate.id)) deduped.set(candidate.id, candidate);
  }
  return [...deduped.values()];
}

function readStopPlaceId(stop: Stop): string | null {
  const fromRef = stop.placeRef?.placeId?.trim();
  if (fromRef) return fromRef;
  const fromLite = stop.placeLite?.placeId?.trim();
  if (fromLite) return fromLite;
  return null;
}

function readCandidatePlaceId(candidate: IdeaDatePlaceCandidate): string | null {
  const fromRef = candidate.placeRef?.placeId?.trim();
  if (fromRef) return fromRef;
  const fromLite = candidate.placeLite?.placeId?.trim();
  if (fromLite) return fromLite;
  return null;
}

function createEmptyRefineStats(): IdeaDateRefineStats {
  return {
    candidateCount: 0,
    evaluatedCount: 0,
    discardedCount: 0,
    suggestionsGenerated: 0,
    discardCounts: {
      duplicate_placeId: 0,
      invariant_violation: 0,
      increases_hard_constraints: 0,
      no_arc_improvement: 0,
      worsens_journeyScore: 0,
      increases_violations: 0,
      role_mismatch: 0,
      missing_stop_profile: 0,
    },
    debugPlanFamilyCounts: undefined,
  };
}

function createEmptyDiscardCounts(): Record<IdeaDateDiscardReason, number> {
  return {
    duplicate_placeId: 0,
    invariant_violation: 0,
    increases_hard_constraints: 0,
    no_arc_improvement: 0,
    worsens_journeyScore: 0,
    increases_violations: 0,
    role_mismatch: 0,
    missing_stop_profile: 0,
  };
}

function incrementDiscardReason(stats: IdeaDateRefineStats, reason: IdeaDateDiscardReason): void {
  stats.discardedCount += 1;
  stats.discardCounts[reason] += 1;
}

function isPlanDerivedCandidate(candidate: IdeaDatePlaceCandidate): boolean {
  return candidate.id.startsWith('mock:') || candidate.id.startsWith('swap:');
}

function candidateMatchesRole(candidate: IdeaDatePlaceCandidate, role: IdeaDateRole): boolean {
  if (role === 'flex') return true;
  const hints = ROLE_TYPE_HINTS[role];
  if (hints.length === 0) return true;
  const rawTypes = candidate.placeLite?.types ?? [];
  if (rawTypes.length === 0) return true;
  const candidateTypes = new Set(rawTypes.map((entry) => entry.toLowerCase()));
  return hints.some((hint) => candidateTypes.has(hint));
}

function isBetterArcFirstCandidate(
  next: CandidateOutcome,
  best: CandidateOutcome,
  diversityPolicy: DiversityPolicy
): boolean {
  if (
    !areArcDeltasNearEqual(next.deltaArc, best.deltaArc, diversityPolicy.nearEqualArcDelta)
    && next.deltaArc !== best.deltaArc
  ) {
    return next.deltaArc > best.deltaArc;
  }
  if (next.deltaHardConstraints !== best.deltaHardConstraints) {
    return next.deltaHardConstraints > best.deltaHardConstraints;
  }
  if (next.deltaSoftConstraints !== best.deltaSoftConstraints) {
    return next.deltaSoftConstraints > best.deltaSoftConstraints;
  }
  if (next.deltaViolations !== best.deltaViolations) return next.deltaViolations > best.deltaViolations;
  if (next.deltaFriction !== best.deltaFriction) return next.deltaFriction > best.deltaFriction;
  if (next.deltaJourney !== best.deltaJourney) return next.deltaJourney > best.deltaJourney;
  return next.candidate.id.localeCompare(best.candidate.id) < 0;
}

function toExternalCandidate(candidate: IdeaDateSearchCandidate): IdeaDatePlaceCandidate | null {
  const placeId = candidate.placeId?.trim();
  const name = candidate.name?.trim();
  if (!placeId || !name) return null;
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return null;
  return {
    id: `search:${placeId}`,
    name,
    placeRef: {
      provider: 'google',
      placeId,
      latLng: { lat: candidate.lat, lng: candidate.lng },
      label: name,
    },
    placeLite: {
      placeId,
      name,
      types: candidate.types ?? [],
      priceLevel: candidate.priceLevel,
      editorialSummary: candidate.editorialSummary,
    },
    debugRoleQuery: candidate.debugRoleQuery,
  };
}

async function resolveExternalCandidates(input: {
  searchCandidates: SearchCandidates;
  searchPlacesNear: SearchPlacesNear;
  role: IdeaDateRole;
  stop: Stop;
  plan: Plan;
  radiusKm: number;
  vibeId: IdeaDateVibeId;
}): Promise<IdeaDatePlaceCandidate[]> {
  const radiusMeters = Math.round(input.radiusKm * 1000);

  let external: IdeaDatePlaceCandidate[] = [];
  try {
    const rawCandidates = await input.searchCandidates({
      role: input.role,
      stop: input.stop,
      plan: input.plan,
      radiusMeters,
      vibeId: input.vibeId,
      limit: MAX_EXTERNAL_LIMIT,
    });
    external = rawCandidates
      .map((candidate) => toExternalCandidate(candidate))
      .filter((candidate): candidate is IdeaDatePlaceCandidate => Boolean(candidate));
  } catch {
    external = [];
  }

  if (external.length === 0) {
    try {
      external = await input.searchPlacesNear({
        stop: input.stop,
        radiusKm: input.radiusKm,
        limit: MAX_EXTERNAL_LIMIT,
      });
    } catch {
      external = [];
    }
  }

  return dedupeCandidates(external);
}

function computePainScore(
  plan: Plan,
  computed: IdeaDateComputedMetrics,
  evaluation: ReturnType<typeof evaluateIdeaDateJourney>
): Array<{ index: number; score: number }> {
  const planProfile = parseIdeaDatePlanProfile(plan.meta?.ideaDate);
  const stops = plan.stops ?? [];
  return stops.map((stop, index) => {
    const profile = getStopProfile(stop);
    if (!profile) return { index, score: 0 };
    const intentScore = computeStopIntentScore(
      profile.intentVector,
      planProfile.vibeTarget,
      planProfile.vibeImportance
    );
    const prevTransition = evaluation.travelEdges[index - 1]?.minutes ?? 0;
    const nextTransition = evaluation.travelEdges[index]?.minutes ?? 0;
    const transitionPain = Math.min(1, (Math.max(prevTransition, 12) + Math.max(nextTransition, 12) - 24) / 24);
    const score = (1 - intentScore) * 0.7 + transitionPain * 0.3 + computed.frictionPenalty * 0.1;
    return { index, score };
  });
}

function computeRepairTargetStops(input: {
  plan: Plan;
  computed: IdeaDateComputedMetrics;
  evaluation: ReturnType<typeof evaluateIdeaDateJourney>;
}): Array<{ index: number; score: number }> {
  const stopCount = input.plan.stops.length;
  const baseScores = computePainScore(input.plan, input.computed, input.evaluation);
  const baseByIndex = new Map<number, number>(baseScores.map((entry) => [entry.index, entry.score]));
  const violationTypes = new Set(input.computed.violations.map((entry) => entry.type));
  const peakIndex = input.computed.components.fatigue.actualPeakIndex;
  const denominator = Math.max(1, stopCount - 1);

  return input.plan.stops
    .map((_, index) => {
      const prevTransition = input.evaluation.travelEdges[index - 1]?.minutes ?? 0;
      const nextTransition = input.evaluation.travelEdges[index]?.minutes ?? 0;
      const transitionLoad = Math.max(0, prevTransition + nextTransition);
      const transitionPressure = Math.min(1, transitionLoad / 36);
      const peakProximity = 1 - Math.min(1, Math.abs(index - peakIndex) / denominator);
      let score = baseByIndex.get(index) ?? 0;
      if (violationTypes.has('friction_high') || violationTypes.has('travel_edge_high')) {
        score += transitionPressure * 1.2;
      }
      if (violationTypes.has('double_peak') || violationTypes.has('fatigue_high')) {
        score += peakProximity * 0.9;
      }
      if (violationTypes.has('no_taper') && index === stopCount - 1) {
        score += 1.0;
      }
      return { index, score };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    });
}

function readEnergySeriesFromPlan(plan: Plan): number[] | null {
  const series: number[] = [];
  for (const stop of plan.stops ?? []) {
    const parsed = IdeaDateStopProfileSchema.safeParse(stop.ideaDate);
    if (!parsed.success) return null;
    series.push(parsed.data.energyLevel);
  }
  return series;
}

function resolveConstraintRoleForStop(stop: Stop, index: number, stopCount: number): IdeaDateRole {
  const stopProfile = getStopProfile(stop);
  if (stopProfile) return stopProfile.role;
  return inferRoleFromIndex(index, stopCount);
}

function evaluateConstraintCountsForCandidatePlan(input: {
  candidatePlan: Plan;
  candidateEvaluation: ReturnType<typeof evaluateIdeaDateJourney>;
}): CandidateConstraintCounts {
  const stopCount = input.candidatePlan.stops.length;
  const energySeries = readEnergySeriesFromPlan(input.candidatePlan);
  const arcNoTaper = energySeries
    ? buildArcModel(energySeries).flags.noTaper
    : false;
  const constraints = evaluateConstraints({
    stops: input.candidatePlan.stops.map((stop, index) => ({
      id: stop.id,
      role: resolveConstraintRoleForStop(stop, index, stopCount),
      types: stop.placeLite?.types,
    })),
    travelEdges: input.candidateEvaluation.travelEdges.map((edge) => ({ minutes: edge.minutes })),
    arc: { noTaper: arcNoTaper },
  });
  return {
    hardCount: constraints.hardCount,
    softCount: constraints.softCount,
  };
}

function computeRefineArcContributionTotal(input: {
  plan: Plan;
  computed: IdeaDateComputedMetrics;
  evaluation: ReturnType<typeof evaluateIdeaDateJourney>;
  tiltProfile: IdeaDateRefineTiltProfile;
}): number {
  if (!input.tiltProfile.applied || !input.tiltProfile.arcContributionOptions) {
    return input.computed.arcContributionTotal;
  }
  const energySeries = readEnergySeriesFromPlan(input.plan);
  if (!energySeries || energySeries.length !== (input.plan.stops ?? []).length) {
    return input.computed.arcContributionTotal;
  }
  const weightedArcContribution = computeArcContributionByStop(
    {
      energySeries,
      fatigue: input.computed.components.fatigue,
      friction: input.computed.components.friction,
      transitionMinutes: input.evaluation.travelEdges.map((edge) => edge.minutes),
    },
    input.tiltProfile.arcContributionOptions
  );
  return weightedArcContribution.total;
}

function resolveRepairJourneyDropThreshold(deltaViolations: number): number {
  if (deltaViolations >= 2) return REPAIR_MAX_JOURNEY_DROP_TWO_VIOLATIONS_REDUCED;
  if (deltaViolations >= 1) return REPAIR_MAX_JOURNEY_DROP_ONE_VIOLATION_REDUCED;
  return Number.NEGATIVE_INFINITY;
}

function shouldAcceptCandidateForPass(input: {
  passUsed: ReplacementCandidatePass;
  deltaJourney: number;
  deltaArc: number;
  deltaFriction: number;
  deltaViolations: number;
}): { accepted: boolean; discardReason: IdeaDateDiscardReason | null } {
  if (input.passUsed === 'primary') {
    if (input.deltaJourney < MAX_JOURNEY_SCORE_DROP) {
      return { accepted: false, discardReason: 'worsens_journeyScore' };
    }
    const hasArcImprovement = input.deltaArc > MIN_ARC_IMPROVEMENT_DELTA;
    const hasViolationReduction = input.deltaViolations > 0;
    const hasFrictionReduction = input.deltaFriction > MIN_SIGNAL_EPS;
    const hasJourneyImprovement = input.deltaJourney > MIN_SIGNAL_EPS;
    if (!hasArcImprovement && !hasViolationReduction && !hasFrictionReduction && !hasJourneyImprovement) {
      return { accepted: false, discardReason: 'no_arc_improvement' };
    }
    return { accepted: true, discardReason: null };
  }

  if (input.deltaViolations <= 0) {
    return { accepted: false, discardReason: 'no_arc_improvement' };
  }
  const maxDrop = resolveRepairJourneyDropThreshold(input.deltaViolations);
  if (input.deltaJourney < maxDrop) {
    return { accepted: false, discardReason: 'worsens_journeyScore' };
  }
  return { accepted: true, discardReason: null };
}

function areStopOrdersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function swapStopIdsAdjacent(stopIds: string[], leftIndex: number): string[] {
  const next = [...stopIds];
  const temp = next[leftIndex];
  next[leftIndex] = next[leftIndex + 1];
  next[leftIndex + 1] = temp;
  return next;
}

function enumeratePermutationOrders(stopIds: string[]): string[][] {
  const permutations: string[][] = [];
  const current: string[] = [];
  const used = new Array(stopIds.length).fill(false);

  const walk = () => {
    if (current.length === stopIds.length) {
      permutations.push([...current]);
      return;
    }

    for (let index = 0; index < stopIds.length; index += 1) {
      if (used[index]) continue;
      used[index] = true;
      current.push(stopIds[index]);
      walk();
      current.pop();
      used[index] = false;
    }
  };

  walk();
  return permutations;
}

function enumerateReorderRepairOrders(stops: Stop[]): string[][] {
  const stopIds = stops.map((stop) => stop.id);
  if (stopIds.length < 2) return [];

  if (stopIds.length <= REORDER_REPAIR_MAX_PERMUTATION_STOPS) {
    return enumeratePermutationOrders(stopIds).filter((order) => !areStopOrdersEqual(order, stopIds));
  }

  const adjacentOrders: string[][] = [];
  for (let leftIndex = 0; leftIndex < stopIds.length - 1; leftIndex += 1) {
    adjacentOrders.push(swapStopIdsAdjacent(stopIds, leftIndex));
  }
  return adjacentOrders;
}

function buildMoveStopPatchOpsForOrder(stops: Stop[], targetOrder: string[]): IdeaDateSuggestion['patchOps'] {
  const workingIds = stops.map((stop) => stop.id);
  const patchOps: IdeaDateSuggestion['patchOps'] = [];

  for (let toIndex = 0; toIndex < targetOrder.length; toIndex += 1) {
    const stopId = targetOrder[toIndex];
    const fromIndex = workingIds.indexOf(stopId);
    if (fromIndex < 0) return [];
    if (fromIndex === toIndex) continue;
    patchOps.push({
      op: 'moveStop',
      stopId,
      toIndex,
    });
    const [movedId] = workingIds.splice(fromIndex, 1);
    workingIds.splice(toIndex, 0, movedId);
  }

  return patchOps;
}

function resolveReorderRepairReasonCode(outcome: ReorderRepairOutcome): string {
  if (outcome.deltaViolations > 0) return 'reorder_repair_reduce_violations';
  if (outcome.deltaArc > REORDER_REPAIR_MIN_ARC_IMPROVEMENT_DELTA) return 'reorder_repair_arc_smoothing';
  return 'reorder_repair_journey_boost';
}

function shouldAcceptReorderRepairCandidate(input: {
  deltaJourney: number;
  deltaArc: number;
  deltaViolations: number;
}): { accepted: boolean; discardReason: IdeaDateDiscardReason | null } {
  if (input.deltaViolations < 0) {
    return { accepted: false, discardReason: 'increases_violations' };
  }
  if (input.deltaViolations > 0) {
    return { accepted: true, discardReason: null };
  }
  if (input.deltaArc > REORDER_REPAIR_MIN_ARC_IMPROVEMENT_DELTA) {
    return { accepted: true, discardReason: null };
  }
  if (input.deltaJourney > MIN_SIGNAL_EPS) {
    return { accepted: true, discardReason: null };
  }
  return { accepted: false, discardReason: 'no_arc_improvement' };
}

function isBetterReorderRepairOutcome(next: ReorderRepairOutcome, best: ReorderRepairOutcome): boolean {
  if (
    !areArcDeltasNearEqual(next.deltaArc, best.deltaArc, MIN_SIGNAL_EPS)
    && next.deltaArc !== best.deltaArc
  ) {
    return next.deltaArc > best.deltaArc;
  }
  if (next.deltaHardConstraints !== best.deltaHardConstraints) {
    return next.deltaHardConstraints > best.deltaHardConstraints;
  }
  if (next.deltaSoftConstraints !== best.deltaSoftConstraints) {
    return next.deltaSoftConstraints > best.deltaSoftConstraints;
  }
  if (next.deltaViolations !== best.deltaViolations) return next.deltaViolations > best.deltaViolations;
  if (next.deltaFriction !== best.deltaFriction) return next.deltaFriction > best.deltaFriction;
  if (next.deltaJourney !== best.deltaJourney) return next.deltaJourney > best.deltaJourney;
  return next.id.localeCompare(best.id) < 0;
}

function buildReplacementStop(
  stop: Stop,
  candidate: IdeaDatePlaceCandidate,
  plan: Plan
): Stop {
  const planProfile = parseIdeaDatePlanProfile(plan.meta?.ideaDate);
  const existingProfile = getStopProfile(stop);
  const role = existingProfile?.role ?? 'flex';
  const baseline = hydrateIdeaDateStopProfile({
    place: {
      placeLite: candidate.placeLite,
      placeRef: candidate.placeRef,
      name: candidate.name,
    },
    role,
    blend: planProfile.vibeTarget,
  });
  const nextProfile = applyOverridesToProfile(baseline, existingProfile?.overrides);

  return {
    ...stop,
    name: candidate.name || stop.name,
    placeRef: candidate.placeRef ?? stop.placeRef,
    placeLite: candidate.placeLite ?? stop.placeLite,
    ideaDate: nextProfile,
  };
}

function dedupeCandidates(candidates: IdeaDatePlaceCandidate[]): IdeaDatePlaceCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const map = new Map<string, IdeaDatePlaceCandidate>();
  for (const candidate of sorted) {
    if (!map.has(candidate.id)) map.set(candidate.id, candidate);
  }
  return [...map.values()];
}

function candidateFromStop(stop: Stop): IdeaDatePlaceCandidate {
  const placeId = readStopPlaceId(stop) ?? stop.id;
  return {
    id: `swap:${placeId}`,
    name: stop.name,
    placeRef: stop.placeRef,
    placeLite: stop.placeLite,
  };
}

function toReplaceStopPatchOp(input: {
  stopId: string;
  replacementStop: Stop;
  plan: Plan;
}): Extract<IdeaDateSuggestion['patchOps'][number], { op: 'replaceStop' }> {
  return {
    op: 'replaceStop',
    stopId: input.stopId,
    newPlace: {
      name: input.replacementStop.name,
      placeRef: input.replacementStop.placeRef,
      placeLite: input.replacementStop.placeLite,
    },
    newIdeaDateProfile:
      (input.replacementStop.ideaDate as IdeaDateStopProfile) ??
      hydrateIdeaDateStopProfile({
        place: {
          placeRef: input.replacementStop.placeRef,
          placeLite: input.replacementStop.placeLite,
          name: input.replacementStop.name,
        },
        role: 'flex',
        blend: parseIdeaDatePlanProfile(input.plan.meta?.ideaDate).vibeTarget,
      }),
  };
}

function buildPatchOpsForCandidate(input: {
  plan: Plan;
  targetStop: Stop;
  candidate: IdeaDatePlaceCandidate;
  nextTargetStop: Stop;
}): IdeaDateSuggestion['patchOps'] {
  const targetReplaceOp = toReplaceStopPatchOp({
    stopId: input.targetStop.id,
    replacementStop: input.nextTargetStop,
    plan: input.plan,
  });
  const candidatePlaceId = readCandidatePlaceId(input.candidate);
  if (!candidatePlaceId) return [targetReplaceOp];

  const donorStop = input.plan.stops.find(
    (stop) => stop.id !== input.targetStop.id && readStopPlaceId(stop) === candidatePlaceId
  );
  if (!donorStop) return [targetReplaceOp];

  const donorReplacement = buildReplacementStop(donorStop, candidateFromStop(input.targetStop), input.plan);
  const donorReplaceOp = toReplaceStopPatchOp({
    stopId: donorStop.id,
    replacementStop: donorReplacement,
    plan: input.plan,
  });
  return [targetReplaceOp, donorReplaceOp];
}

export async function generateReplacementSuggestionsWithStats(
  plan: Plan,
  computed: IdeaDateComputedMetrics,
  options?: {
    searchCandidates?: SearchCandidates;
    searchPlacesNear?: SearchPlacesNear;
    replacementRanking?: IdeaDateReplacementRankingOptions;
    recomputeCandidatePlan?: RecomputeCandidatePlan;
    prefTilt?: Partial<IdeaDatePrefTilt>;
    mode?: IdeaDateMode;
  }
): Promise<{
  suggestions: IdeaDateSuggestion[];
  refineStats: IdeaDateRefineStats;
}> {
  const refineStartedAt = nowMs();
  const timing = {
    resolverFetchMs: 0,
    candidatePrepMs: 0,
    candidateEvaluationMs: 0,
    rankingMs: 0,
  };
  const searchCandidates = options?.searchCandidates ?? defaultSearchCandidates;
  const searchPlacesNear = options?.searchPlacesNear ?? defaultSearchPlacesNear;
  const hasCustomRecomputeCandidatePlan = Boolean(options?.recomputeCandidatePlan);
  const recomputeCandidatePlan: RecomputeCandidatePlan =
    options?.recomputeCandidatePlan ?? (async (candidatePlan) => recomputeIdeaDateLive(candidatePlan));
  const diversityPolicy = normalizeDiversityPolicy(
    options?.replacementRanking?.diversityPolicy ?? disabledDiversityPolicy()
  );
  const familyKeyAdapter = options?.replacementRanking?.familyKeyAdapter ?? defaultFamilyKeyAdapter();
  const planFamilyCounts = buildPlanFamilyCounts(plan.stops ?? [], familyKeyAdapter.classifyStopFamilyKey);
  const refineStats = createEmptyRefineStats();
  const tiltProfile = buildIdeaDateRefineTiltProfile(options?.prefTilt, options?.mode);
  const replacementPassStats: Record<ReplacementCandidatePass, {
    seen: number;
    kept: number;
    discarded: number;
    discardCounts: Record<IdeaDateDiscardReason, number>;
  }> = {
    primary: {
      seen: 0,
      kept: 0,
      discarded: 0,
      discardCounts: createEmptyDiscardCounts(),
    },
    repair: {
      seen: 0,
      kept: 0,
      discarded: 0,
      discardCounts: createEmptyDiscardCounts(),
    },
  };
  const reorderRepairStats = {
    evaluated: 0,
    kept: 0,
    topDeltaArc: undefined as number | undefined,
    topDeltaJourney: undefined as number | undefined,
    topDeltaViolations: undefined as number | undefined,
  };
  if (includeDevQueryDebug) {
    refineStats.debugPlanFamilyCounts = summarizeFamilyCounts(planFamilyCounts);
    refineStats.debugPassUsed = 'primary';
    refineStats.debugPlanPrefTilt = tiltProfile.planPrefTilt;
    refineStats.debugModeDefaultPrefTilt = tiltProfile.modeDefaults;
    refineStats.debugEffectivePrefTilt = tiltProfile.effectiveTilt;
    refineStats.debugPrefTilt = tiltProfile.effectiveTilt;
    refineStats.debugTiltWeightMap = tiltProfile.weightMap;
    refineStats.debugTiltsApplied = tiltProfile.applied;
    refineStats.debugTiming = {
      totalRefineMs: 0,
      resolverFetchMs: 0,
      candidatePrepMs: 0,
      candidateEvaluationMs: 0,
      rankingMs: 0,
    };
  }
  const planProfile = parseIdeaDatePlanProfile(plan.meta?.ideaDate);
  const baseEvaluation = evaluateIdeaDateJourney(plan);
  const primaryPainStops = computePainScore(plan, computed, baseEvaluation)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_REPLACEMENTS);
  const repairPainStops = computeRepairTargetStops({
    plan,
    computed,
    evaluation: baseEvaluation,
  });

  const baseScore = computed.journeyScore;
  const baseArcContributionTotal = computeRefineArcContributionTotal({
    plan,
    computed,
    evaluation: baseEvaluation,
    tiltProfile,
  });
  const baseFriction = computed.frictionPenalty;
  const baseViolationCount = computed.violations.length;
  const baseConstraintHardCount = computed.constraintHardCount;
  const baseConstraintSoftCount = computed.constraintSoftCount;
  const existingPlaceIds = new Set(
    (plan.stops ?? [])
      .map((stop) => readStopPlaceId(stop))
      .filter((placeId): placeId is string => Boolean(placeId))
  );
  const rescueMode = computed.intentScore < 0.5;
  const topSuggestionConstraintCounts = new Map<string, { hard: number; soft: number }>();

  const runReplacementPass = async (
    passUsed: ReplacementCandidatePass,
    painStops: Array<{ index: number; score: number }>
  ): Promise<IdeaDateSuggestion[]> => {
    const passStats = replacementPassStats[passUsed];
    const maxCandidatesSeen =
      passUsed === 'primary'
        ? MAX_REPLACEMENT_CANDIDATES_SEEN_PRIMARY
        : MAX_REPLACEMENT_CANDIDATES_SEEN_REPAIR;
    const incrementPassDiscardReason = (reason: IdeaDateDiscardReason): void => {
      incrementDiscardReason(refineStats, reason);
      passStats.discarded += 1;
      passStats.discardCounts[reason] += 1;
    };
    const passSuggestions: IdeaDateSuggestion[] = [];
    let capReached = false;
    for (const pain of painStops) {
      if (capReached) break;
      if (passSuggestions.length >= MAX_REPLACEMENTS) break;
      const stop = plan.stops[pain.index];
      if (!stop) continue;
      const stopProfile = getStopProfile(stop);
      const originalPlaceName = stop.name?.trim() ?? '';
      const targetRole = resolveTargetRole({
        stop,
        index: pain.index,
        stopCount: plan.stops.length,
        stopProfile,
      });
      const targetPlaceId = readStopPlaceId(stop);
      let best: CandidateOutcome | null = null;

      for (const radiusKm of ADAPTIVE_RADIUS_KM) {
        if (capReached) break;
        if (includeDevQueryDebug && !refineStats.debugRoleQuery) {
          refineStats.debugRoleQuery = createFallbackRoleQueryDebug(targetRole, radiusKm);
        }
        const resolverStartedAt = nowMs();
        const externalCandidates = await resolveExternalCandidates({
          searchCandidates,
          searchPlacesNear,
          role: targetRole,
          stop,
          plan,
          radiusKm,
          vibeId: planProfile.vibeId,
        });
        timing.resolverFetchMs += elapsedMs(resolverStartedAt);
        const mockCandidates = mockCandidatesFromPlan(plan, stop.id);
        // Dedupe/sort first, then truncate to keep deterministic "first wins" behavior.
        const candidates = dedupeCandidates(
          externalCandidates.length >= MIN_EXTERNAL_CANDIDATES
            ? externalCandidates
            : [...externalCandidates, ...mockCandidates]
        ).slice(0, MAX_CANDIDATES_PER_RADIUS);

        for (const candidate of candidates) {
          if (passStats.seen >= maxCandidatesSeen) {
            capReached = true;
            break;
          }
          refineStats.candidateCount += 1;
          passStats.seen += 1;
          const candidatePrepStartedAt = nowMs();
          const candidateFamilyKey = classifyCandidateFamilyKey(familyKeyAdapter, candidate);
          const diversityPenalty = computeDiversityPenalty({
            policy: diversityPolicy,
            planFamilyCounts,
            candidateFamilyKey,
          });
          if (includeDevQueryDebug && candidate.debugRoleQuery) {
            refineStats.debugRoleQuery = candidate.debugRoleQuery;
          }
          if (includeDevQueryDebug && !refineStats.debugDiversity) {
            refineStats.debugDiversity = {
              candidateFamilyKey,
              planFamilyCounts: summarizeFamilyCounts(planFamilyCounts),
              diversityPenalty,
              ranking: {
                deltaArc: 0,
                adjustedArc: -diversityPenalty,
                nearEqualArcDelta: diversityPolicy.nearEqualArcDelta,
                weight: diversityPolicy.diversity.weight,
              },
            };
          }
          const candidatePlaceId = readCandidatePlaceId(candidate);
          const noOpDuplicate = Boolean(
            candidatePlaceId && targetPlaceId && candidatePlaceId === targetPlaceId
          );
          const duplicateInPlan = Boolean(
            candidatePlaceId && existingPlaceIds.has(candidatePlaceId) && !isPlanDerivedCandidate(candidate)
          );
          if (noOpDuplicate || duplicateInPlan) {
            timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);
            incrementPassDiscardReason('duplicate_placeId');
            continue;
          }
          if (
            passUsed === 'primary'
            && !isPlanDerivedCandidate(candidate)
            && !candidateMatchesRole(candidate, targetRole)
          ) {
            timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);
            incrementPassDiscardReason('role_mismatch');
            continue;
          }

          const nextStop = buildReplacementStop(stop, candidate, plan);
          const patchOps = buildPatchOpsForCandidate({
            plan,
            targetStop: stop,
            candidate,
            nextTargetStop: nextStop,
          });
          let candidatePlan: Plan;
          try {
            candidatePlan = applyIdeaDatePatchOps(plan, patchOps);
          } catch {
            timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);
            incrementPassDiscardReason('invariant_violation');
            continue;
          }
          timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);

          let candidateComputed: IdeaDateComputedMetrics;
          const candidateEvaluationStartedAt = nowMs();
          const candidateEvaluation = evaluateIdeaDateJourney(candidatePlan);
          const candidateConstraintCounts = evaluateConstraintCountsForCandidatePlan({
            candidatePlan,
            candidateEvaluation,
          });
          const earlyDeltaHardConstraints = baseConstraintHardCount - candidateConstraintCounts.hardCount;
          if (earlyDeltaHardConstraints < 0) {
            timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
            incrementPassDiscardReason('increases_hard_constraints');
            continue;
          }
          try {
            const recomputed = await recomputeCandidatePlan(candidatePlan);
            candidateComputed = recomputed.computed;
          } catch {
            timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
            incrementPassDiscardReason('invariant_violation');
            continue;
          }
          const candidateHardConstraintCountAfter = hasCustomRecomputeCandidatePlan
            ? candidateComputed.constraintHardCount
            : candidateConstraintCounts.hardCount;
          const candidateSoftConstraintCountAfter = hasCustomRecomputeCandidatePlan
            ? candidateComputed.constraintSoftCount
            : candidateConstraintCounts.softCount;
          const deltaHardConstraints = baseConstraintHardCount - candidateHardConstraintCountAfter;
          const deltaSoftConstraints = baseConstraintSoftCount - candidateSoftConstraintCountAfter;
          if (deltaHardConstraints < 0) {
            timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
            incrementPassDiscardReason('increases_hard_constraints');
            continue;
          }
          if (candidateComputed.violations.length > baseViolationCount) {
            timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
            incrementPassDiscardReason('increases_violations');
            continue;
          }
          const deltaJourney = candidateComputed.journeyScore - baseScore;
          const candidateArcContributionTotal = computeRefineArcContributionTotal({
            plan: candidatePlan,
            computed: candidateComputed,
            evaluation: candidateEvaluation,
            tiltProfile,
          });
          const deltaArc = candidateArcContributionTotal - baseArcContributionTotal;
          const deltaFriction = baseFriction - candidateComputed.frictionPenalty;
          const deltaViolations = baseViolationCount - candidateComputed.violations.length;
          const adjustedArcScore = deltaArc - diversityPenalty;
          const acceptance = shouldAcceptCandidateForPass({
            passUsed,
            deltaJourney,
            deltaArc,
            deltaFriction,
            deltaViolations,
          });
          if (!acceptance.accepted) {
            timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
            incrementPassDiscardReason(acceptance.discardReason ?? 'no_arc_improvement');
            continue;
          }
          timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);

          refineStats.evaluatedCount += 1;
          passStats.kept += 1;
          const outcome: CandidateOutcome = {
            candidate,
            computed: candidateComputed,
            patchOps,
            deltaJourney,
            deltaArc,
            deltaHardConstraints,
            deltaSoftConstraints,
            hardConstraintCountAfter: candidateHardConstraintCountAfter,
            softConstraintCountAfter: candidateSoftConstraintCountAfter,
            deltaFriction,
            deltaViolations,
            candidateFamilyKey,
            diversityPenalty,
            adjustedArcScore,
            planFamilyCounts,
            passUsed,
          };
          if (!best || isBetterArcFirstCandidate(outcome, best, diversityPolicy)) {
            best = {
              ...outcome,
            };
          }
        }
        if (best) break;
      }

      if (!best) continue;
      const suggestionId = `idea-date-replace-${stop.id}-${best.candidate.id}`;
      topSuggestionConstraintCounts.set(suggestionId, {
        hard: best.hardConstraintCountAfter,
        soft: best.softConstraintCountAfter,
      });
      if (includeDevQueryDebug) {
        refineStats.debugPassUsed = passUsed;
        refineStats.debugDiversity = {
          candidateFamilyKey: best.candidateFamilyKey,
          planFamilyCounts: summarizeFamilyCounts(best.planFamilyCounts),
          diversityPenalty: best.diversityPenalty,
          ranking: {
            deltaArc: best.deltaArc,
            adjustedArc: best.adjustedArcScore,
            nearEqualArcDelta: diversityPolicy.nearEqualArcDelta,
            weight: diversityPolicy.diversity.weight,
          },
        };
        if (best.candidate.debugRoleQuery) {
          refineStats.debugRoleQuery = best.candidate.debugRoleQuery;
        }
      }
      passSuggestions.push({
        id: suggestionId,
        kind: 'replacement',
        reasonCode: rescueMode ? 'intent_rescue' : 'friction_relief',
        patchOps: best.patchOps,
        newPlace: {
          name: best.candidate.name,
          placeRef: best.candidate.placeRef,
          placeLite: best.candidate.placeLite,
        },
        meta: {
          originalPlaceName: originalPlaceName || undefined,
          ...(includeDevQueryDebug && best.candidate.debugRoleQuery
            ? { debugRoleQuery: best.candidate.debugRoleQuery }
            : {}),
          ...(includeDevQueryDebug
            ? {
                debugDiversity: {
                  candidateFamilyKey: best.candidateFamilyKey,
                  planFamilyCounts: summarizeFamilyCounts(best.planFamilyCounts),
                  diversityPenalty: best.diversityPenalty,
                  ranking: {
                    deltaArc: best.deltaArc,
                    adjustedArc: best.adjustedArcScore,
                    nearEqualArcDelta: diversityPolicy.nearEqualArcDelta,
                    weight: diversityPolicy.diversity.weight,
                  },
                } as IdeaDateDiversityDebug,
              }
            : {}),
        },
        impact: {
          before: baseScore,
          after: best.computed.journeyScore,
          delta: best.deltaJourney,
          before100: toScore100(baseScore),
          after100: toScore100(best.computed.journeyScore),
        },
        preview: true,
        subjectStopId: stop.id,
      });
    }
    return passSuggestions;
  };

  const runReorderRepairPass = async (): Promise<IdeaDateSuggestion[]> => {
    const orders = enumerateReorderRepairOrders(plan.stops);
    const outcomes: ReorderRepairOutcome[] = [];

    for (const order of orders) {
      if (reorderRepairStats.evaluated >= MAX_REORDER_REPAIR_EVALUATED) break;
      const candidatePrepStartedAt = nowMs();
      const patchOps = buildMoveStopPatchOpsForOrder(plan.stops, order);
      if (patchOps.length === 0) {
        timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);
        continue;
      }
      reorderRepairStats.evaluated += 1;
      refineStats.candidateCount += 1;

      let candidatePlan: Plan;
      try {
        candidatePlan = applyIdeaDatePatchOps(plan, patchOps);
      } catch {
        timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);
        incrementDiscardReason(refineStats, 'invariant_violation');
        continue;
      }
      timing.candidatePrepMs += elapsedMs(candidatePrepStartedAt);

      let candidateComputed: IdeaDateComputedMetrics;
      const candidateEvaluationStartedAt = nowMs();
      const candidateEvaluation = evaluateIdeaDateJourney(candidatePlan);
      const candidateConstraintCounts = evaluateConstraintCountsForCandidatePlan({
        candidatePlan,
        candidateEvaluation,
      });
      const earlyDeltaHardConstraints = baseConstraintHardCount - candidateConstraintCounts.hardCount;
      if (earlyDeltaHardConstraints < 0) {
        timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
        incrementDiscardReason(refineStats, 'increases_hard_constraints');
        continue;
      }
      try {
        const recomputed = await recomputeCandidatePlan(candidatePlan);
        candidateComputed = recomputed.computed;
      } catch {
        timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
        incrementDiscardReason(refineStats, 'invariant_violation');
        continue;
      }

      const deltaJourney = candidateComputed.journeyScore - baseScore;
      const candidateArcContributionTotal = computeRefineArcContributionTotal({
        plan: candidatePlan,
        computed: candidateComputed,
        evaluation: candidateEvaluation,
        tiltProfile,
      });
      const deltaArc = candidateArcContributionTotal - baseArcContributionTotal;
      const candidateHardConstraintCountAfter = hasCustomRecomputeCandidatePlan
        ? candidateComputed.constraintHardCount
        : candidateConstraintCounts.hardCount;
      const candidateSoftConstraintCountAfter = hasCustomRecomputeCandidatePlan
        ? candidateComputed.constraintSoftCount
        : candidateConstraintCounts.softCount;
      const deltaHardConstraints = baseConstraintHardCount - candidateHardConstraintCountAfter;
      const deltaSoftConstraints = baseConstraintSoftCount - candidateSoftConstraintCountAfter;
      if (deltaHardConstraints < 0) {
        timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
        incrementDiscardReason(refineStats, 'increases_hard_constraints');
        continue;
      }
      const deltaFriction = baseFriction - candidateComputed.frictionPenalty;
      const deltaViolations = baseViolationCount - candidateComputed.violations.length;
      const acceptance = shouldAcceptReorderRepairCandidate({
        deltaJourney,
        deltaArc,
        deltaViolations,
      });
      if (!acceptance.accepted) {
        timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);
        incrementDiscardReason(refineStats, acceptance.discardReason ?? 'no_arc_improvement');
        continue;
      }
      timing.candidateEvaluationMs += elapsedMs(candidateEvaluationStartedAt);

      refineStats.evaluatedCount += 1;
      const firstPatchOp = patchOps[0];
      const finalOrderSignature = (candidatePlan.stops ?? []).map((stop) => stop.id).join('>');
      outcomes.push({
        id: finalOrderSignature,
        finalOrderSignature,
        patchOps,
        computed: candidateComputed,
        deltaJourney,
        deltaArc,
        deltaHardConstraints,
        deltaSoftConstraints,
        hardConstraintCountAfter: candidateHardConstraintCountAfter,
        softConstraintCountAfter: candidateSoftConstraintCountAfter,
        deltaFriction,
        deltaViolations,
        subjectStopId: firstPatchOp?.op === 'moveStop' ? firstPatchOp.stopId : undefined,
      });
    }

    const rankingStartedAt = nowMs();
    const sortedOutcomes = [...outcomes].sort((a, b) => {
      if (isBetterReorderRepairOutcome(a, b)) return -1;
      if (isBetterReorderRepairOutcome(b, a)) return 1;
      return 0;
    });
    const dedupedOutcomes: ReorderRepairOutcome[] = [];
    const seenOrderSignatures = new Set<string>();
    for (const outcome of sortedOutcomes) {
      if (seenOrderSignatures.has(outcome.finalOrderSignature)) continue;
      seenOrderSignatures.add(outcome.finalOrderSignature);
      dedupedOutcomes.push(outcome);
    }
    timing.rankingMs += elapsedMs(rankingStartedAt);
    reorderRepairStats.kept = sortedOutcomes.length;

    if (includeDevQueryDebug) {
      const topOutcome = dedupedOutcomes[0];
      reorderRepairStats.topDeltaArc = topOutcome?.deltaArc;
      reorderRepairStats.topDeltaJourney = topOutcome?.deltaJourney;
      reorderRepairStats.topDeltaViolations = topOutcome?.deltaViolations;
      refineStats.debugReorderRepair = {
        candidatesEvaluated: reorderRepairStats.evaluated,
        candidatesKept: reorderRepairStats.kept,
        topDeltaArc: topOutcome?.deltaArc,
        topDeltaJourney: topOutcome?.deltaJourney,
        topDeltaViolations: topOutcome?.deltaViolations,
      };
    }

    return dedupedOutcomes.slice(0, MAX_REPLACEMENTS).map((outcome) => {
      const suggestionId = `idea-date-reorder-repair-${outcome.id}`;
      topSuggestionConstraintCounts.set(suggestionId, {
        hard: outcome.hardConstraintCountAfter,
        soft: outcome.softConstraintCountAfter,
      });
      return {
        id: suggestionId,
        kind: 'reorder',
        reasonCode: resolveReorderRepairReasonCode(outcome),
        patchOps: outcome.patchOps,
        impact: {
          before: baseScore,
          after: outcome.computed.journeyScore,
          delta: outcome.deltaJourney,
          before100: toScore100(baseScore),
          after100: toScore100(outcome.computed.journeyScore),
        },
        preview: true,
        subjectStopId: outcome.subjectStopId,
      };
    });
  };

  let suggestions = await runReplacementPass('primary', primaryPainStops);
  if (suggestions.length === 0) {
    if (includeDevQueryDebug) {
      refineStats.debugPassUsed = 'repair';
      refineStats.debugRepairThresholds = {
        maxJourneyDropOneViolationReduced: REPAIR_MAX_JOURNEY_DROP_ONE_VIOLATION_REDUCED,
        maxJourneyDropTwoViolationsReduced: REPAIR_MAX_JOURNEY_DROP_TWO_VIOLATIONS_REDUCED,
      };
    }
    suggestions = await runReplacementPass('repair', repairPainStops);
  }
  if (suggestions.length === 0) {
    if (includeDevQueryDebug) {
      refineStats.debugPassUsed = 'reorder_repair';
    }
    suggestions = await runReorderRepairPass();
  }

  const trimmedSuggestions = suggestions.slice(0, MAX_REPLACEMENTS);
  refineStats.suggestionsGenerated = trimmedSuggestions.length;
  if (includeDevQueryDebug) {
    const topSuggestionId = trimmedSuggestions[0]?.id;
    if (topSuggestionId) {
      const topCounts = topSuggestionConstraintCounts.get(topSuggestionId);
      if (topCounts) {
        refineStats.debugTopConstraintDelta = {
          baselineHardCount: baseConstraintHardCount,
          baselineSoftCount: baseConstraintSoftCount,
          afterHardCount: topCounts.hard,
          afterSoftCount: topCounts.soft,
          hardDelta: topCounts.hard - baseConstraintHardCount,
          softDelta: topCounts.soft - baseConstraintSoftCount,
        };
      }
    }
    refineStats.debugPassBreakdown = {
      primaryReplacement: {
        seen: replacementPassStats.primary.seen,
        kept: replacementPassStats.primary.kept,
        discarded: replacementPassStats.primary.discarded,
        discardCounts: { ...replacementPassStats.primary.discardCounts },
      },
      repairReplacement: {
        seen: replacementPassStats.repair.seen,
        kept: replacementPassStats.repair.kept,
        discarded: replacementPassStats.repair.discarded,
        discardCounts: { ...replacementPassStats.repair.discardCounts },
      },
      reorderRepair: {
        evaluated: reorderRepairStats.evaluated,
        kept: reorderRepairStats.kept,
        topDeltaArc: reorderRepairStats.topDeltaArc,
        topDeltaJourney: reorderRepairStats.topDeltaJourney,
        topDeltaViolations: reorderRepairStats.topDeltaViolations,
      },
    };
    refineStats.debugTiming = {
      totalRefineMs: elapsedMs(refineStartedAt),
      resolverFetchMs: timing.resolverFetchMs,
      candidatePrepMs: timing.candidatePrepMs,
      candidateEvaluationMs: timing.candidateEvaluationMs,
      rankingMs: timing.rankingMs,
    };
  }

  return {
    suggestions: trimmedSuggestions,
    refineStats,
  };
}

export async function generateReplacementSuggestions(
  plan: Plan,
  computed: IdeaDateComputedMetrics,
  options?: {
    searchCandidates?: SearchCandidates;
    searchPlacesNear?: SearchPlacesNear;
    replacementRanking?: IdeaDateReplacementRankingOptions;
    recomputeCandidatePlan?: RecomputeCandidatePlan;
    prefTilt?: Partial<IdeaDatePrefTilt>;
    mode?: IdeaDateMode;
  }
): Promise<IdeaDateSuggestion[]> {
  const { suggestions } = await generateReplacementSuggestionsWithStats(plan, computed, options);
  return suggestions;
}
