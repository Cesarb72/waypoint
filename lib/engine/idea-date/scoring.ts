import {
  IDEA_DATE_COMPOSITE_WEIGHTS,
  IDEA_DATE_INTENT_KEYS,
  type IdeaDateCompositeWeights,
  type IdeaDateIntentVector,
} from './ideaDateConfig';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export type FatiguePenaltyResult = {
  penalty: number;
  peakDeviation: number;
  doublePeak: number;
  noTaper: number;
  actualPeakIndex: number;
  idealPeakIndex: number;
};

export type FrictionTransition = {
  minutes: number;
  distanceM?: number;
  fromKey?: string;
  toKey?: string;
};

export type FrictionPenaltyResult = {
  penalty: number;
  edgePenalty: number;
  travelSharePenalty: number;
  backtrackingPenalty: number;
  travelShare: number;
};

export function computeStopIntentScore(
  stopIntentVector: IdeaDateIntentVector,
  vibeTarget: IdeaDateIntentVector,
  vibeImportance: IdeaDateIntentVector
): number {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const key of IDEA_DATE_INTENT_KEYS) {
    const weight = Math.max(0.01, vibeImportance[key]);
    const delta = Math.abs(stopIntentVector[key] - vibeTarget[key]);
    const alignment = clamp01(1 - delta);
    weightedScore += alignment * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return 0;
  return clamp01(weightedScore / totalWeight);
}

export function computeJourneyIntentScore(
  stops: Array<{
    intentVector: IdeaDateIntentVector;
    vibeTarget: IdeaDateIntentVector;
    vibeImportance: IdeaDateIntentVector;
  }>
): number {
  if (stops.length === 0) return 0;
  const total = stops.reduce(
    (sum, stop) =>
      sum + computeStopIntentScore(stop.intentVector, stop.vibeTarget, stop.vibeImportance),
    0
  );
  return clamp01(total / stops.length);
}

export function computeFatiguePenalty(stopsEnergyNormalized: number[]): FatiguePenaltyResult {
  if (stopsEnergyNormalized.length === 0) {
    return {
      penalty: 0,
      peakDeviation: 0,
      doublePeak: 0,
      noTaper: 0,
      actualPeakIndex: 0,
      idealPeakIndex: 0,
    };
  }
  const N = stopsEnergyNormalized.length;
  const idealPeakIndex = Math.round(N * 0.5);
  const peakValue = Math.max(...stopsEnergyNormalized);
  const peakIndices = stopsEnergyNormalized
    .map((value, index) => ({ value, index }))
    .filter((point) => point.value === peakValue)
    .map((point) => point.index);
  const actualPeakIndex = peakIndices[0] ?? 0;
  const peakDeviation = clamp01(Math.abs(actualPeakIndex - idealPeakIndex) / N);
  const doublePeak = peakIndices.length >= 2 ? 1 : 0;
  const lastEnergy = stopsEnergyNormalized[N - 1] ?? 0;
  const noTaper = lastEnergy >= peakValue ? 1 : 0;
  const penalty = clamp01(0.5 * peakDeviation + 0.3 * doublePeak + 0.2 * noTaper);

  return {
    penalty,
    peakDeviation,
    doublePeak,
    noTaper,
    actualPeakIndex,
    idealPeakIndex,
  };
}

function edgeWalkFriction(minutes: number): number {
  if (minutes <= 12) return 0;
  if (minutes <= 18) {
    return ((minutes - 12) / 6) * 0.5;
  }
  const beyond = minutes - 18;
  return clamp01(0.5 + (beyond / 12) * 0.5);
}

function backtrackingHeuristic(transitions: FrictionTransition[]): number {
  let hits = 0;
  const seen = new Set<string>();
  for (const transition of transitions) {
    if (transition.toKey && seen.has(transition.toKey) && transition.toKey !== transition.fromKey) {
      hits += 1;
    }
    if (transition.fromKey) seen.add(transition.fromKey);
    if (transition.toKey) seen.add(transition.toKey);
  }
  return clamp01(hits * 0.4);
}

export function computeFrictionPenalty(
  transitions: FrictionTransition[],
  options?: { totalStopMinutes?: number }
): FrictionPenaltyResult {
  if (transitions.length === 0) {
    return {
      penalty: 0,
      edgePenalty: 0,
      travelSharePenalty: 0,
      backtrackingPenalty: 0,
      travelShare: 0,
    };
  }
  const edgeScores = transitions.map((transition) => edgeWalkFriction(transition.minutes));
  const edgePenalty = clamp01(edgeScores.reduce((sum, score) => sum + score, 0) / edgeScores.length);
  const totalTravelMinutes = transitions.reduce((sum, transition) => sum + Math.max(0, transition.minutes), 0);
  const totalStopMinutes = Math.max(1, options?.totalStopMinutes ?? 0);
  const travelShare = clamp01(totalTravelMinutes / (totalTravelMinutes + totalStopMinutes));
  const travelSharePenalty =
    travelShare <= 0.35 ? 0 : clamp01((travelShare - 0.35) / 0.3);
  const backtrackingPenalty = backtrackingHeuristic(transitions);
  const penalty = clamp01(
    0.55 * edgePenalty + 0.3 * travelSharePenalty + 0.15 * backtrackingPenalty
  );

  return {
    penalty,
    edgePenalty,
    travelSharePenalty,
    backtrackingPenalty,
    travelShare,
  };
}

export function computeJourneyScore(
  I: number,
  Fa: number,
  Fr: number,
  weights: IdeaDateCompositeWeights = IDEA_DATE_COMPOSITE_WEIGHTS
): number {
  const raw = weights.intent * clamp01(I) + weights.fatigue * (1 - clamp01(Fa)) + weights.friction * (1 - clamp01(Fr));
  return clamp01(raw);
}

export function toScore100(score01: number): number {
  return Math.round(clamp01(score01) * 100);
}
