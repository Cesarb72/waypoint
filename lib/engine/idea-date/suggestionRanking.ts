const ARC_DELTA_SORT_PRECISION = 1_000_000;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeArcDeltaForSort(value: number): number {
  const finite = finiteOrZero(value);
  return Math.round(finite * ARC_DELTA_SORT_PRECISION) / ARC_DELTA_SORT_PRECISION;
}

export type ArcRankable = {
  id: string;
  deltaArcContributionTotal: number;
  legacyRank: number;
};

export function compareArcContributionRank(a: ArcRankable, b: ArcRankable): number {
  const arcDeltaA = normalizeArcDeltaForSort(a.deltaArcContributionTotal);
  const arcDeltaB = normalizeArcDeltaForSort(b.deltaArcContributionTotal);
  if (arcDeltaA !== arcDeltaB) {
    return arcDeltaB - arcDeltaA;
  }
  if (a.legacyRank !== b.legacyRank) {
    return a.legacyRank - b.legacyRank;
  }
  return a.id.localeCompare(b.id);
}

export function sortByArcContributionDelta<T extends ArcRankable>(items: T[]): T[] {
  return [...items].sort(compareArcContributionRank);
}
