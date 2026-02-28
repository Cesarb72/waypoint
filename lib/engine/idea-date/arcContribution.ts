import type { FatiguePenaltyResult, FrictionPenaltyResult } from './scoring';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function positiveOrZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value;
}

function clampWeight(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  if (value == null) return 1;
  if (value < 0.8) return 0.8;
  if (value > 1.2) return 1.2;
  return value;
}

function clampPeakShift(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  if (value == null) return 0;
  const rounded = Math.round(value);
  if (rounded < -2) return -2;
  if (rounded > 2) return 2;
  return rounded;
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  const normalized = Number.isFinite(value) ? Math.round(value) : 0;
  if (normalized < 0) return 0;
  if (normalized >= length) return length - 1;
  return normalized;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + finiteOrZero(value), 0);
  return total / values.length;
}

function buildNarrative(input: {
  transitionSmoothness: number;
  peakAlignment: number;
  taperIntegrity: number;
  fatigueImpact: number;
  frictionImpact: number;
  peakAlignmentWeight: number;
  frictionImpactWeight: number;
  fatigueImpactWeight: number;
  penalties: number;
  positives: number;
  index: number;
}): string {
  const stopLabel = `Stop ${input.index + 1}`;
  const weightedFrictionImpact = clamp01(input.frictionImpact * input.frictionImpactWeight);
  const weightedFatigueImpact = clamp01(input.fatigueImpact * input.fatigueImpactWeight);
  const weightedPeakAlignment = clamp01(input.peakAlignment * input.peakAlignmentWeight);
  if (input.penalties > input.positives) {
    if (weightedFrictionImpact >= weightedFatigueImpact && weightedFrictionImpact > 0.2) {
      return `${stopLabel}: transition drag weakens flow around this handoff.`;
    }
    if (weightedFatigueImpact > 0.2) {
      return `${stopLabel}: energy load here adds fatigue and flattens momentum.`;
    }
    if (input.taperIntegrity < 0.45) {
      return `${stopLabel}: taper rhythm breaks here and disrupts the landing.`;
    }
    return `${stopLabel}: contribution is limited, so this beat carries less narrative weight.`;
  }

  if (input.taperIntegrity > 0.75 && weightedPeakAlignment > 0.6) {
    return `${stopLabel}: supports a clean peak-to-taper narrative transition.`;
  }
  if (weightedPeakAlignment > 0.75) {
    return `${stopLabel}: reinforces peak placement in the right part of the journey.`;
  }
  if (input.transitionSmoothness > 0.75) {
    return `${stopLabel}: keeps neighboring transitions smooth and coherent.`;
  }
  return `${stopLabel}: keeps narrative pacing steady without introducing new arc risks.`;
}

export type IdeaDateArcContributionResult = {
  byIndex: number[];
  total: number;
  narrativesByIndex: string[];
};

export type IdeaDateArcContributionWeights = {
  transitionSmoothnessWeight?: number;
  peakAlignmentWeight?: number;
  taperIntegrityWeight?: number;
  fatigueImpactWeight?: number;
  frictionImpactWeight?: number;
};

export type IdeaDateArcContributionOptions = {
  weights?: IdeaDateArcContributionWeights;
  idealPeakShift?: number;
};

export function computeArcContributionByStop(input: {
  energySeries: number[];
  fatigue: FatiguePenaltyResult;
  friction: FrictionPenaltyResult;
  transitionMinutes: number[];
}, options?: IdeaDateArcContributionOptions): IdeaDateArcContributionResult {
  const stopCount = input.energySeries.length;
  if (stopCount === 0) {
    return {
      byIndex: [],
      total: 0,
      narrativesByIndex: [],
    };
  }

  const energies = input.energySeries.map((value) => clamp01(value));
  const denominator = Math.max(1, stopCount - 1);
  const actualPeakIndex = clampIndex(input.fatigue.actualPeakIndex, stopCount);
  const idealPeakIndex = clampIndex(
    input.fatigue.idealPeakIndex + clampPeakShift(options?.idealPeakShift),
    stopCount
  );
  const fatiguePenalty = clamp01(input.fatigue.penalty);
  const frictionPenalty = clamp01(input.friction.penalty);
  const transitionSmoothnessWeight = clampWeight(options?.weights?.transitionSmoothnessWeight);
  const peakAlignmentWeight = clampWeight(options?.weights?.peakAlignmentWeight);
  const taperIntegrityWeight = clampWeight(options?.weights?.taperIntegrityWeight);
  const fatigueImpactWeight = clampWeight(options?.weights?.fatigueImpactWeight);
  const frictionImpactWeight = clampWeight(options?.weights?.frictionImpactWeight);
  const positiveWeightTotal = Math.max(
    0.001,
    transitionSmoothnessWeight * 0.4 + peakAlignmentWeight * 0.35 + taperIntegrityWeight * 0.25
  );
  const penaltyWeightTotal = Math.max(
    0.001,
    fatigueImpactWeight * 0.55 + frictionImpactWeight * 0.45
  );

  const byIndex: number[] = [];
  const narrativesByIndex: string[] = [];

  for (let index = 0; index < stopCount; index += 1) {
    const currentEnergy = energies[index] ?? 0;
    const prevEnergy = index > 0 ? energies[index - 1] ?? currentEnergy : currentEnergy;
    const nextEnergy = index < stopCount - 1 ? energies[index + 1] ?? currentEnergy : currentEnergy;
    const transitionDeltas: number[] = [];
    if (index > 0) transitionDeltas.push(Math.abs(currentEnergy - prevEnergy));
    if (index < stopCount - 1) transitionDeltas.push(Math.abs(nextEnergy - currentEnergy));
    const transitionSmoothness = clamp01(1 - avg(transitionDeltas));

    const slopeIn = currentEnergy - prevEnergy;
    const slopeOut = nextEnergy - currentEnergy;
    let peakAlignment: number;
    if (index < actualPeakIndex) {
      peakAlignment = clamp01(0.5 + 0.35 * slopeIn + 0.15 * slopeOut);
    } else if (index > actualPeakIndex) {
      peakAlignment = clamp01(0.5 + 0.35 * (-slopeIn) + 0.15 * (-slopeOut));
    } else {
      const neighborEnergy = avg([
        index > 0 ? prevEnergy : currentEnergy,
        index < stopCount - 1 ? nextEnergy : currentEnergy,
      ]);
      const crestHeight = clamp01(currentEnergy - neighborEnergy);
      const peakTimingIntegrity = 1 - clamp01(Math.abs(actualPeakIndex - idealPeakIndex) / denominator);
      peakAlignment = clamp01(0.65 * (0.5 + 0.5 * crestHeight) + 0.35 * peakTimingIntegrity);
    }

    let taperIntegrity = 1;
    if (index > 0) {
      const energyDelta = currentEnergy - prevEnergy;
      if (index <= actualPeakIndex) {
        taperIntegrity = clamp01(1 - clamp01(-energyDelta));
      } else {
        taperIntegrity = clamp01(1 - clamp01(energyDelta));
      }
    }
    if (index === stopCount - 1 && input.fatigue.noTaper === 1) {
      taperIntegrity = clamp01(taperIntegrity * 0.7);
    }

    const fatigueImpact = stopCount <= 1
      ? 0
      : clamp01(fatiguePenalty * (0.45 + 0.55 * currentEnergy));

    const prevMinutes = index > 0 ? positiveOrZero(input.transitionMinutes[index - 1] ?? 0) : 0;
    const nextMinutes = index < stopCount - 1 ? positiveOrZero(input.transitionMinutes[index] ?? 0) : 0;
    const localTransitionMinutes = avg(
      [prevMinutes, nextMinutes].filter((minutes, neighborIndex) => {
        if (neighborIndex === 0) return index > 0;
        return index < stopCount - 1;
      })
    );
    const localTransitionLoad = clamp01(localTransitionMinutes / 24);
    const frictionImpact = clamp01(frictionPenalty * (0.5 + 0.5 * localTransitionLoad));

    const positives = clamp01(
      (transitionSmoothness * transitionSmoothnessWeight * 0.4
        + peakAlignment * peakAlignmentWeight * 0.35
        + taperIntegrity * taperIntegrityWeight * 0.25) / positiveWeightTotal
    );
    const penalties = clamp01(
      (fatigueImpact * fatigueImpactWeight * 0.55
        + frictionImpact * frictionImpactWeight * 0.45) / penaltyWeightTotal
    );
    const contribution = clamp01(positives * (1 - penalties));

    byIndex.push(finiteOrZero(contribution));
    narrativesByIndex.push(
      buildNarrative({
        transitionSmoothness,
        peakAlignment,
        taperIntegrity,
        fatigueImpact,
        frictionImpact,
        peakAlignmentWeight,
        frictionImpactWeight,
        fatigueImpactWeight,
        penalties,
        positives,
        index,
      })
    );
  }

  const total = finiteOrZero(byIndex.reduce((sum, value) => sum + finiteOrZero(value), 0));
  return {
    byIndex,
    total,
    narrativesByIndex,
  };
}
