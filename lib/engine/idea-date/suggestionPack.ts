import type { Plan } from '@/app/plan-engine/types';
import type { IdeaDateArcModel } from './arcModel';
import { computeArcContributionByStop } from './arcContribution';
import { applyIdeaDatePatchOps } from './patchOps';
import { recomputeIdeaDateLive } from './recompute';
import {
  buildIdeaDateConstraintNarrativeNote,
  buildIdeaDateSuggestionConstraintDelta,
  type IdeaDateSuggestionConstraintDelta,
} from './constraintsNarrative';
import {
  buildIdeaDateRefineTiltProfile,
  buildIdeaDateTiltNarrativeNote,
  type IdeaDatePrefTilt,
} from './refineTilt';
import {
  composeStructuralNarrativeDelta,
  type StructuralNarrativeDeltaInput,
} from './structuralComposer';
import type { IdeaDateMode } from '@/lib/idea-date/modePolicy';
import {
  generateReplacementSuggestionsWithStats,
  type IdeaDateRefineStats,
  type IdeaDateReplacementRankingOptions,
  type SearchCandidates,
  type SearchPlacesNear,
} from './replacement';
import { IdeaDateStopProfileSchema } from './schemas';
import { generateReorderSuggestion } from './reorder';
import { sortByArcContributionDelta } from './suggestionRanking';
import type { IdeaDateSuggestion } from './types';

const debug = process.env.NODE_ENV !== 'production';
const includeDevTiming = process.env.NODE_ENV !== 'production';

export type IdeaDateSuggestionPack = {
  plan: Plan;
  computed: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['computed'];
  travel: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['travel'];
  arcModel: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['arcModel'];
  suggestions: IdeaDateSuggestion[];
  debugRefineStats?: IdeaDateRefineStats;
};

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

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

function buildPatchOpSignature(suggestion: IdeaDateSuggestion): string {
  const opSignature = suggestion.patchOps
    .map((op) => {
      if (op.op === 'moveStop') {
        return `move:${op.stopId}:${op.toIndex}`;
      }
      return `replace:${op.stopId}:${JSON.stringify(op.newPlace)}:${JSON.stringify(op.newIdeaDateProfile)}`;
    })
    .join('|');
  return `${suggestion.kind}|${opSignature}`;
}

function dedupeSuggestionsDeterministically(suggestions: IdeaDateSuggestion[]): IdeaDateSuggestion[] {
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const deduped: IdeaDateSuggestion[] = [];

  for (const suggestion of suggestions) {
    const suggestionId = suggestion.id.trim();
    const signature = buildPatchOpSignature(suggestion);
    if (seenIds.has(suggestionId) || seenSignatures.has(signature)) continue;
    seenIds.add(suggestionId);
    seenSignatures.add(signature);
    deduped.push(suggestion);
  }

  return deduped;
}

function readWorstEdgeMinutes(travel: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['travel']): number {
  return travel.edges.reduce((maxMinutes, edge) => Math.max(maxMinutes, edge.minutes), 0);
}

function hasArcIssue(
  violations: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['computed']['violations']
): boolean {
  return violations.some((violation) => violation.type === 'no_taper' || violation.type === 'double_peak');
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

function computeRankedArcContributionTotal(input: {
  plan: Plan;
  computed: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['computed'];
  travel: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['travel'];
  prefTilt?: Partial<IdeaDatePrefTilt>;
  mode?: IdeaDateMode;
}): number {
  const tiltProfile = buildIdeaDateRefineTiltProfile(input.prefTilt, input.mode);
  if (!tiltProfile.applied || !tiltProfile.arcContributionOptions) {
    return finiteOrZero(input.computed.arcContributionTotal);
  }
  const energySeries = readEnergySeriesFromPlan(input.plan);
  if (!energySeries || energySeries.length !== (input.plan.stops ?? []).length) {
    return finiteOrZero(input.computed.arcContributionTotal);
  }
  const weightedArc = computeArcContributionByStop(
    {
      energySeries,
      fatigue: input.computed.components.fatigue,
      friction: input.computed.components.friction,
      transitionMinutes: input.travel.edges.map((edge) => edge.minutes),
    },
    tiltProfile.arcContributionOptions
  );
  return finiteOrZero(weightedArc.total);
}

type RankedSuggestionRow = {
  id: string;
  legacyRank: number;
  constraintDelta: IdeaDateSuggestionConstraintDelta;
  deltaArcContributionTotal: number;
  structuralNarrativeInput: StructuralNarrativeDeltaInput;
  suggestion: IdeaDateSuggestion;
};

function readPeakShift(
  baselineArcModel: IdeaDateArcModel,
  nextArcModel: IdeaDateArcModel
): 'earlier' | 'later' | undefined {
  if (nextArcModel.peakIndexActual < baselineArcModel.peakIndexActual) return 'earlier';
  if (nextArcModel.peakIndexActual > baselineArcModel.peakIndexActual) return 'later';
  return undefined;
}

function readArcContext(
  baselineArcModel: IdeaDateArcModel,
  nextArcModel: IdeaDateArcModel
): StructuralNarrativeDeltaInput['arcContext'] {
  const baselinePeakDistance = Math.abs(
    baselineArcModel.peakIndexActual - baselineArcModel.peakIndexIdeal
  );
  const nextPeakDistance = Math.abs(nextArcModel.peakIndexActual - nextArcModel.peakIndexIdeal);
  const buildImproved = nextPeakDistance < baselinePeakDistance;
  const peakShifted = readPeakShift(baselineArcModel, nextArcModel);
  const taperImproved = baselineArcModel.flags.noTaper && !nextArcModel.flags.noTaper;
  if (!buildImproved && !peakShifted && !taperImproved) return undefined;
  return {
    ...(buildImproved ? { buildImproved: true } : {}),
    ...(peakShifted ? { peakShifted } : {}),
    ...(taperImproved ? { taperImproved: true } : {}),
  };
}

function readTiltInfluence(
  prefTilt: ReturnType<typeof buildIdeaDateRefineTiltProfile>['effectiveTilt'],
  applied: boolean
): StructuralNarrativeDeltaInput['tiltInfluence'] {
  if (!applied) return undefined;
  const walkingReduced = prefTilt.walking < 0;
  const peakShift = prefTilt.peak;
  if (!walkingReduced && peakShift === 0) return undefined;
  return {
    ...(walkingReduced ? { walkingReduced: true } : {}),
    ...(peakShift !== 0 ? { peakShift } : {}),
  };
}

async function rankSuggestionsByArcContribution(input: {
  plan: Plan;
  computed: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['computed'];
  travel: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['travel'];
  arcModel: IdeaDateArcModel;
  suggestions: IdeaDateSuggestion[];
  prefTilt?: Partial<IdeaDatePrefTilt>;
  mode?: IdeaDateMode;
}): Promise<RankedSuggestionRow[]> {
  if (input.suggestions.length === 0) return [];
  const tiltProfile = buildIdeaDateRefineTiltProfile(input.prefTilt, input.mode);
  const beforeTotal = computeRankedArcContributionTotal({
    plan: input.plan,
    computed: input.computed,
    travel: input.travel,
    prefTilt: input.prefTilt,
    mode: input.mode,
  });

  const rankedRows = await Promise.all(
    input.suggestions.map(async (suggestion, legacyRank) => {
      const previewPlan = applyIdeaDatePatchOps(input.plan, suggestion.patchOps);
      const previewLive = await recomputeIdeaDateLive(previewPlan);
      const constraintDelta = buildIdeaDateSuggestionConstraintDelta({
        baseline: {
          hardCount: input.computed.constraintHardCount,
          softCount: input.computed.constraintSoftCount,
          violations: input.computed.constraintViolations,
        },
        after: {
          hardCount: previewLive.computed.constraintHardCount,
          softCount: previewLive.computed.constraintSoftCount,
          violations: previewLive.computed.constraintViolations,
        },
      });
      const constraintNarrativeNote = buildIdeaDateConstraintNarrativeNote(constraintDelta);
      const afterTotal = computeRankedArcContributionTotal({
        plan: previewLive.plan,
        computed: previewLive.computed,
        travel: previewLive.travel,
        prefTilt: input.prefTilt,
        mode: input.mode,
      });
      const worstEdgeMinutesSaved = readWorstEdgeMinutes(input.travel) - readWorstEdgeMinutes(previewLive.travel);
      const totalTravelMinutesSaved = input.travel.totalMinutes - previewLive.travel.totalMinutes;
      const fixedArcIssue = hasArcIssue(input.computed.violations) && !hasArcIssue(previewLive.computed.violations);
      const tiltNote = buildIdeaDateTiltNarrativeNote({
        prefTilt: tiltProfile.effectiveTilt,
        context: {
          worstEdgeMinutesSaved,
          totalTravelMinutesSaved,
          deltaArcContributionTotal: afterTotal - beforeTotal,
          fixedArcIssue,
        },
      });
      const deltaArcContributionTotal = afterTotal - beforeTotal;
      const structuralNarrativeInput: StructuralNarrativeDeltaInput = {
        deltaArc: deltaArcContributionTotal,
        constraintDelta: {
          hardDelta: constraintDelta.deltas.hardDelta,
          softDelta: constraintDelta.deltas.softDelta,
          improvedKinds: [...constraintDelta.improvedKinds],
        },
        arcContext: readArcContext(input.arcModel, previewLive.arcModel),
        frictionReduced: previewLive.computed.frictionPenalty < input.computed.frictionPenalty,
        tiltInfluence: readTiltInfluence(tiltProfile.effectiveTilt, tiltProfile.applied),
      };
      return {
        id: suggestion.id,
        legacyRank,
        constraintDelta,
        deltaArcContributionTotal,
        structuralNarrativeInput,
        suggestion: {
          ...suggestion,
          meta: {
            ...suggestion.meta,
            conciergeTiltNote: tiltNote ?? undefined,
            constraintNarrativeNote: constraintNarrativeNote ?? undefined,
            constraintDelta,
          },
          arcImpact: {
            beforeTotal,
            afterTotal,
            deltaTotal: deltaArcContributionTotal,
          },
        },
      };
    })
  );

  const hardSafeRows = rankedRows.filter((row) => row.constraintDelta.deltas.hardDelta <= 0);
  return sortByArcContributionDelta(hardSafeRows);
}

export async function generateIdeaDateSuggestionPack(
  plan: Plan,
  options?: {
    searchCandidates?: SearchCandidates;
    searchPlacesNear?: SearchPlacesNear;
    replacementRanking?: IdeaDateReplacementRankingOptions;
    prefTilt?: Partial<IdeaDatePrefTilt>;
    mode?: IdeaDateMode;
  }
): Promise<IdeaDateSuggestionPack> {
  const refineStartedAt = nowMs();
  const live = await recomputeIdeaDateLive(plan);
  const reorder = generateReorderSuggestion(live.plan, live.computed);
  const replacementOutput = await generateReplacementSuggestionsWithStats(live.plan, live.computed, {
    searchCandidates: options?.searchCandidates,
    searchPlacesNear: options?.searchPlacesNear,
    replacementRanking: options?.replacementRanking,
    prefTilt: options?.prefTilt,
    mode: options?.mode,
  });
  const replacements = replacementOutput.suggestions;
  const phaseISuggestions: IdeaDateSuggestion[] = [];
  if (reorder) phaseISuggestions.push(reorder);
  phaseISuggestions.push(...replacements);
  const dedupedPhaseISuggestions = dedupeSuggestionsDeterministically(phaseISuggestions);
  const rankingStartedAt = nowMs();
  const rankedSuggestions = await rankSuggestionsByArcContribution({
    plan: live.plan,
    computed: live.computed,
    travel: live.travel,
    arcModel: live.arcModel,
    suggestions: dedupedPhaseISuggestions,
    prefTilt: options?.prefTilt,
    mode: options?.mode,
  });
  const suggestionsWithStructuralNarrative = rankedSuggestions.map((row) => {
    const structuralNarrative = composeStructuralNarrativeDelta(row.structuralNarrativeInput);
    return {
      ...row.suggestion,
      meta: {
        ...row.suggestion.meta,
        structuralNarrative: structuralNarrative ?? undefined,
      },
    };
  });
  if (includeDevTiming) {
    const existingTiming = replacementOutput.refineStats.debugTiming ?? {
      totalRefineMs: 0,
      resolverFetchMs: 0,
      candidatePrepMs: 0,
      candidateEvaluationMs: 0,
      rankingMs: 0,
    };
    replacementOutput.refineStats.debugTiming = {
      totalRefineMs: elapsedMs(refineStartedAt),
      resolverFetchMs: existingTiming.resolverFetchMs,
      candidatePrepMs: existingTiming.candidatePrepMs,
      candidateEvaluationMs: existingTiming.candidateEvaluationMs,
      rankingMs: existingTiming.rankingMs + elapsedMs(rankingStartedAt),
    };
  }

  return {
    plan: live.plan,
    computed: live.computed,
    travel: live.travel,
    arcModel: live.arcModel,
    suggestions: suggestionsWithStructuralNarrative.slice(0, 3),
    ...(debug ? { debugRefineStats: replacementOutput.refineStats } : {}),
  };
}
