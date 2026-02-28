export type StructuralNarrativeDeltaInput = {
  deltaArc: number;
  constraintDelta?: {
    hardDelta: number;
    softDelta: number;
    improvedKinds?: string[];
  };
  arcContext?: {
    buildImproved?: boolean;
    peakShifted?: 'earlier' | 'later';
    taperImproved?: boolean;
  };
  frictionReduced?: boolean;
  tiltInfluence?: {
    peakShift?: number;
    walkingReduced?: boolean;
  };
};

const MAX_NARRATIVE_CHARS = 160;

function hasHardConstraintReduction(input: StructuralNarrativeDeltaInput): boolean {
  return (input.constraintDelta?.hardDelta ?? 0) < 0;
}

function hasSoftConstraintReduction(input: StructuralNarrativeDeltaInput): boolean {
  return (input.constraintDelta?.softDelta ?? 0) < 0;
}

function pickPrimaryClause(input: StructuralNarrativeDeltaInput): string | null {
  if (hasHardConstraintReduction(input)) {
    return 'Fixes a hard constraint';
  }
  if (input.arcContext?.peakShifted === 'earlier') {
    return 'Moves the peak earlier';
  }
  if (input.arcContext?.peakShifted === 'later') {
    return 'Moves the peak later';
  }
  if (input.arcContext?.taperImproved) {
    return 'Improves the taper';
  }
  if (input.arcContext?.buildImproved) {
    return 'Improves the build';
  }
  return null;
}

function pickTiltClause(input: StructuralNarrativeDeltaInput): string | null {
  const tiltInfluence = input.tiltInfluence;
  if (!tiltInfluence) return null;
  if (tiltInfluence.walkingReduced) {
    return 'Leans toward less walking';
  }
  const peakShift = tiltInfluence.peakShift ?? 0;
  if (peakShift > 0) return 'Leans toward a later peak';
  if (peakShift < 0) return 'Leans toward an earlier peak';
  return null;
}

function pickSupportingClause(input: StructuralNarrativeDeltaInput): string | null {
  if (input.frictionReduced) {
    return 'Reduces transition friction';
  }
  if (hasSoftConstraintReduction(input)) {
    return 'Reduces soft constraints';
  }
  return pickTiltClause(input);
}

export function composeStructuralNarrativeDelta(input: StructuralNarrativeDeltaInput): string | null {
  const primaryClause = pickPrimaryClause(input);
  if (!primaryClause) return null;

  const supportingClause = pickSupportingClause(input);
  const composed = [primaryClause, supportingClause].filter((clause): clause is string => Boolean(clause)).join('. ');
  if (composed.length <= MAX_NARRATIVE_CHARS) {
    return composed;
  }

  const primaryOnly = primaryClause;
  if (primaryOnly.length <= MAX_NARRATIVE_CHARS) {
    return primaryOnly;
  }
  return primaryOnly.slice(0, MAX_NARRATIVE_CHARS).trimEnd();
}
