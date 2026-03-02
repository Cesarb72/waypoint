import type { Plan } from '@/lib/core/planTypes';
import { IDEA_DATE_REORDER_DELTA_THRESHOLD } from './ideaDateConfig';
import { evaluateIdeaDateJourney } from './evaluate';
import type { IdeaDateComputedMetrics } from './recompute';
import { toScore100 } from './scoring';
import type { IdeaDateSuggestion } from './types';

type ReorderCandidate = {
  stopId: string;
  toIndex: number;
  stops: Plan['stops'];
};

const MAX_REORDER_CANDIDATES = 80;

function moveStop(stops: Plan['stops'], fromIndex: number, toIndex: number): Plan['stops'] {
  const next = [...stops];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function swapAdjacent(stops: Plan['stops'], leftIndex: number): Plan['stops'] {
  const next = [...stops];
  const temp = next[leftIndex];
  next[leftIndex] = next[leftIndex + 1];
  next[leftIndex + 1] = temp;
  return next;
}

function buildCandidates(stops: Plan['stops']): ReorderCandidate[] {
  const candidates: ReorderCandidate[] = [];
  const N = stops.length;
  if (N < 2) return candidates;

  for (let index = 0; index < N - 1; index += 1) {
    const stop = stops[index];
    candidates.push({
      stopId: stop.id,
      toIndex: index + 1,
      stops: swapAdjacent(stops, index),
    });
    if (candidates.length >= MAX_REORDER_CANDIDATES) return candidates;
  }

  for (let fromIndex = 0; fromIndex < N; fromIndex += 1) {
    for (let toIndex = 0; toIndex < N; toIndex += 1) {
      if (fromIndex === toIndex) continue;
      const stop = stops[fromIndex];
      candidates.push({
        stopId: stop.id,
        toIndex,
        stops: moveStop(stops, fromIndex, toIndex),
      });
      if (candidates.length >= MAX_REORDER_CANDIDATES) {
        return candidates;
      }
    }
  }

  return candidates;
}

function resolveReasonCode(base: ReturnType<typeof evaluateIdeaDateJourney>, next: ReturnType<typeof evaluateIdeaDateJourney>): string {
  const frictionGain = base.frictionPenalty - next.frictionPenalty;
  const fatigueGain = base.fatiguePenalty - next.fatiguePenalty;
  if (frictionGain >= fatigueGain && frictionGain > 0.05) return 'reduce_friction';
  if (fatigueGain > 0.05) return 'arc_smoothing';
  return 'intent_alignment';
}

export function generateReorderSuggestion(
  plan: Plan,
  computed: IdeaDateComputedMetrics
): IdeaDateSuggestion | null {
  const stops = plan.stops ?? [];
  if (stops.length < 3) return null;

  const baseEvaluation = evaluateIdeaDateJourney(plan);
  const baseScore = computed.journeyScore ?? baseEvaluation.journeyScore;
  const candidates = buildCandidates(stops);
  let best: {
    candidate: ReorderCandidate;
    evaluation: ReturnType<typeof evaluateIdeaDateJourney>;
    delta: number;
  } | null = null;

  for (const candidate of candidates) {
    const candidatePlan: Plan = {
      ...plan,
      stops: candidate.stops,
    };
    const evaluation = evaluateIdeaDateJourney(candidatePlan);
    const delta = evaluation.journeyScore - baseScore;
    if (!best || delta > best.delta) {
      best = { candidate, evaluation, delta };
    }
  }

  if (!best || best.delta < IDEA_DATE_REORDER_DELTA_THRESHOLD) {
    return null;
  }

  const before100 = toScore100(baseScore);
  const after100 = toScore100(best.evaluation.journeyScore);

  return {
    id: `idea-date-reorder-${best.candidate.stopId}-${best.candidate.toIndex}`,
    kind: 'reorder',
    reasonCode: resolveReasonCode(baseEvaluation, best.evaluation),
    patchOps: [
      {
        op: 'moveStop',
        stopId: best.candidate.stopId,
        toIndex: best.candidate.toIndex,
      },
    ],
    impact: {
      before: baseScore,
      after: best.evaluation.journeyScore,
      delta: best.delta,
      before100,
      after100,
    },
    preview: true,
    subjectStopId: best.candidate.stopId,
  };
}

