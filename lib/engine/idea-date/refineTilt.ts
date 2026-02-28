import type { IdeaDateArcContributionOptions } from './arcContribution';
import {
  getIdeaDateModePolicy,
  normalizeIdeaDateMode,
  type IdeaDateMode,
} from '@/lib/idea-date/modePolicy';

export type IdeaDatePrefTiltValue = -1 | 0 | 1;

export type IdeaDatePrefTilt = {
  vibe: IdeaDatePrefTiltValue;
  walking: IdeaDatePrefTiltValue;
  peak: IdeaDatePrefTiltValue;
};

export type IdeaDateRefineWeightMap = {
  transitionSmoothnessWeight: number;
  peakAlignmentWeight: number;
  taperIntegrityWeight: number;
  fatigueImpactWeight: number;
  frictionImpactWeight: number;
  idealPeakShift: number;
};

export type IdeaDateRefineTiltProfile = {
  mode: IdeaDateMode;
  planPrefTilt: IdeaDatePrefTilt;
  modeDefaults: IdeaDatePrefTilt;
  effectiveTilt: IdeaDatePrefTilt;
  // Backward-compatible alias for effectiveTilt.
  prefTilt: IdeaDatePrefTilt;
  applied: boolean;
  weightMap: IdeaDateRefineWeightMap;
  arcContributionOptions?: IdeaDateArcContributionOptions;
};

export type IdeaDateTiltNarrativeContext = {
  worstEdgeMinutesSaved: number;
  totalTravelMinutesSaved: number;
  deltaArcContributionTotal: number;
  fixedArcIssue: boolean;
};

export const IDEA_DATE_DEFAULT_PREF_TILT: IdeaDatePrefTilt = {
  vibe: 0,
  walking: 0,
  peak: 0,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeTiltValue(value: unknown): IdeaDatePrefTiltValue {
  if (value === -1 || value === 0 || value === 1) return value;
  const rounded = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  if (rounded <= -1) return -1;
  if (rounded >= 1) return 1;
  return 0;
}

export function normalizeIdeaDatePrefTilt(input?: Partial<IdeaDatePrefTilt> | null): IdeaDatePrefTilt {
  return {
    vibe: normalizeTiltValue(input?.vibe),
    walking: normalizeTiltValue(input?.walking),
    peak: normalizeTiltValue(input?.peak),
  };
}

export function isIdeaDatePrefTiltNeutral(input?: Partial<IdeaDatePrefTilt> | null): boolean {
  const normalized = normalizeIdeaDatePrefTilt(input);
  return normalized.vibe === 0 && normalized.walking === 0 && normalized.peak === 0;
}

export function buildIdeaDateRefineTiltProfile(
  input?: Partial<IdeaDatePrefTilt> | null,
  mode?: IdeaDateMode
): IdeaDateRefineTiltProfile {
  const normalizedMode = normalizeIdeaDateMode(mode);
  const planPrefTilt = normalizeIdeaDatePrefTilt(input);
  const modeDefaults = normalizeIdeaDatePrefTilt(getIdeaDateModePolicy(normalizedMode).defaultPrefTilt);
  const effectiveTilt = isIdeaDatePrefTiltNeutral(planPrefTilt) ? modeDefaults : planPrefTilt;
  const applied = effectiveTilt.vibe !== 0 || effectiveTilt.walking !== 0 || effectiveTilt.peak !== 0;
  const weightMap: IdeaDateRefineWeightMap = {
    transitionSmoothnessWeight: clamp(1 + (-effectiveTilt.walking * 0.08), 0.9, 1.16),
    peakAlignmentWeight: clamp(1 + (effectiveTilt.vibe * 0.16), 0.84, 1.16),
    taperIntegrityWeight: 1,
    fatigueImpactWeight: clamp(1 + (effectiveTilt.walking * 0.1), 0.9, 1.1),
    frictionImpactWeight: clamp(1 + (-effectiveTilt.walking * 0.16), 0.84, 1.16),
    idealPeakShift: effectiveTilt.peak,
  };

  return {
    mode: normalizedMode,
    planPrefTilt,
    modeDefaults,
    effectiveTilt,
    prefTilt: effectiveTilt,
    applied,
    weightMap,
    arcContributionOptions: applied
      ? {
          weights: {
            transitionSmoothnessWeight: weightMap.transitionSmoothnessWeight,
            peakAlignmentWeight: weightMap.peakAlignmentWeight,
            taperIntegrityWeight: weightMap.taperIntegrityWeight,
            fatigueImpactWeight: weightMap.fatigueImpactWeight,
            frictionImpactWeight: weightMap.frictionImpactWeight,
          },
          idealPeakShift: weightMap.idealPeakShift,
        }
      : undefined,
  };
}

function hasMeaningfulTravelDelta(context: IdeaDateTiltNarrativeContext): boolean {
  return context.worstEdgeMinutesSaved >= 2 || context.totalTravelMinutesSaved >= 5;
}

function hasMeaningfulPeakContext(context: IdeaDateTiltNarrativeContext): boolean {
  return context.fixedArcIssue || context.deltaArcContributionTotal > 0.01;
}

export function buildIdeaDateTiltNarrativeNote(input: {
  prefTilt?: Partial<IdeaDatePrefTilt> | null;
  context: IdeaDateTiltNarrativeContext;
}): string | null {
  const prefTilt = normalizeIdeaDatePrefTilt(input.prefTilt);
  const hasWalkingTilt = prefTilt.walking !== 0;
  const hasPeakTilt = prefTilt.peak !== 0;
  const hasVibeTilt = prefTilt.vibe !== 0;
  const hasAnyTilt = hasWalkingTilt || hasPeakTilt || hasVibeTilt;
  if (!hasAnyTilt) return null;

  if (hasWalkingTilt && hasMeaningfulTravelDelta(input.context)) {
    if (prefTilt.walking < 0) {
      return 'Director note: this leans toward less walking while keeping the route smooth.';
    }
    return 'Director note: this keeps a longer stroll where it supports the flow.';
  }

  if (hasPeakTilt && hasMeaningfulPeakContext(input.context)) {
    if (prefTilt.peak < 0) {
      return 'Director note: this nudges the plan toward an earlier peak and quicker wind-down.';
    }
    return 'Director note: this lets the evening build longer toward a later peak.';
  }

  if (hasVibeTilt) {
    if (prefTilt.vibe < 0) {
      return 'Director note: this keeps the tone calmer and lower-pressure.';
    }
    return 'Director note: this keeps the tone livelier with a stronger build.';
  }

  return null;
}
