import type { ConstraintKind, ConstraintViolation } from './constraints';

export type IdeaDateSuggestionConstraintDelta = {
  baseline: {
    hardCount: number;
    softCount: number;
  };
  after: {
    hardCount: number;
    softCount: number;
  };
  deltas: {
    hardDelta: number;
    softDelta: number;
  };
  improvedKinds: ConstraintKind[];
  worsenedKinds: ConstraintKind[];
};

type ConstraintSnapshot = {
  hardCount: number;
  softCount: number;
  violations: ConstraintViolation[];
};

function clampToInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function toKindCounts(violations: ConstraintViolation[]): Map<ConstraintKind, number> {
  const counts = new Map<ConstraintKind, number>();
  for (const violation of violations) {
    counts.set(violation.kind, (counts.get(violation.kind) ?? 0) + 1);
  }
  return counts;
}

function sortedKinds(kinds: Set<ConstraintKind>): ConstraintKind[] {
  return [...kinds].sort((left, right) => left.localeCompare(right));
}

export function buildIdeaDateSuggestionConstraintDelta(input: {
  baseline: ConstraintSnapshot;
  after: ConstraintSnapshot;
}): IdeaDateSuggestionConstraintDelta {
  const baselineHardCount = clampToInteger(input.baseline.hardCount);
  const baselineSoftCount = clampToInteger(input.baseline.softCount);
  const afterHardCount = clampToInteger(input.after.hardCount);
  const afterSoftCount = clampToInteger(input.after.softCount);
  const baselineKindCounts = toKindCounts(input.baseline.violations ?? []);
  const afterKindCounts = toKindCounts(input.after.violations ?? []);
  const allKinds = new Set<ConstraintKind>([
    ...baselineKindCounts.keys(),
    ...afterKindCounts.keys(),
  ]);
  const improvedKinds: ConstraintKind[] = [];
  const worsenedKinds: ConstraintKind[] = [];
  for (const kind of sortedKinds(allKinds)) {
    const baselineCount = baselineKindCounts.get(kind) ?? 0;
    const afterCount = afterKindCounts.get(kind) ?? 0;
    if (afterCount < baselineCount) {
      improvedKinds.push(kind);
      continue;
    }
    if (afterCount > baselineCount) {
      worsenedKinds.push(kind);
    }
  }

  return {
    baseline: {
      hardCount: baselineHardCount,
      softCount: baselineSoftCount,
    },
    after: {
      hardCount: afterHardCount,
      softCount: afterSoftCount,
    },
    deltas: {
      hardDelta: afterHardCount - baselineHardCount,
      softDelta: afterSoftCount - baselineSoftCount,
    },
    improvedKinds,
    worsenedKinds,
  };
}

export function buildIdeaDateConstraintNarrativeNote(
  delta: IdeaDateSuggestionConstraintDelta
): string | null {
  if (delta.after.hardCount < delta.baseline.hardCount) {
    return 'Fixes a hard constraint by shortening a too-long transfer.';
  }
  if (delta.after.softCount < delta.baseline.softCount) {
    return 'Improves pacing constraints for a cleaner taper.';
  }
  return null;
}
