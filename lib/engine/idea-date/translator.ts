import type { IdeaDateVibeId } from './ideaDateConfig';
import type { IdeaDateViolation } from './recompute';
import type { IdeaDateSuggestion } from './types';

export type IdeaDateTranslation = {
  title: string;
  note: string;
  constraintNote?: string;
  debugNarrativeComponents?: string[];
  chips: string[];
};

export type IdeaDateTranslateContext = {
  stopById?: Record<
    string,
    {
      name?: string;
      role?: 'start' | 'main' | 'windDown' | 'flex';
    }
  >;
  debug?: boolean;
};

function vibeLabel(vibeId: IdeaDateVibeId): string {
  if (vibeId === 'anniversary_intimate') return 'Anniversary';
  return 'First date';
}

function uniqueChips(chips: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const chip of chips) {
    if (seen.has(chip)) continue;
    seen.add(chip);
    output.push(chip);
    if (output.length >= 3) break;
  }
  return output;
}

function normalizeNarrativeLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function dedupeNarrativeComponents(lines: Array<string | null | undefined>): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    const normalized = normalizeNarrativeLine(line);
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped;
}

function extractPrimaryClause(line: string | null | undefined): string {
  const normalized = normalizeNarrativeLine(line);
  if (!normalized) return '';
  const firstLine = normalized.split(/\r?\n/)[0]?.trim() ?? '';
  if (!firstLine) return '';
  const firstSentenceMatch = firstLine.match(/^(.+?[.!?])(?:\s|$)/);
  if (firstSentenceMatch?.[1]) return firstSentenceMatch[1].trim();
  return firstLine;
}

function containsAnyTerm(line: string, terms: readonly string[]): boolean {
  const normalized = normalizeNarrativeLine(line).toLowerCase();
  if (!normalized) return false;
  return terms.some((term) => normalized.includes(term));
}

function isHardConstraintNarrative(line: string): boolean {
  return containsAnyTerm(line, ['hard constraint']);
}

function isSoftConstraintNarrative(line: string): boolean {
  return containsAnyTerm(line, ['soft constraint', 'pacing constraints']);
}

function isArcNarrative(line: string): boolean {
  return containsAnyTerm(line, ['peak', 'taper', 'build', 'arc', 'pacing']);
}

function isFrictionNarrative(line: string): boolean {
  return containsAnyTerm(line, ['friction', 'transfer', 'travel', 'backtracking', 'walking', 'route']);
}

function hasLaterPeakSemantics(line: string): boolean {
  return containsAnyTerm(line, [
    'later peak',
    'peak later',
    'moves the peak later',
    'build longer',
    'toward a later peak',
  ]);
}

function hasEarlierPeakSemantics(line: string): boolean {
  return containsAnyTerm(line, [
    'earlier peak',
    'peak earlier',
    'moves the peak earlier',
    'quicker wind-down',
    'earlier peak and quicker wind-down',
  ]);
}

function hasWalkingSemantics(line: string): boolean {
  return containsAnyTerm(line, ['less walking', 'longer stroll', 'walking']);
}

function isTiltNarrativeRedundant(primaryLine: string, tiltLine: string): boolean {
  const normalizedPrimary = normalizeNarrativeLine(primaryLine).toLowerCase();
  const normalizedTilt = normalizeNarrativeLine(tiltLine).toLowerCase();
  if (!normalizedPrimary || !normalizedTilt) return true;
  if (normalizedPrimary === normalizedTilt) return true;
  if (isHardConstraintNarrative(primaryLine) && isHardConstraintNarrative(tiltLine)) return true;
  if (isSoftConstraintNarrative(primaryLine) && isSoftConstraintNarrative(tiltLine)) return true;
  if (hasLaterPeakSemantics(primaryLine) && hasLaterPeakSemantics(tiltLine)) return true;
  if (hasEarlierPeakSemantics(primaryLine) && hasEarlierPeakSemantics(tiltLine)) return true;
  if (hasWalkingSemantics(primaryLine) && hasWalkingSemantics(tiltLine)) return true;
  return false;
}

function pickPriorityPrimaryNarrative(baseNote: string, suggestion: IdeaDateSuggestion): string {
  const structuralPrimary = extractPrimaryClause(suggestion.meta?.structuralNarrative);
  const constraintNarrative = normalizeNarrativeLine(suggestion.meta?.constraintNarrativeNote);
  const baseNarrative = normalizeNarrativeLine(baseNote);
  const hardDelta = suggestion.meta?.constraintDelta?.deltas.hardDelta ?? 0;
  const softDelta = suggestion.meta?.constraintDelta?.deltas.softDelta ?? 0;

  const hardCandidate = (() => {
    if (hardDelta < 0) {
      return constraintNarrative
        || (isHardConstraintNarrative(structuralPrimary) ? structuralPrimary : 'Fixes a hard constraint');
    }
    if (isHardConstraintNarrative(constraintNarrative)) return constraintNarrative;
    if (isHardConstraintNarrative(structuralPrimary)) return structuralPrimary;
    return null;
  })();
  if (hardCandidate) return hardCandidate;

  const softCandidate = (() => {
    if (softDelta < 0) {
      return constraintNarrative
        || (isSoftConstraintNarrative(structuralPrimary) ? structuralPrimary : 'Improves pacing constraints');
    }
    if (isSoftConstraintNarrative(constraintNarrative)) return constraintNarrative;
    if (isSoftConstraintNarrative(structuralPrimary)) return structuralPrimary;
    return null;
  })();
  if (softCandidate) return softCandidate;

  if (isArcNarrative(structuralPrimary)) return structuralPrimary;
  if (isArcNarrative(baseNarrative)) return baseNarrative;

  if (isFrictionNarrative(structuralPrimary)) return structuralPrimary;
  if (isFrictionNarrative(baseNarrative)) return baseNarrative;

  return structuralPrimary || baseNarrative || 'Improves overall flow quality.';
}

function composeNarrativeNotes(
  baseNote: string,
  suggestion: IdeaDateSuggestion,
  debugMode: boolean
): { note: string; constraintNote: string | null; debugNarrativeComponents: string[] } {
  const primaryLine = pickPriorityPrimaryNarrative(baseNote, suggestion);
  const tiltLine = normalizeNarrativeLine(suggestion.meta?.conciergeTiltNote);
  const supportingTiltLine =
    tiltLine && !isTiltNarrativeRedundant(primaryLine, tiltLine) ? tiltLine : null;
  const noteLines = [primaryLine, supportingTiltLine].filter(
    (line): line is string => Boolean(line)
  );
  const rawComponents = dedupeNarrativeComponents([
    baseNote,
    extractPrimaryClause(suggestion.meta?.structuralNarrative),
    suggestion.meta?.constraintNarrativeNote,
    suggestion.meta?.conciergeTiltNote,
  ]);

  return {
    note: noteLines.slice(0, 2).join('\n'),
    constraintNote: debugMode ? normalizeNarrativeLine(suggestion.meta?.constraintNarrativeNote) || null : null,
    debugNarrativeComponents: debugMode ? rawComponents : [],
  };
}

function inferRoleFromStopId(stopId: string | null): 'start' | 'main' | 'windDown' | 'flex' {
  if (!stopId) return 'main';
  const explicit = /(?:^|[-_])start(?:$|[-_])/i.test(stopId);
  if (explicit) return 'start';
  if (/(?:^|[-_])main(?:$|[-_])/i.test(stopId)) return 'main';
  if (/(?:^|[-_])wind(?:down)?(?:$|[-_])/i.test(stopId)) return 'windDown';
  const trailingIndexMatch = stopId.match(/(\d+)(?!.*\d)/);
  const trailingIndex = trailingIndexMatch ? Number.parseInt(trailingIndexMatch[1], 10) : null;
  if (trailingIndex === 1) return 'start';
  if (trailingIndex === 2) return 'main';
  if (trailingIndex === 3) return 'windDown';
  return 'main';
}

function roleLabel(role: 'start' | 'main' | 'windDown' | 'flex'): 'Start' | 'Main' | 'Wind-down' {
  if (role === 'start') return 'Start';
  if (role === 'windDown') return 'Wind-down';
  return 'Main';
}

function fallbackStopName(stopId: string | null): string {
  if (!stopId) return 'Current stop';
  const trailingIndexMatch = stopId.match(/(\d+)(?!.*\d)/);
  if (trailingIndexMatch) return `Stop ${trailingIndexMatch[1]}`;
  return 'Current stop';
}

function findReplaceOp(suggestion: IdeaDateSuggestion): Extract<IdeaDateSuggestion['patchOps'][number], { op: 'replaceStop' }> | null {
  for (const op of suggestion.patchOps) {
    if (op.op === 'replaceStop') return op;
  }
  return null;
}

function readSignals(
  suggestion: IdeaDateSuggestion,
  violations: IdeaDateViolation[],
  impact: { intentScore?: number; journeyScore?: number }
): {
  travel: boolean;
  pacing: boolean;
  vibe: boolean;
  risk: boolean;
  flow: boolean;
} {
  const violationTypes = new Set(violations.map((violation) => violation.type));
  const travel =
    suggestion.reasonCode === 'reduce_friction' ||
    suggestion.reasonCode === 'friction_relief' ||
    suggestion.reasonCode === 'dev_fallback_friction_relief' ||
    violationTypes.has('friction_high') ||
    violationTypes.has('travel_edge_high');
  const pacing =
    suggestion.reasonCode === 'arc_smoothing' ||
    violationTypes.has('no_taper') ||
    violationTypes.has('double_peak') ||
    violationTypes.has('fatigue_high');
  const vibe =
    suggestion.reasonCode === 'intent_alignment' ||
    suggestion.reasonCode === 'intent_rescue' ||
    violationTypes.has('intent_low') ||
    (impact.intentScore ?? 1) < 0.7;
  const risk = violations.some((violation) => violation.severity === 'critical' || violation.severity === 'warn');
  const flow = (suggestion.arcImpact?.deltaTotal ?? 0) > 0 || (suggestion.impact?.delta ?? 0) > 0;
  return { travel, pacing, vibe, risk, flow };
}

export function translateSuggestion(
  suggestion: IdeaDateSuggestion,
  violations: IdeaDateViolation[],
  impact: { intentScore?: number; journeyScore?: number },
  vibeId: IdeaDateVibeId,
  context?: IdeaDateTranslateContext
): IdeaDateTranslation {
  const signals = readSignals(suggestion, violations, impact);

  if (suggestion.kind === 'replacement') {
    const replaceOp = findReplaceOp(suggestion);
    const targetStopId = replaceOp?.stopId ?? suggestion.subjectStopId ?? null;
    const contextRole = targetStopId ? context?.stopById?.[targetStopId]?.role : undefined;
    const normalizedRole = contextRole ?? inferRoleFromStopId(targetStopId);
    const fromName =
      suggestion.meta?.originalPlaceName?.trim() ||
      ((targetStopId ? context?.stopById?.[targetStopId]?.name : null) ??
        fallbackStopName(targetStopId));
    const toName =
      suggestion.newPlace?.name ??
      replaceOp?.newPlace.name ??
      replaceOp?.newPlace.placeLite?.name ??
      replaceOp?.newPlace.placeRef?.label ??
      'Suggested stop';

    const note = (() => {
      if (signals.travel) {
        return `Swapping this ${roleLabel(normalizedRole).toLowerCase()} stop cuts long transfers and keeps the evening moving.`;
      }
      if (signals.pacing) {
        return 'This swap smooths pacing so the evening builds to a peak and tapers naturally.';
      }
      if (signals.vibe) {
        return `This swap better matches your ${vibeLabel(vibeId).toLowerCase()} vibe while keeping momentum steady.`;
      }
      return 'This swap makes the route feel smoother and easier to follow.';
    })();

    const chips = uniqueChips([
      ...(signals.travel ? ['Less travel'] : []),
      ...(signals.pacing ? ['Pacing fixed'] : []),
      ...(signals.vibe ? ['Vibe fit up'] : []),
      ...(signals.risk ? ['Risk down'] : []),
      ...(signals.flow ? ['Flow up'] : []),
      'Pacing smoother',
      'Less travel',
    ]);

    const narrative = composeNarrativeNotes(note, suggestion, context?.debug === true);
    return {
      title: `Swap ${roleLabel(normalizedRole)}: ${fromName} \u2192 ${toName}`,
      note: narrative.note,
      ...(narrative.constraintNote ? { constraintNote: narrative.constraintNote } : {}),
      ...(narrative.debugNarrativeComponents.length > 0
        ? { debugNarrativeComponents: narrative.debugNarrativeComponents }
        : {}),
      chips,
    };
  }

  if (suggestion.kind === 'reorder') {
    const chips = uniqueChips([
      ...(signals.travel ? ['Less travel'] : []),
      ...(signals.flow ? ['Flow up'] : []),
      ...(signals.pacing ? ['Pacing smoother'] : []),
      ...(signals.risk ? ['Risk down'] : []),
      'Flow up',
      'Pacing smoother',
      'Less travel',
    ]);
    const narrative = composeNarrativeNotes(
      'Reduces backtracking and smooths pacing.',
      suggestion,
      context?.debug === true
    );
    return {
      title: 'Reorder to improve flow',
      note: narrative.note,
      ...(narrative.constraintNote ? { constraintNote: narrative.constraintNote } : {}),
      ...(narrative.debugNarrativeComponents.length > 0
        ? { debugNarrativeComponents: narrative.debugNarrativeComponents }
        : {}),
      chips,
    };
  }

  const chips = uniqueChips([
    ...(signals.travel ? ['Less travel'] : []),
    ...(signals.pacing ? ['Pacing smoother'] : []),
    ...(signals.vibe ? ['Vibe fit up'] : []),
    ...(signals.risk ? ['Risk down'] : []),
    ...(signals.flow ? ['Flow up'] : []),
    'Flow up',
    'Pacing smoother',
    'Less travel',
  ]);

  const note = (() => {
    if (signals.travel) return 'Cuts long transfers and keeps the plan moving smoothly.';
    if (signals.pacing) return 'Smooths pacing from start to finish.';
    if (signals.vibe) return `Improves fit for your ${vibeLabel(vibeId).toLowerCase()} vibe.`;
    if (signals.risk) return 'Lowers key flow risks while preserving momentum.';
    return 'Improves overall flow quality.';
  })();

  const narrative = composeNarrativeNotes(note, suggestion, context?.debug === true);
  return {
    title: 'Improve evening flow',
    note: narrative.note,
    ...(narrative.constraintNote ? { constraintNote: narrative.constraintNote } : {}),
    ...(narrative.debugNarrativeComponents.length > 0
      ? { debugNarrativeComponents: narrative.debugNarrativeComponents }
      : {}),
    chips,
  };
}

export function translateFinalSummary(violations: IdeaDateViolation[]): string[] {
  if (violations.length === 0) {
    return ['Flow is stable with no major violations detected.'];
  } else {
    const sorted = [...violations].sort((a, b) => {
      const severityOrder = { critical: 0, warn: 1, info: 2 } as const;
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
    const bullets: string[] = [];
    for (const violation of sorted) {
      if (bullets.length >= 3) break;
      bullets.push(violation.details);
    }
    return bullets;
  }
}


