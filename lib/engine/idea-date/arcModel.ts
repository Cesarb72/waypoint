import { computeFatiguePenalty } from './scoring';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export type ArcPoint = {
  x: number;
  y: number;
};

export type IdeaDateArcModel = {
  points: ArcPoint[];
  peakIndexIdeal: number;
  peakIndexActual: number;
  flags: {
    peakEarly: boolean;
    peakLate: boolean;
    doublePeak: boolean;
    noTaper: boolean;
  };
};

export function buildArcModel(stopsEnergyLevels: number[]): IdeaDateArcModel {
  if (stopsEnergyLevels.length === 0) {
    return {
      points: [],
      peakIndexIdeal: 0,
      peakIndexActual: 0,
      flags: { peakEarly: false, peakLate: false, doublePeak: false, noTaper: false },
    };
  }

  const N = stopsEnergyLevels.length;
  const denominator = Math.max(1, N - 1);
  const points = stopsEnergyLevels.map((energy, index) => ({
    x: index / denominator,
    y: 0.2 + 0.6 * clamp01(energy),
  }));

  const fatigue = computeFatiguePenalty(stopsEnergyLevels.map((value) => clamp01(value)));

  return {
    points,
    peakIndexIdeal: fatigue.idealPeakIndex,
    peakIndexActual: fatigue.actualPeakIndex,
    flags: {
      peakEarly: fatigue.actualPeakIndex < fatigue.idealPeakIndex,
      peakLate: fatigue.actualPeakIndex > fatigue.idealPeakIndex,
      doublePeak: fatigue.doublePeak === 1,
      noTaper: fatigue.noTaper === 1,
    },
  };
}
