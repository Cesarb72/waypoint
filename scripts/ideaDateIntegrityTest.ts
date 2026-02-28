import type { Plan } from '@/app/plan-engine/types';
import {
  buildIdeaDateConstraintNarrativeNote,
  buildIdeaDateSuggestionConstraintDelta,
  ConstraintKind,
  clearIdeaDateTravelCache,
  generateIdeaDateSuggestionPack,
  generateReorderSuggestion,
  generateReplacementSuggestions,
  generateReplacementSuggestionsWithStats,
  MAX_REORDER_REPAIR_EVALUATED,
  MAX_REPLACEMENT_CANDIDATES_SEEN_PRIMARY,
  MAX_REPLACEMENT_CANDIDATES_SEEN_REPAIR,
  buildIdeaDateTiltNarrativeNote,
  composeStructuralNarrativeDelta,
  normalizeArcDeltaForSort,
  recomputeIdeaDateLive,
  sortByArcContributionDelta,
  translateSuggestion,
} from '@/lib/engine/idea-date';
import { applyIdeaDateOps } from '@/lib/idea-date/ops';
import {
  buildIdeaDateSuggestionSemanticSignature,
  dedupeIdeaDateSuggestionsBySemanticSignature,
  generateIdeaDateSuggestionPackWithTelemetry,
  readPlanPrefTiltMeta,
  readPlanModeMeta,
  withPlanMetaPrefTilt,
  withPlanMetaMode,
  withPlanModeDefaultsApplied,
  type ResolverUsed,
} from '@/lib/idea-date/useIdeaDateLens';
import { applyIdeaDatePatchOps } from '@/lib/engine/idea-date/patchOps';
import { getIdeaDateModePolicy, type IdeaDateMode } from '@/lib/idea-date/modePolicy';
import {
  IDEA_DATE_CLEAN_SEED,
  IDEA_DATE_MESSY_SEED,
  type IdeaDateSeedStop,
  buildIdeaDateSeedPlan,
} from '@/lib/idea-date/seeds';
import { classifyIdeaDatePlaceFamily } from '@/lib/idea-date/placeFamilyAdapter';
import { ideaDatePlaceFamilyAdapter } from '@/lib/idea-date/placeFamilyAdapter';
import { readIdeaDateDiversityPolicy } from '@/lib/idea-date/diversityPolicy';
import { searchIdeaDateCandidates } from '@/lib/idea-date/candidateSearch';
import type { IdeaDatePatchOp, IdeaDateSuggestion } from '@/lib/engine/idea-date/types';

type Snapshot = {
  score100: number;
  score01: number;
  intent: number;
  fatigue: number;
  friction: number;
  violations: string[];
  constraintKinds: string[];
  constraintMessages: string[];
  constraintNarratives: string[];
  constraintHardCount: number;
  constraintSoftCount: number;
  suggestionIds: string[];
  suggestionCount: number;
  arcPoints: number;
  arcContributionTotal: number;
  arcContributionByIndex: number[];
  arcNarrativesByIndex: string[];
  plan: Plan;
};

type StopBoundaryCase = {
  stopCount: number;
  score100: number;
  arcPoints: number;
  arcContributionTotal: number;
  violations: string[];
};

type ResolverTelemetryCheck = {
  resolverUsed: ResolverUsed;
  candidateCount: number;
  resolverError: string | null;
};

type ArcTieBreakCheck = {
  syntheticTiePreserved: boolean;
  observedRuntimeTies: number;
};

type DiversityClassifierCheck = {
  deterministic: boolean;
  families: string[];
};

type QueryHardeningCheck = {
  candidatesSeen: number;
  candidatesKept: number;
  suggestionsGenerated: number;
  passUsed: 'primary' | 'repair' | 'reorder_repair';
  templateUsed: string;
  queryTypesCount: number;
  queryRadiusMeters: number;
  planFamilyKeys: string[];
};

type RepairModeCheck = {
  passUsed: 'primary' | 'repair' | 'reorder_repair';
  suggestionsGenerated: number;
  candidatesSeen: number;
  candidatesKept: number;
};

type ReorderRepairCheck = {
  passUsed: 'primary' | 'repair' | 'reorder_repair';
  suggestionsGenerated: number;
  candidatesSeen: number;
  candidatesKept: number;
  reorderCandidatesEvaluated: number;
};

type HardConstraintGuardrailCheck = {
  discardedAsHardIncrease: number;
  suggestionsGenerated: number;
  hardCandidateDiscarded: boolean;
};

type PrefTiltTriplet = {
  vibe: -1 | 0 | 1;
  walking: -1 | 0 | 1;
  peak: -1 | 0 | 1;
};

type PrefTiltSensitivityCheck = {
  deterministicNeutral: boolean;
  deterministicWalkingSensitive: boolean;
  neutralSuggestionId: string | null;
  walkingSensitiveSuggestionId: string | null;
  changed: boolean;
};

type PrefTiltRefFreshnessCheck = {
  previous: PrefTiltTriplet;
  current: PrefTiltTriplet;
  reported: PrefTiltTriplet | null;
  matchedCurrent: boolean;
  matchedPrevious: boolean;
};

type PrefTiltPlanMetaPersistenceCheck = {
  stored: PrefTiltTriplet;
  restored: PrefTiltTriplet;
  restoredSecondInit: PrefTiltTriplet;
  committedAfterPreview: PrefTiltTriplet;
  previewPlanTilt: PrefTiltTriplet;
  deterministic: boolean;
  unaffectedByPreview: boolean;
};

type ModePolicyDefaultsCheck = {
  defaultWhenMissing: IdeaDateMode;
  modeAfterSet: IdeaDateMode;
  modeAfterReload: IdeaDateMode;
  expectedDefaultPrefTilt: PrefTiltTriplet;
  appliedPrefTilt: PrefTiltTriplet;
  reloadedPrefTilt: PrefTiltTriplet;
  deterministic: boolean;
};

type ModeAwareRefineCompositionCheck = {
  neutralExpected: PrefTiltTriplet;
  neutralModeDefaults: PrefTiltTriplet;
  neutralEffectiveRunOne: PrefTiltTriplet;
  neutralEffectiveRunTwo: PrefTiltTriplet;
  neutralDeterministic: boolean;
  nonNeutralExpected: PrefTiltTriplet;
  nonNeutralEffectiveTouristDay: PrefTiltTriplet;
  nonNeutralEffectiveFamily: PrefTiltTriplet;
  nonNeutralModeIndependent: boolean;
  deterministic: boolean;
};

type TiltNarrativeCouplingCheck = {
  deterministic: boolean;
  walkingNote: string | null;
  peakNote: string | null;
  neutralNote: string | null;
  peakDupGuard: boolean;
};

type ConstraintNarrativeCouplingCheck = {
  deterministic: boolean;
  hardNote: string | null;
  softNote: string | null;
  neutralNote: string | null;
  numericLeakGuard: boolean;
  lineCapGuard: boolean;
  hardPhraseUnique: boolean;
};

type StructuralNarrativeComposerCheck = {
  deterministic: boolean;
  hardClause: string | null;
  peakLaterClause: string | null;
  numericLeakGuard: boolean;
  maxLengthGuard: boolean;
};

type LensSemanticDedupeCheck = {
  before: number;
  after: number;
  duplicateRemoved: boolean;
  reorderBefore: number;
  reorderAfter: number;
  reorderDuplicateRemoved: boolean;
};

type EngineInvariants26Check = {
  recomputePreviewApply: {
    baselineDeterministic: boolean;
    previewIsolation: boolean;
    applyMatchesPreview: boolean;
    suggestionsChecked: number;
  };
  refineIsolation: {
    baselineUnaffectedByModePrefTilt: boolean;
    refineTelemetryChanged: boolean;
    refineDeterministic: boolean;
    topSuggestionSemanticSignature: string | null;
    topSuggestionDeltaArc: number | null;
  };
  patchOpsInvariants: {
    replacementChecked: boolean;
    reorderChecked: boolean;
  };
  suggestionDedupe: {
    uniqueSignatures: boolean;
    stableFirstWins: boolean;
    signatureCount: number;
  };
  narrativeNonLeakage: {
    checkedCount: number;
    passed: boolean;
  };
};

const STOP_BOUNDARY_COUNTS = [2, 3, 6] as const;
const DEGENERATE_FRICTION_EPSILON = 1e-9;

const STOP_BOUNDARY_SEED_BASE: IdeaDateSeedStop[] = [
  {
    name: 'Harbor Coffee Counter',
    categories: ['cafe'],
    lat: 37.7901,
    lng: -122.4018,
    role: 'start',
  },
  {
    name: 'Book Arcade',
    categories: ['book_store'],
    lat: 37.7914,
    lng: -122.4041,
    role: 'main',
  },
  {
    name: 'Bay Window Bistro',
    categories: ['restaurant'],
    lat: 37.7922,
    lng: -122.4069,
    role: 'main',
  },
  {
    name: 'Gallery Passage',
    categories: ['art_gallery'],
    lat: 37.7933,
    lng: -122.4096,
    role: 'main',
  },
  {
    name: 'Quiet Promenade',
    categories: ['park'],
    lat: 37.7944,
    lng: -122.4125,
    role: 'main',
  },
  {
    name: 'Lantern Dessert Bar',
    categories: ['dessert_shop', 'cafe'],
    lat: 37.7953,
    lng: -122.4152,
    role: 'windDown',
  },
];

const IDENTICAL_COORDS_SEED: IdeaDateSeedStop[] = [
  {
    name: 'Same Spot Coffee',
    categories: ['cafe'],
    lat: 37.791,
    lng: -122.404,
    role: 'start',
  },
  {
    name: 'Same Spot Dinner',
    categories: ['restaurant'],
    lat: 37.791,
    lng: -122.404,
    role: 'main',
  },
  {
    name: 'Same Spot Dessert',
    categories: ['dessert_shop'],
    lat: 37.791,
    lng: -122.404,
    role: 'windDown',
  },
];

function clonePlan<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function buildSnapshot(plan: Plan, options?: { withSuggestions?: boolean }): Promise<Snapshot> {
  if (options?.withSuggestions) {
    const pack = await generateIdeaDateSuggestionPack(plan);
    return {
      score100: pack.computed.journeyScore100,
      score01: pack.computed.journeyScore,
      intent: pack.computed.intentScore,
      fatigue: pack.computed.fatiguePenalty,
      friction: pack.computed.frictionPenalty,
      violations: pack.computed.violations.map((violation) => violation.type),
      constraintKinds: pack.computed.constraintViolations.map((violation) => violation.kind),
      constraintMessages: pack.computed.constraintViolations.map((violation) => violation.message),
      constraintNarratives: [...pack.computed.constraintNarratives],
      constraintHardCount: pack.computed.constraintHardCount,
      constraintSoftCount: pack.computed.constraintSoftCount,
      suggestionIds: pack.suggestions.map((suggestion) => suggestion.id),
      suggestionCount: pack.suggestions.length,
      arcPoints: pack.arcModel.points.length,
      arcContributionTotal: pack.computed.arcContributionTotal,
      arcContributionByIndex: pack.computed.arcContributionByIndex,
      arcNarrativesByIndex: pack.computed.arcNarrativesByIndex,
      plan: pack.plan,
    };
  }

  const live = await recomputeIdeaDateLive(plan);
  return {
    score100: live.computed.journeyScore100,
    score01: live.computed.journeyScore,
    intent: live.computed.intentScore,
    fatigue: live.computed.fatiguePenalty,
    friction: live.computed.frictionPenalty,
    violations: live.computed.violations.map((violation) => violation.type),
    constraintKinds: live.computed.constraintViolations.map((violation) => violation.kind),
    constraintMessages: live.computed.constraintViolations.map((violation) => violation.message),
    constraintNarratives: [...live.computed.constraintNarratives],
    constraintHardCount: live.computed.constraintHardCount,
    constraintSoftCount: live.computed.constraintSoftCount,
    suggestionIds: [],
    suggestionCount: 0,
    arcPoints: live.arcModel.points.length,
    arcContributionTotal: live.computed.arcContributionTotal,
    arcContributionByIndex: live.computed.arcContributionByIndex,
    arcNarrativesByIndex: live.computed.arcNarrativesByIndex,
    plan: live.plan,
  };
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertArrayEqual(actual: string[], expected: string[], label: string): void {
  const sameLength = actual.length === expected.length;
  const sameValues = sameLength && actual.every((value, index) => value === expected[index]);
  if (!sameValues) {
    throw new Error(
      `${label} mismatch.\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`
    );
  }
}

function assertFiniteNumber(value: number, label: string): void {
  assertCondition(Number.isFinite(value), `${label} is not finite: ${value}`);
}

function assertFiniteScore100(value: number, label: string): void {
  assertFiniteNumber(value, label);
  assertCondition(Number.isInteger(value), `${label} is not an integer: ${value}`);
  assertCondition(value >= 0 && value <= 100, `${label} is out of range [0,100]: ${value}`);
}

function assertFiniteNumberArray(values: number[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    assertFiniteNumber(values[index], `${label} at index ${index}`);
  }
}

function assertConstraintContract(snapshot: Snapshot, label: string): void {
  assertCondition(
    Number.isInteger(snapshot.constraintHardCount) && snapshot.constraintHardCount >= 0,
    `${label} constraintHardCount must be an integer >= 0, got ${snapshot.constraintHardCount}`
  );
  assertCondition(
    Number.isInteger(snapshot.constraintSoftCount) && snapshot.constraintSoftCount >= 0,
    `${label} constraintSoftCount must be an integer >= 0, got ${snapshot.constraintSoftCount}`
  );
  assertCondition(
    snapshot.constraintKinds.length === snapshot.constraintMessages.length,
    `${label} constraint kinds/messages length mismatch. kinds=${snapshot.constraintKinds.length}, messages=${snapshot.constraintMessages.length}`
  );
  const total = snapshot.constraintHardCount + snapshot.constraintSoftCount;
  assertCondition(
    total === snapshot.constraintKinds.length,
    `${label} constraint counts mismatch. hard+soft=${total}, violations=${snapshot.constraintKinds.length}`
  );
  for (let index = 0; index < snapshot.constraintNarratives.length; index += 1) {
    const narrative = snapshot.constraintNarratives[index];
    assertCondition(
      typeof narrative === 'string' && narrative.trim().length > 0,
      `${label} constraintNarratives[${index}] must be a non-empty string.`
    );
  }
}

function prefTiltTripletMatches(actual: PrefTiltTriplet, expected: PrefTiltTriplet): boolean {
  return actual.vibe === expected.vibe
    && actual.walking === expected.walking
    && actual.peak === expected.peak;
}

function toPrefTiltTriplet(prefTilt: { vibe: -1 | 0 | 1; walking: -1 | 0 | 1; peak: -1 | 0 | 1 }): PrefTiltTriplet {
  return {
    vibe: prefTilt.vibe,
    walking: prefTilt.walking,
    peak: prefTilt.peak,
  };
}

function assertNumberArrayEqual(actual: number[], expected: number[], label: string): void {
  assertCondition(
    actual.length === expected.length,
    `${label} length mismatch. expected=${expected.length}, actual=${actual.length}`
  );
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `${label} mismatch at index ${index}.\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`
      );
    }
  }
}

function assertResolverUsedValue(value: string, label: string): asserts value is ResolverUsed {
  const allowedValues: ResolverUsed[] = ['google', 'local', 'mock', 'unknown'];
  assertCondition(allowedValues.includes(value as ResolverUsed), `${label} is invalid: ${value}`);
}

function assertArcContributionContract(
  stopCount: number,
  arcContributionTotal: number,
  arcContributionByIndex: number[],
  arcNarrativesByIndex: string[],
  label: string
): void {
  assertFiniteNumber(arcContributionTotal, `${label} arcContributionTotal`);
  assertCondition(
    arcContributionByIndex.length === stopCount,
    `${label} arcContributionByIndex length mismatch. expected=${stopCount}, actual=${arcContributionByIndex.length}`
  );
  assertCondition(
    arcNarrativesByIndex.length === stopCount,
    `${label} arcNarrativesByIndex length mismatch. expected=${stopCount}, actual=${arcNarrativesByIndex.length}`
  );
  assertFiniteNumberArray(arcContributionByIndex, `${label} arcContributionByIndex`);
}

function readStopPlaceId(plan: Plan, stopId: string): string | null {
  const stop = (plan.stops ?? []).find((entry) => entry.id === stopId);
  if (!stop) return null;
  const fromRef = stop.placeRef?.placeId?.trim();
  if (fromRef) return fromRef;
  const fromLite = stop.placeLite?.placeId?.trim();
  if (fromLite) return fromLite;
  return null;
}

function assertUniqueStopIds(plan: Plan, label: string): void {
  const stopIds = (plan.stops ?? []).map((stop) => stop.id);
  const uniqueStopIds = new Set(stopIds);
  assertCondition(
    stopIds.length === uniqueStopIds.size,
    `${label}: duplicate stop IDs detected. ids=${JSON.stringify(stopIds)}`
  );
}

function assertReplacementContracts(beforePlan: Plan, afterPlan: Plan, suggestion: IdeaDateSuggestion, label: string): void {
  const replaceOps = suggestion.patchOps.filter((op): op is Extract<IdeaDatePatchOp, { op: 'replaceStop' }> => op.op === 'replaceStop');
  if (replaceOps.length === 0) return;

  assertCondition(
    (afterPlan.stops ?? []).length === (beforePlan.stops ?? []).length,
    `${label}: replacement changed stop count. before=${beforePlan.stops.length}, after=${afterPlan.stops.length}`
  );

  for (const replaceOp of replaceOps) {
    const beforePlaceId = readStopPlaceId(beforePlan, replaceOp.stopId);
    const afterPlaceId = readStopPlaceId(afterPlan, replaceOp.stopId);
    assertCondition(
      beforePlaceId !== afterPlaceId,
      `${label}: replacement did not update place for stop ${replaceOp.stopId}.`
    );
  }
}

function buildBoundarySeed(stopCount: (typeof STOP_BOUNDARY_COUNTS)[number]): IdeaDateSeedStop[] {
  return STOP_BOUNDARY_SEED_BASE.slice(0, stopCount).map((stop, index) => ({
    ...stop,
    role: index === 0 ? 'start' : index === stopCount - 1 ? 'windDown' : 'main',
  }));
}

function assertPatchOpReferences(
  op: IdeaDatePatchOp,
  stopIds: Set<string>,
  stopCount: number,
  label: string
): void {
  assertCondition(stopIds.has(op.stopId), `${label}: unknown stopId ${op.stopId}`);
  if (op.op === 'moveStop') {
    assertCondition(
      Number.isInteger(op.toIndex),
      `${label}: moveStop toIndex is not an integer (${String(op.toIndex)})`
    );
    assertCondition(
      op.toIndex >= 0 && op.toIndex < stopCount,
      `${label}: moveStop toIndex out of bounds (${op.toIndex}) for stopCount ${stopCount}`
    );
  }
}

function validateSuggestionOps(plan: Plan, suggestions: IdeaDateSuggestion[]): void {
  const stopIds = new Set((plan.stops ?? []).map((stop) => stop.id));
  const stopCount = plan.stops?.length ?? 0;
  for (let suggestionIndex = 0; suggestionIndex < suggestions.length; suggestionIndex += 1) {
    const suggestion = suggestions[suggestionIndex];
    for (let opIndex = 0; opIndex < suggestion.patchOps.length; opIndex += 1) {
      assertPatchOpReferences(
        suggestion.patchOps[opIndex],
        stopIds,
        stopCount,
        `Suggestion op validity failed at suggestion ${suggestion.id} op ${opIndex + 1}`
      );
    }
  }
}

function assertNoDuplicateSuggestionIds(suggestions: IdeaDateSuggestion[], label: string): void {
  const ids = suggestions.map((suggestion) => suggestion.id);
  const uniqueIds = new Set(ids);
  assertCondition(
    uniqueIds.size === ids.length,
    `${label}: duplicate suggestion ids found (${ids.join(', ')}).`
  );
}

function assertRolesMatchIndexConvention(plan: Plan, label: string): void {
  const stops = plan.stops ?? [];
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const expectedRole = index === 0 ? 'start' : index === stops.length - 1 ? 'windDown' : 'main';
    const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
    const actualRole = rawIdeaDate?.role;
    assertCondition(
      actualRole === expectedRole,
      `${label}: role mismatch at index ${index}. expected=${expectedRole}, actual=${String(actualRole)} (stopId=${stop.id})`
    );
  }
}

function assertNoDuplicateSuggestionSemanticSignatures(
  suggestions: IdeaDateSuggestion[],
  label: string,
  basePlan?: Plan
): void {
  const signatures = suggestions.map((suggestion) =>
    buildIdeaDateSuggestionSemanticSignature(suggestion, basePlan)
  );
  const uniqueSignatures = new Set(signatures);
  assertCondition(
    uniqueSignatures.size === signatures.length,
    `${label}: duplicate suggestion semantic signatures found (${signatures.join(', ')}).`
  );
}

function sumDiscardCounts(discardCounts: Record<string, number>): number {
  return Object.values(discardCounts).reduce((total, value) => total + value, 0);
}

function assertRefinePassBreakdownConsistency(
  stats: Awaited<ReturnType<typeof generateReplacementSuggestionsWithStats>>['refineStats'],
  label: string
): void {
  const breakdown = stats.debugPassBreakdown;
  assertCondition(Boolean(breakdown), `${label}: missing debugPassBreakdown.`);
  if (!breakdown) return;

  const totalSeen = breakdown.primaryReplacement.seen + breakdown.repairReplacement.seen + breakdown.reorderRepair.evaluated;
  assertCondition(
    totalSeen === stats.candidateCount,
    `${label}: pass breakdown seen mismatch. expected=${stats.candidateCount}, actual=${totalSeen}`
  );

  const totalKept = breakdown.primaryReplacement.kept + breakdown.repairReplacement.kept + breakdown.reorderRepair.kept;
  assertCondition(
    totalKept === stats.evaluatedCount,
    `${label}: pass breakdown kept mismatch. expected=${stats.evaluatedCount}, actual=${totalKept}`
  );

  const totalDiscarded =
    breakdown.primaryReplacement.discarded
    + breakdown.repairReplacement.discarded
    + (breakdown.reorderRepair.evaluated - breakdown.reorderRepair.kept);
  assertCondition(
    totalDiscarded === stats.discardedCount,
    `${label}: pass breakdown discarded mismatch. expected=${stats.discardedCount}, actual=${totalDiscarded}`
  );

  const primaryDiscardSum = sumDiscardCounts(breakdown.primaryReplacement.discardCounts);
  const repairDiscardSum = sumDiscardCounts(breakdown.repairReplacement.discardCounts);
  assertCondition(
    primaryDiscardSum === breakdown.primaryReplacement.discarded,
    `${label}: primary discard breakdown mismatch. expected=${breakdown.primaryReplacement.discarded}, actual=${primaryDiscardSum}`
  );
  assertCondition(
    repairDiscardSum === breakdown.repairReplacement.discarded,
    `${label}: repair discard breakdown mismatch. expected=${breakdown.repairReplacement.discarded}, actual=${repairDiscardSum}`
  );

  assertCondition(
    breakdown.primaryReplacement.seen <= MAX_REPLACEMENT_CANDIDATES_SEEN_PRIMARY,
    `${label}: primary pass exceeded seen cap. cap=${MAX_REPLACEMENT_CANDIDATES_SEEN_PRIMARY}, actual=${breakdown.primaryReplacement.seen}`
  );
  assertCondition(
    breakdown.repairReplacement.seen <= MAX_REPLACEMENT_CANDIDATES_SEEN_REPAIR,
    `${label}: repair pass exceeded seen cap. cap=${MAX_REPLACEMENT_CANDIDATES_SEEN_REPAIR}, actual=${breakdown.repairReplacement.seen}`
  );
  assertCondition(
    breakdown.reorderRepair.evaluated <= MAX_REORDER_REPAIR_EVALUATED,
    `${label}: reorder-repair exceeded evaluated cap. cap=${MAX_REORDER_REPAIR_EVALUATED}, actual=${breakdown.reorderRepair.evaluated}`
  );

  const timing = stats.debugTiming;
  assertCondition(Boolean(timing), `${label}: missing debugTiming.`);
  if (!timing) return;
  const timingEntries: Array<[string, number]> = [
    ['totalRefineMs', timing.totalRefineMs],
    ['resolverFetchMs', timing.resolverFetchMs],
    ['candidatePrepMs', timing.candidatePrepMs],
    ['candidateEvaluationMs', timing.candidateEvaluationMs],
    ['rankingMs', timing.rankingMs],
  ];
  for (const [name, value] of timingEntries) {
    assertCondition(Number.isFinite(value), `${label}: debugTiming.${name} is not finite (${String(value)})`);
    assertCondition(value >= 0, `${label}: debugTiming.${name} must be >= 0, got ${value}`);
  }
}

function assertNoDuplicateReorderFinalOrderSignatures(
  sourcePlan: Plan,
  suggestions: IdeaDateSuggestion[],
  label: string
): void {
  const reorderSuggestions = suggestions.filter((suggestion) => suggestion.kind === 'reorder');
  const signatures = reorderSuggestions.map((suggestion) => {
    const nextPlan = applyIdeaDateOps(sourcePlan, suggestion.patchOps);
    return (nextPlan.stops ?? []).map((stop) => stop.id).join('>');
  });
  const unique = new Set(signatures);
  assertCondition(
    unique.size === signatures.length,
    `${label}: duplicate reorder final-order signatures found (${signatures.join(', ')}).`
  );
}

type ComputedPrimitiveSnapshot = {
  journeyScore: number;
  journeyScore100: number;
  arcContributionTotal: number;
  arcContributionByIndex: number[];
  arcNarrativesByIndex: string[];
  constraintHardCount: number;
  constraintSoftCount: number;
  constraintNarratives: string[];
  constraintKinds: string[];
  constraintMessages: string[];
  violations: string[];
};

function toComputedPrimitiveSnapshot(
  computed: Awaited<ReturnType<typeof recomputeIdeaDateLive>>['computed']
): ComputedPrimitiveSnapshot {
  return {
    journeyScore: computed.journeyScore,
    journeyScore100: computed.journeyScore100,
    arcContributionTotal: computed.arcContributionTotal,
    arcContributionByIndex: [...computed.arcContributionByIndex],
    arcNarrativesByIndex: [...computed.arcNarrativesByIndex],
    constraintHardCount: computed.constraintHardCount,
    constraintSoftCount: computed.constraintSoftCount,
    constraintNarratives: [...computed.constraintNarratives],
    constraintKinds: computed.constraintViolations.map((violation) => violation.kind),
    constraintMessages: computed.constraintViolations.map((violation) => violation.message),
    violations: computed.violations.map((violation) => violation.type),
  };
}

function compactSerialized(value: unknown, maxLength = 120): string {
  const raw = JSON.stringify(value);
  if (!raw) return String(value);
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, Math.max(0, maxLength - 3))}...`;
}

function diffComputedPrimitives(
  expected: ComputedPrimitiveSnapshot,
  actual: ComputedPrimitiveSnapshot
): string[] {
  const keys: Array<keyof ComputedPrimitiveSnapshot> = [
    'journeyScore',
    'journeyScore100',
    'arcContributionTotal',
    'arcContributionByIndex',
    'arcNarrativesByIndex',
    'constraintHardCount',
    'constraintSoftCount',
    'constraintNarratives',
    'constraintKinds',
    'constraintMessages',
    'violations',
  ];
  const diffs: string[] = [];
  for (const key of keys) {
    const left = expected[key];
    const right = actual[key];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    diffs.push(`${key}: ${compactSerialized(left)} != ${compactSerialized(right)}`);
  }
  return diffs;
}

function assertComputedPrimitiveSnapshotEqual(
  expected: ComputedPrimitiveSnapshot,
  actual: ComputedPrimitiveSnapshot,
  label: string
): void {
  const diffs = diffComputedPrimitives(expected, actual);
  assertCondition(
    diffs.length === 0,
    `${label} mismatch: ${diffs.slice(0, 4).join(' | ')}`
  );
}

function buildPlanStateSignature(plan: Plan): string {
  const stopRows = (plan.stops ?? []).map((stop, index) => {
    const placeId = stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? '';
    const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
    const role = typeof rawIdeaDate?.role === 'string' ? rawIdeaDate.role : '';
    return `${index}:${stop.id}:${placeId}:${role}`;
  });
  return stopRows.join('|');
}

function collectDuplicatePlaceIds(plan: Plan): string[] {
  const counts = new Map<string, number>();
  for (const stop of plan.stops ?? []) {
    const placeId = stop.placeRef?.placeId?.trim() ?? stop.placeLite?.placeId?.trim() ?? '';
    if (!placeId) continue;
    counts.set(placeId, (counts.get(placeId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter((entry) => entry[1] > 1)
    .map((entry) => entry[0])
    .sort((a, b) => a.localeCompare(b));
}

function buildSuggestionContext(plan: Plan): {
  stopById: Record<string, { name?: string; role?: 'start' | 'main' | 'windDown' | 'flex' }>;
} {
  const stopById: Record<string, { name?: string; role?: 'start' | 'main' | 'windDown' | 'flex' }> = {};
  const stops = plan.stops ?? [];
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
    const role = rawIdeaDate?.role;
    const normalizedRole = role === 'start' || role === 'main' || role === 'windDown' || role === 'flex'
      ? role
      : index === 0
        ? 'start'
        : index === stops.length - 1
          ? 'windDown'
          : 'main';
    stopById[stop.id] = {
      name: stop.name,
      role: normalizedRole,
    };
  }
  return { stopById };
}

function assertNoNarrativeDebugLeak(note: string, label: string): void {
  const forbiddenPatterns = [
    /arc total:/i,
    /arc by stop:/i,
    /deltaarc/i,
    /hard=/i,
    /soft=/i,
    /\[[^\]]+\]/,
  ];
  for (const pattern of forbiddenPatterns) {
    assertCondition(
      !pattern.test(note),
      `${label} contains debug leakage (${String(pattern)}): "${note}"`
    );
  }
}

function splitNarrativeLines(note: string): string[] {
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertNarrativeLineLimit(note: string, label: string, maxLines = 2): void {
  const lines = splitNarrativeLines(note);
  assertCondition(
    lines.length <= maxLines,
    `${label} exceeds max narrative lines. max=${maxLines}, actual=${lines.length}, note="${note}"`
  );
}

function countCaseInsensitiveOccurrences(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(escaped, 'gi'));
  return matches?.length ?? 0;
}

function countLaterPeakNarrativeMentions(note: string): number {
  const patterns = [/later peak/i, /peak later/i, /build longer/i, /toward a later peak/i];
  const lines = splitNarrativeLines(note);
  return lines.filter((line) => patterns.some((pattern) => pattern.test(line))).length;
}

async function runDeterminismCheck(): Promise<Snapshot> {
  clearIdeaDateTravelCache();
  const snapshots: Snapshot[] = [];
  for (let index = 0; index < 3; index += 1) {
    const messy = buildIdeaDateSeedPlan({
      id: 'integrity-messy',
      title: 'Integrity Messy',
      seed: IDEA_DATE_MESSY_SEED,
    });
    const snapshot = await buildSnapshot(messy, { withSuggestions: true });
    assertConstraintContract(snapshot, `Determinism run ${index + 1}`);
    assertArcContributionContract(
      snapshot.plan.stops.length,
      snapshot.arcContributionTotal,
      snapshot.arcContributionByIndex,
      snapshot.arcNarrativesByIndex,
      `Determinism run ${index + 1}`
    );
    snapshots.push(snapshot);
  }
  const expected = snapshots[0];
  for (let index = 1; index < snapshots.length; index += 1) {
    const current = snapshots[index];
    assertCondition(
      current.score100 === expected.score100,
      `Determinism score mismatch at run ${index + 1}: expected=${expected.score100}, actual=${current.score100}`
    );
    assertArrayEqual(current.violations, expected.violations, `Determinism violations run ${index + 1}`);
    assertArrayEqual(
      current.constraintKinds,
      expected.constraintKinds,
      `Determinism constraint kinds run ${index + 1}`
    );
    assertArrayEqual(
      current.constraintMessages,
      expected.constraintMessages,
      `Determinism constraint messages run ${index + 1}`
    );
    assertArrayEqual(
      current.constraintNarratives,
      expected.constraintNarratives,
      `Determinism constraint narratives run ${index + 1}`
    );
    assertCondition(
      current.constraintHardCount === expected.constraintHardCount,
      `Determinism hard constraint count mismatch at run ${index + 1}: expected=${expected.constraintHardCount}, actual=${current.constraintHardCount}`
    );
    assertCondition(
      current.constraintSoftCount === expected.constraintSoftCount,
      `Determinism soft constraint count mismatch at run ${index + 1}: expected=${expected.constraintSoftCount}, actual=${current.constraintSoftCount}`
    );
    assertArrayEqual(
      current.suggestionIds,
      expected.suggestionIds,
      `Determinism suggestion ids run ${index + 1}`
    );
    assertCondition(
      current.arcContributionTotal === expected.arcContributionTotal,
      `Determinism arcContributionTotal mismatch at run ${index + 1}: expected=${expected.arcContributionTotal}, actual=${current.arcContributionTotal}`
    );
    assertNumberArrayEqual(
      current.arcContributionByIndex,
      expected.arcContributionByIndex,
      `Determinism arcContributionByIndex run ${index + 1}`
    );
    assertArrayEqual(
      current.arcNarrativesByIndex,
      expected.arcNarrativesByIndex,
      `Determinism arcNarrativesByIndex run ${index + 1}`
    );
  }
  return expected;
}

async function runMonotonicFrictionCheck(): Promise<{
  base: Snapshot;
  stretched: Snapshot;
}> {
  clearIdeaDateTravelCache();
  const clean = buildIdeaDateSeedPlan({
    id: 'integrity-clean',
    title: 'Integrity Clean',
    seed: IDEA_DATE_CLEAN_SEED,
  });
  const base = await buildSnapshot(clean, { withSuggestions: false });
  assertConstraintContract(base, 'Monotonic base');
  assertArcContributionContract(
    base.plan.stops.length,
    base.arcContributionTotal,
    base.arcContributionByIndex,
    base.arcNarrativesByIndex,
    'Monotonic base'
  );

  const stretchedPlan = clonePlan(base.plan);
  const lastStop = stretchedPlan.stops[stretchedPlan.stops.length - 1];
  assertCondition(Boolean(lastStop), 'Monotonic check failed: clean plan missing tail stop.');
  if (!lastStop?.placeRef?.latLng || !lastStop.placeRef.placeId) {
    throw new Error('Monotonic check failed: tail stop missing placeRef/latLng.');
  }
  const farPlaceId = `${lastStop.placeRef.placeId}_far`;
  lastStop.placeRef.placeId = farPlaceId;
  lastStop.placeRef.latLng = { lat: 37.8265, lng: -122.4798 };
  if (lastStop.placeLite) {
    lastStop.placeLite.placeId = farPlaceId;
  }

  const stretched = await buildSnapshot(stretchedPlan, { withSuggestions: false });
  assertConstraintContract(stretched, 'Monotonic stretched');
  assertArcContributionContract(
    stretched.plan.stops.length,
    stretched.arcContributionTotal,
    stretched.arcContributionByIndex,
    stretched.arcNarrativesByIndex,
    'Monotonic stretched'
  );
  const frictionIncreased = stretched.friction > base.friction;
  const scoreDropped = stretched.score100 < base.score100;
  assertCondition(
    frictionIncreased || scoreDropped,
    `Monotonic check failed: base friction=${base.friction.toFixed(3)}, stretched friction=${stretched.friction.toFixed(3)}, base score=${base.score100}, stretched score=${stretched.score100}`
  );

  return { base, stretched };
}

async function runStopCountBoundaryCheck(): Promise<StopBoundaryCase[]> {
  const outputs: StopBoundaryCase[] = [];

  for (const stopCount of STOP_BOUNDARY_COUNTS) {
    clearIdeaDateTravelCache();
    const seed = buildBoundarySeed(stopCount);
    const runs: StopBoundaryCase[] = [];
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      const plan = buildIdeaDateSeedPlan({
        id: `integrity-boundary-${stopCount}`,
        title: `Integrity Boundary ${stopCount}`,
        seed,
      });
      const live = await recomputeIdeaDateLive(plan);
      assertFiniteScore100(
        live.computed.journeyScore100,
        `Stop-count ${stopCount} run ${runIndex + 1} journeyScore100`
      );
      assertArcContributionContract(
        stopCount,
        live.computed.arcContributionTotal,
        live.computed.arcContributionByIndex,
        live.computed.arcNarrativesByIndex,
        `Stop-count ${stopCount} run ${runIndex + 1}`
      );

      // Contract expectation: arc model emits one point per stop energy sample.
      const arcPoints = live.arcModel.points.length;
      assertCondition(
        arcPoints === stopCount,
        `Stop-count ${stopCount} run ${runIndex + 1} expected arc points ${stopCount}, got ${arcPoints}`
      );

      runs.push({
        stopCount,
        score100: live.computed.journeyScore100,
        arcPoints,
        arcContributionTotal: live.computed.arcContributionTotal,
        violations: live.computed.violations.map((violation) => violation.type),
      });
    }

    const expected = runs[0];
    for (let runIndex = 1; runIndex < runs.length; runIndex += 1) {
      const current = runs[runIndex];
      assertCondition(
        current.arcPoints === expected.arcPoints,
        `Stop-count ${stopCount} arc-point stability failed at run ${runIndex + 1}: expected ${expected.arcPoints}, got ${current.arcPoints}`
      );
      assertArrayEqual(
        current.violations,
        expected.violations,
        `Stop-count ${stopCount} violations run ${runIndex + 1}`
      );
      assertCondition(
        current.arcContributionTotal === expected.arcContributionTotal,
        `Stop-count ${stopCount} arcContributionTotal stability failed at run ${runIndex + 1}: expected ${expected.arcContributionTotal}, got ${current.arcContributionTotal}`
      );
    }

    outputs.push(expected);
  }

  return outputs;
}

async function runDegenerateTravelCheck(): Promise<{
  score100: number;
  score01: number;
  friction: number;
  arcPoints: number;
  arcContributionTotal: number;
}> {
  clearIdeaDateTravelCache();
  const degeneratePlan = buildIdeaDateSeedPlan({
    id: 'integrity-degenerate',
    title: 'Integrity Degenerate',
    seed: IDENTICAL_COORDS_SEED,
  });

  const live = await recomputeIdeaDateLive(degeneratePlan);
  assertFiniteNumber(live.computed.frictionPenalty, 'Degenerate travel frictionPenalty');
  assertCondition(
    Math.abs(live.computed.frictionPenalty) <= DEGENERATE_FRICTION_EPSILON,
    `Degenerate travel frictionPenalty expected near 0, got ${live.computed.frictionPenalty}`
  );
  assertFiniteNumber(live.computed.journeyScore, 'Degenerate travel journeyScore');
  assertFiniteScore100(live.computed.journeyScore100, 'Degenerate travel journeyScore100');
  assertArcContributionContract(
    live.plan.stops.length,
    live.computed.arcContributionTotal,
    live.computed.arcContributionByIndex,
    live.computed.arcNarrativesByIndex,
    'Degenerate travel'
  );

  return {
    score100: live.computed.journeyScore100,
    score01: live.computed.journeyScore,
    friction: live.computed.frictionPenalty,
    arcPoints: live.arcModel.points.length,
    arcContributionTotal: live.computed.arcContributionTotal,
  };
}

async function runSuggestionValidityCheck(messy: Snapshot): Promise<{
  beforeScore100: number;
  beforeArcContributionTotal: number;
  suggestionCount: number;
  validatedOps: number;
  appliedSuggestions: number;
}> {
  clearIdeaDateTravelCache();
  const pack = await generateIdeaDateSuggestionPack(messy.plan);
  assertCondition(pack.suggestions.length > 0, 'Suggestion validity failed: no suggestions returned.');
  assertNoDuplicateSuggestionIds(pack.suggestions, 'Suggestion validity failed');
  assertNoDuplicateSuggestionSemanticSignatures(pack.suggestions, 'Suggestion validity failed', messy.plan);
  validateSuggestionOps(messy.plan, pack.suggestions);

  const baselineArcContribution = pack.computed.arcContributionTotal;
  const baselineJourneyScore = pack.computed.journeyScore;
  const baselineViolations = pack.computed.violations.length;
  const baselineHardConstraints = pack.computed.constraintHardCount;
  const topSuggestion = pack.suggestions[0];
  const topPreviewPlan = applyIdeaDateOps(messy.plan, topSuggestion.patchOps);
  assertUniqueStopIds(topPreviewPlan, `Top suggestion ${topSuggestion.id}`);
  assertReplacementContracts(messy.plan, topPreviewPlan, topSuggestion, `Top suggestion ${topSuggestion.id}`);
  const topPreview = await recomputeIdeaDateLive(topPreviewPlan);
  const topImprovesArc = topPreview.computed.arcContributionTotal > baselineArcContribution;
  const topImprovesScore = topPreview.computed.journeyScore > baselineJourneyScore;
  const topReducesViolations = topPreview.computed.violations.length < baselineViolations;
  assertCondition(
    topImprovesArc || topImprovesScore || topReducesViolations,
    `Top suggestion quality failed: top=${topSuggestion.id}, arc ${baselineArcContribution.toFixed(6)} -> ${topPreview.computed.arcContributionTotal.toFixed(6)}, score ${baselineJourneyScore.toFixed(6)} -> ${topPreview.computed.journeyScore.toFixed(6)}, violations ${baselineViolations} -> ${topPreview.computed.violations.length}`
  );
  assertCondition(
    topPreview.computed.constraintHardCount <= baselineHardConstraints,
    `Top suggestion constraints failed: hard constraints increased ${baselineHardConstraints} -> ${topPreview.computed.constraintHardCount} (top=${topSuggestion.id}).`
  );
  const topConstraintDeltaMeta = topSuggestion.meta?.constraintDelta;
  assertCondition(
    Boolean(topConstraintDeltaMeta),
    `Top suggestion constraints failed: missing constraintDelta metadata (top=${topSuggestion.id}).`
  );
  if (topConstraintDeltaMeta) {
    assertCondition(
      topConstraintDeltaMeta.baseline.hardCount === pack.computed.constraintHardCount
      && topConstraintDeltaMeta.baseline.softCount === pack.computed.constraintSoftCount,
      `Top suggestion constraints failed: baseline metadata mismatch for ${topSuggestion.id}.`
    );
    assertCondition(
      topConstraintDeltaMeta.after.hardCount === topPreview.computed.constraintHardCount
      && topConstraintDeltaMeta.after.softCount === topPreview.computed.constraintSoftCount,
      `Top suggestion constraints failed: after metadata mismatch for ${topSuggestion.id}.`
    );
    assertCondition(
      topConstraintDeltaMeta.deltas.hardDelta
        === topPreview.computed.constraintHardCount - pack.computed.constraintHardCount
      && topConstraintDeltaMeta.deltas.softDelta
        === topPreview.computed.constraintSoftCount - pack.computed.constraintSoftCount,
      `Top suggestion constraints failed: delta metadata mismatch for ${topSuggestion.id}.`
    );
    const improvedKindsSorted = [...topConstraintDeltaMeta.improvedKinds].sort((a, b) => a.localeCompare(b));
    assertArrayEqual(
      topConstraintDeltaMeta.improvedKinds,
      improvedKindsSorted,
      `Top suggestion constraints failed: improvedKinds ordering for ${topSuggestion.id}`
    );
  }
  const topConstraintNarrativeNote = topSuggestion.meta?.constraintNarrativeNote ?? null;
  if (topConstraintNarrativeNote) {
    assertCondition(
      !/\d/.test(topConstraintNarrativeNote),
      `Top suggestion constraints failed: numeric leakage in constraint note for ${topSuggestion.id}. note="${topConstraintNarrativeNote}"`
    );
  }

  let validatedOps = 0;
  let appliedSuggestions = 0;
  for (let suggestionIndex = 0; suggestionIndex < pack.suggestions.length; suggestionIndex += 1) {
    const suggestion = pack.suggestions[suggestionIndex];
    validatedOps += suggestion.patchOps.length;

    const mutated = applyIdeaDateOps(messy.plan, suggestion.patchOps);
    assertUniqueStopIds(mutated, `Suggestion apply failed at ${suggestion.id}`);
    if (suggestion.kind === 'reorder') {
      assertRolesMatchIndexConvention(mutated, `Suggestion apply failed at ${suggestion.id}`);
    }
    assertReplacementContracts(
      messy.plan,
      mutated,
      suggestion,
      `Suggestion apply failed at ${suggestion.id}`
    );
    const live = await recomputeIdeaDateLive(mutated);
    assertFiniteNumber(
      live.computed.journeyScore,
      `Suggestion apply failed at ${suggestion.id}: journeyScore`
    );
    assertFiniteScore100(
      live.computed.journeyScore100,
      `Suggestion apply failed at ${suggestion.id}: journeyScore100`
    );
    assertArcContributionContract(
      live.plan.stops.length,
      live.computed.arcContributionTotal,
      live.computed.arcContributionByIndex,
      live.computed.arcNarrativesByIndex,
      `Suggestion apply failed at ${suggestion.id}`
    );
    appliedSuggestions += 1;
  }

  return {
    beforeScore100: messy.score100,
    beforeArcContributionTotal: baselineArcContribution,
    suggestionCount: pack.suggestions.length,
    validatedOps,
    appliedSuggestions,
  };
}

async function runResolverTelemetrySanityCheck(): Promise<ResolverTelemetryCheck> {
  clearIdeaDateTravelCache();
  const messyPlan = buildIdeaDateSeedPlan({
    id: 'integrity-telemetry-messy',
    title: 'Integrity Telemetry Messy',
    seed: IDEA_DATE_MESSY_SEED,
  });

  // Force offline mock path regardless of local env flags.
  const { telemetry } = await generateIdeaDateSuggestionPackWithTelemetry(messyPlan, {
    enableGoogleResolver: false,
    enableLocalResolver: false,
  });

  assertResolverUsedValue(telemetry.used, 'Resolver telemetry lastResolverUsed');
  assertCondition(
    telemetry.used !== 'unknown',
    `Resolver telemetry failed: expected resolver to move off "unknown", got "${telemetry.used}"`
  );
  assertCondition(
    telemetry.used === 'mock',
    `Resolver telemetry failed: expected offline default resolver "mock", got "${telemetry.used}"`
  );
  assertFiniteNumber(telemetry.count, 'Resolver telemetry lastCandidateCount');
  assertCondition(
    telemetry.count >= 0,
    `Resolver telemetry failed: lastCandidateCount must be >= 0, got ${telemetry.count}`
  );
  assertCondition(
    telemetry.error == null || (typeof telemetry.error === 'string' && telemetry.error.length <= 120),
    `Resolver telemetry failed: lastResolverError should be null/undefined or <=120 chars, got "${String(telemetry.error)}"`
  );

  return {
    resolverUsed: telemetry.used,
    candidateCount: telemetry.count,
    resolverError: telemetry.error,
  };
}

async function runLensSemanticDedupeCheck(): Promise<LensSemanticDedupeCheck> {
  clearIdeaDateTravelCache();
  const messyPlan = buildIdeaDateSeedPlan({
    id: 'integrity-lens-semantic-dedupe',
    title: 'Integrity Lens Semantic Dedupe',
    seed: IDEA_DATE_MESSY_SEED,
  });

  const { pack } = await generateIdeaDateSuggestionPackWithTelemetry(messyPlan, {
    enableGoogleResolver: false,
    enableLocalResolver: false,
  });
  const sourceSuggestions = pack.suggestions;
  assertNoDuplicateSuggestionSemanticSignatures(
    sourceSuggestions,
    'Lens semantic dedupe check source',
    pack.plan
  );

  let before = 0;
  let after = 0;
  let duplicateRemoved = false;
  if (sourceSuggestions.length > 0) {
    const syntheticDuplicate: IdeaDateSuggestion = {
      ...sourceSuggestions[0],
      id: `${sourceSuggestions[0].id}-dup`,
    };
    const withDuplicate = [...sourceSuggestions, syntheticDuplicate];
    const deduped = dedupeIdeaDateSuggestionsBySemanticSignature(withDuplicate, pack.plan);

    assertCondition(
      deduped.length === sourceSuggestions.length,
      `Lens semantic dedupe check failed: expected deduped length ${sourceSuggestions.length}, got ${deduped.length}.`
    );
    assertNoDuplicateSuggestionSemanticSignatures(deduped, 'Lens semantic dedupe check finalized', pack.plan);
    before = withDuplicate.length;
    after = deduped.length;
    duplicateRemoved = deduped.length < withDuplicate.length;
  }

  const stopIds = (pack.plan.stops ?? []).map((stop) => stop.id);
  assertCondition(
    stopIds.length >= 3,
    `Lens semantic dedupe check failed: expected at least 3 stops, got ${stopIds.length}.`
  );
  const reorderA: IdeaDateSuggestion = {
    id: 'integrity-reorder-seq-a',
    kind: 'reorder',
    reasonCode: 'integrity_reorder',
    patchOps: [
      { op: 'moveStop', stopId: stopIds[0], toIndex: 2 },
    ],
    impact: {
      before: 0.5,
      after: 0.51,
      delta: 0.01,
      before100: 50,
      after100: 51,
    },
    preview: true,
    subjectStopId: stopIds[0],
  };
  const reorderB: IdeaDateSuggestion = {
    id: 'integrity-reorder-seq-b',
    kind: 'reorder',
    reasonCode: 'integrity_reorder',
    patchOps: [
      { op: 'moveStop', stopId: stopIds[0], toIndex: 1 },
      { op: 'moveStop', stopId: stopIds[0], toIndex: 2 },
    ],
    impact: {
      before: 0.5,
      after: 0.51,
      delta: 0.01,
      before100: 50,
      after100: 51,
    },
    preview: true,
    subjectStopId: stopIds[0],
  };
  const reorderKeyA = buildIdeaDateSuggestionSemanticSignature(reorderA, pack.plan);
  const reorderKeyB = buildIdeaDateSuggestionSemanticSignature(reorderB, pack.plan);
  assertCondition(
    reorderKeyA === reorderKeyB,
    `Lens semantic dedupe check failed: reorder keys should match. a=${reorderKeyA}, b=${reorderKeyB}`
  );
  const reorderWithDuplicate = [reorderA, reorderB];
  const reorderDeduped = dedupeIdeaDateSuggestionsBySemanticSignature(reorderWithDuplicate, pack.plan);
  assertCondition(
    reorderDeduped.length === 1,
    `Lens semantic dedupe check failed: expected reorder dedupe length 1, got ${reorderDeduped.length}.`
  );

  return {
    before,
    after,
    duplicateRemoved,
    reorderBefore: reorderWithDuplicate.length,
    reorderAfter: reorderDeduped.length,
    reorderDuplicateRemoved: reorderDeduped.length < reorderWithDuplicate.length,
  };
}

async function runArcTieBreakRegressionCheck(): Promise<ArcTieBreakCheck> {
  const syntheticCandidates = [
    { id: 'phase1-reorder', deltaArcContributionTotal: 0.42, legacyRank: 0 },
    { id: 'phase1-replacement-a', deltaArcContributionTotal: 0.42, legacyRank: 1 },
    { id: 'phase1-replacement-b', deltaArcContributionTotal: 0.2, legacyRank: 2 },
  ];
  const syntheticSorted = sortByArcContributionDelta(syntheticCandidates);
  assertCondition(
    syntheticSorted[0]?.id === 'phase1-reorder' && syntheticSorted[1]?.id === 'phase1-replacement-a',
    `Arc tie-break regression failed in synthetic check. sorted=${syntheticSorted.map((entry) => entry.id).join(',')}`
  );

  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-arc-tie',
    title: 'Integrity Arc Tie',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const baseline = await recomputeIdeaDateLive(messy);
  const reorder = generateReorderSuggestion(baseline.plan, baseline.computed);
  const replacements = await generateReplacementSuggestions(baseline.plan, baseline.computed);
  const phaseIOrder: IdeaDateSuggestion[] = [];
  if (reorder) phaseIOrder.push(reorder);
  phaseIOrder.push(...replacements);

  if (phaseIOrder.length <= 1) {
    return {
      syntheticTiePreserved: true,
      observedRuntimeTies: 0,
    };
  }

  const phaseIWithArcDeltas = await Promise.all(
    phaseIOrder.map(async (suggestion, legacyRank) => {
      const nextPlan = applyIdeaDateOps(baseline.plan, suggestion.patchOps);
      const nextLive = await recomputeIdeaDateLive(nextPlan);
      return {
        id: suggestion.id,
        legacyRank,
        deltaArcContributionTotal:
          nextLive.computed.arcContributionTotal - baseline.computed.arcContributionTotal,
      };
    })
  );

  const rankedPack = await generateIdeaDateSuggestionPack(messy);
  const rankedIndex = new Map<string, number>(
    rankedPack.suggestions.map((suggestion, index) => [suggestion.id, index])
  );

  let observedRuntimeTies = 0;
  for (let leftIndex = 0; leftIndex < phaseIWithArcDeltas.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < phaseIWithArcDeltas.length; rightIndex += 1) {
      const left = phaseIWithArcDeltas[leftIndex];
      const right = phaseIWithArcDeltas[rightIndex];
      if (
        normalizeArcDeltaForSort(left.deltaArcContributionTotal)
        !== normalizeArcDeltaForSort(right.deltaArcContributionTotal)
      ) {
        continue;
      }
      observedRuntimeTies += 1;
      const rankedLeft = rankedIndex.get(left.id);
      const rankedRight = rankedIndex.get(right.id);
      assertCondition(
        rankedLeft != null && rankedRight != null,
        `Arc tie-break regression failed: missing ranked suggestions for tie pair ${left.id} / ${right.id}`
      );
      const legacyLeftBeforeRight = left.legacyRank < right.legacyRank;
      const rankedLeftBeforeRight = (rankedLeft ?? 0) < (rankedRight ?? 0);
      assertCondition(
        legacyLeftBeforeRight === rankedLeftBeforeRight,
        `Arc tie-break regression failed: tie pair ${left.id}/${right.id} changed order`
      );
    }
  }

  return {
    syntheticTiePreserved: true,
    observedRuntimeTies,
  };
}

function runDiversityClassifierDeterminismCheck(): DiversityClassifierCheck {
  const foodA = classifyIdeaDatePlaceFamily(['restaurant', 'cafe'], 'Alpha Cafe');
  const foodB = classifyIdeaDatePlaceFamily([' CAFE ', 'RESTAURANT'], 'alpha cafe');
  assertCondition(
    foodA === foodB && foodA === 'food',
    `Diversity classifier failed for food mapping. a=${foodA}, b=${foodB}`
  );

  const dessertA = classifyIdeaDatePlaceFamily(['tea_house'], 'Lantern Tea');
  const dessertB = classifyIdeaDatePlaceFamily([], 'Lantern Tea');
  assertCondition(
    dessertA === 'dessert' && dessertB === 'other',
    `Diversity classifier failed for dessert mapping. a=${dessertA}, b=${dessertB}`
  );

  const culture = classifyIdeaDatePlaceFamily(['museum'], 'City Museum');
  const nightlife = classifyIdeaDatePlaceFamily(['night_club'], 'Moon Club');
  const other = classifyIdeaDatePlaceFamily([], 'Unnamed Place');

  assertCondition(culture === 'culture', `Diversity classifier failed for culture mapping. got=${culture}`);
  assertCondition(
    nightlife === 'nightlife',
    `Diversity classifier failed for nightlife mapping. got=${nightlife}`
  );
  assertCondition(other === 'other', `Diversity classifier fallback failed. got=${other}`);

  return {
    deterministic: true,
    families: [foodA, dessertA, culture, nightlife, other],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStopOverrides(stop: Plan['stops'][number]): {
  chillLively: number;
  relaxedActive: number;
  quickLingering: number;
} {
  const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
  const rawOverrides = rawIdeaDate && isRecord(rawIdeaDate.overrides) ? rawIdeaDate.overrides : null;
  const read = (key: 'chillLively' | 'relaxedActive' | 'quickLingering') => {
    const value = rawOverrides?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    chillLively: read('chillLively'),
    relaxedActive: read('relaxedActive'),
    quickLingering: read('quickLingering'),
  };
}

function applyMakeMessierMutation(plan: Plan): Plan {
  if ((plan.stops ?? []).length < 3) return plan;
  const nextStops = [...plan.stops];
  const [tail] = nextStops.splice(nextStops.length - 1, 1);
  nextStops.splice(1, 0, tail);
  const tailIndex = nextStops.length - 1;
  const mutatedStops = nextStops.map((stop, index) => {
    if (index !== tailIndex) return stop;
    const raw = isRecord(stop.ideaDate) ? stop.ideaDate : {};
    const existingOverrides = readStopOverrides(stop);
    return {
      ...stop,
      ideaDate: {
        ...raw,
        role: 'windDown',
        overrides: {
          ...existingOverrides,
          chillLively: 1,
          relaxedActive: 1,
          quickLingering: 1,
        },
      },
    };
  });
  return {
    ...plan,
    stops: mutatedStops,
  };
}

async function runQueryHardeningScenarioCheck(): Promise<QueryHardeningCheck> {
  clearIdeaDateTravelCache();
  const clean = buildIdeaDateSeedPlan({
    id: 'integrity-query-hardening-clean',
    title: 'Integrity Query Hardening Clean',
    seed: IDEA_DATE_CLEAN_SEED,
  });
  const messierPlan = applyMakeMessierMutation(clean);
  const live = await recomputeIdeaDateLive(messierPlan);
  const replacement = await generateReplacementSuggestionsWithStats(live.plan, live.computed, {
    searchCandidates: searchIdeaDateCandidates,
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
  });
  const stats = replacement.refineStats;
  assertRefinePassBreakdownConsistency(stats, 'Query hardening');

  const debugRoleQuery = stats.debugRoleQuery;
  assertCondition(Boolean(debugRoleQuery), 'Query hardening failed: debugRoleQuery missing.');
  if (!debugRoleQuery) {
    throw new Error('Query hardening failed: debugRoleQuery missing.');
  }
  assertCondition(
    debugRoleQuery.templateUsed === 'start'
      || debugRoleQuery.templateUsed === 'main'
      || debugRoleQuery.templateUsed === 'windDown'
      || debugRoleQuery.templateUsed === 'generic',
    `Query hardening failed: invalid templateUsed "${debugRoleQuery.templateUsed}".`
  );
  assertCondition(
    debugRoleQuery.typesCount > 0,
    `Query hardening failed: typesCount must be > 0, got ${debugRoleQuery.typesCount}.`
  );
  assertCondition(
    debugRoleQuery.radiusMeters >= 250,
    `Query hardening failed: radiusMeters must be >= 250, got ${debugRoleQuery.radiusMeters}.`
  );

  const familyCounts = stats.debugPlanFamilyCounts ?? {};
  const planFamilyKeys = Object.keys(familyCounts).sort((a, b) => a.localeCompare(b));
  assertCondition(
    planFamilyKeys.length > 0,
    `Query hardening failed: plan family counts missing (${JSON.stringify(familyCounts)}).`
  );
  assertCondition(
    stats.candidateCount > 0,
    `Query hardening failed: expected candidates seen > 0, got ${stats.candidateCount}.`
  );
  assertCondition(
    stats.debugPassUsed === 'repair' || stats.debugPassUsed === 'reorder_repair',
    `Repair ladder fallback failed: expected passUsed in {repair,reorder_repair}, got "${String(stats.debugPassUsed)}".`
  );

  return {
    candidatesSeen: stats.candidateCount,
    candidatesKept: stats.evaluatedCount,
    suggestionsGenerated: replacement.suggestions.length,
    passUsed: stats.debugPassUsed ?? 'primary',
    templateUsed: debugRoleQuery.templateUsed,
    queryTypesCount: debugRoleQuery.typesCount,
    queryRadiusMeters: debugRoleQuery.radiusMeters,
    planFamilyKeys,
  };
}

async function runRepairModeMockCandidateCheck(): Promise<RepairModeCheck> {
  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-repair-mode-messy',
    title: 'Integrity Repair Mode Messy',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(messy);
  const baseComputed = live.computed;

  const searchCandidates = (args: Parameters<typeof searchIdeaDateCandidates>[0]) => {
    const lat = args.stop.placeRef?.latLng?.lat ?? 37.79;
    const lng = args.stop.placeRef?.latLng?.lng ?? -122.41;
    const roleTypes: Record<typeof args.role, string[]> = {
      start: ['cafe'],
      main: ['museum'],
      windDown: ['dessert_shop'],
      flex: ['cafe'],
    };
    return [
      {
        placeId: `repair-pass-candidate-${args.stop.id}-${args.role}`,
        name: `Repair Candidate ${args.role}`,
        lat: lat + 0.001,
        lng: lng + 0.001,
        types: roleTypes[args.role],
      },
    ];
  };

  const recomputeCandidatePlan = (candidatePlan: Plan) => {
    const hasRepairCandidate = (candidatePlan.stops ?? []).some((stop) => {
      const placeId = stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? '';
      return placeId.startsWith('repair-pass-candidate-');
    });
    if (!hasRepairCandidate) return { computed: baseComputed };
    const nextViolations = baseComputed.violations.slice(
      0,
      Math.max(0, baseComputed.violations.length - 1)
    );
    const nextJourneyScore = Math.max(0, Math.min(1, baseComputed.journeyScore - 0.02));
    return {
      computed: {
        ...baseComputed,
        journeyScore: nextJourneyScore,
        journeyScore100: Math.round(nextJourneyScore * 100),
        violations: nextViolations,
      },
    };
  };

  const replacement = await generateReplacementSuggestionsWithStats(live.plan, baseComputed, {
    searchCandidates,
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
    recomputeCandidatePlan,
  });
  const stats = replacement.refineStats;
  assertRefinePassBreakdownConsistency(stats, 'Repair mode');

  assertCondition(
    stats.debugPassUsed === 'repair',
    `Repair-mode deterministic fallback failed: expected passUsed=repair, got "${String(stats.debugPassUsed)}".`
  );
  assertCondition(
    replacement.suggestions.length >= 1,
    `Repair-mode deterministic fallback failed: expected >=1 suggestion, got ${replacement.suggestions.length}.`
  );
  assertCondition(
    stats.evaluatedCount >= 1,
    `Repair-mode deterministic fallback failed: expected kept >=1, got ${stats.evaluatedCount}.`
  );

  return {
    passUsed: stats.debugPassUsed ?? 'primary',
    suggestionsGenerated: replacement.suggestions.length,
    candidatesSeen: stats.candidateCount,
    candidatesKept: stats.evaluatedCount,
  };
}

async function runReorderRepairFallbackCheck(): Promise<ReorderRepairCheck> {
  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-reorder-repair-messy',
    title: 'Integrity Reorder Repair Messy',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(messy);
  const baseComputed = live.computed;
  const baseStopOrder = live.plan.stops.map((stop) => stop.id);
  const basePlaceByStopId = new Map(
    live.plan.stops.map((stop) => [
      stop.id,
      stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? '',
    ])
  );

  const recomputeCandidatePlan = (candidatePlan: Plan) => {
    const candidateOrder = (candidatePlan.stops ?? []).map((stop) => stop.id);
    const orderChanged = candidateOrder.some((stopId, index) => stopId !== baseStopOrder[index]);
    const replacementChanged = !orderChanged && (candidatePlan.stops ?? []).some((stop) => {
      const basePlaceId = basePlaceByStopId.get(stop.id) ?? '';
      const nextPlaceId = stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? '';
      return nextPlaceId !== basePlaceId;
    });

    if (replacementChanged) {
      return {
        computed: {
          ...baseComputed,
          violations: [
            ...baseComputed.violations,
            {
              type: 'forced_replacement_penalty',
              severity: 'warn' as const,
              details: 'deterministic-integrity-check',
            },
          ],
        },
      };
    }

    if (orderChanged) {
      const nextJourneyScore = Math.max(0, Math.min(1, baseComputed.journeyScore + 0.015));
      return {
        computed: {
          ...baseComputed,
          journeyScore: nextJourneyScore,
          journeyScore100: Math.round(nextJourneyScore * 100),
          arcContributionTotal: baseComputed.arcContributionTotal + 0.02,
        },
      };
    }

    return { computed: baseComputed };
  };

  const replacement = await generateReplacementSuggestionsWithStats(live.plan, baseComputed, {
    searchCandidates: () => [],
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
    recomputeCandidatePlan,
  });
  const stats = replacement.refineStats;
  const reorderDebug = stats.debugReorderRepair;
  assertRefinePassBreakdownConsistency(stats, 'Reorder repair mode');

  assertCondition(
    stats.debugPassUsed === 'reorder_repair',
    `Reorder-repair fallback failed: expected passUsed=reorder_repair, got "${String(stats.debugPassUsed)}".`
  );
  assertCondition(
    replacement.suggestions.length >= 1,
    `Reorder-repair fallback failed: expected >=1 suggestion, got ${replacement.suggestions.length}.`
  );
  assertCondition(
    replacement.suggestions.every((suggestion) => suggestion.kind === 'reorder'),
    'Reorder-repair fallback failed: expected reorder-only suggestions.'
  );
  assertNoDuplicateReorderFinalOrderSignatures(
    live.plan,
    replacement.suggestions,
    'Reorder-repair fallback failed'
  );
  assertCondition(
    Boolean(reorderDebug) && (reorderDebug?.candidatesEvaluated ?? 0) > 0,
    `Reorder-repair fallback failed: missing candidate telemetry (${JSON.stringify(reorderDebug)}).`
  );

  return {
    passUsed: stats.debugPassUsed ?? 'primary',
    suggestionsGenerated: replacement.suggestions.length,
    candidatesSeen: stats.candidateCount,
    candidatesKept: stats.evaluatedCount,
    reorderCandidatesEvaluated: reorderDebug?.candidatesEvaluated ?? 0,
  };
}

async function runHardConstraintGuardrailCheck(): Promise<HardConstraintGuardrailCheck> {
  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-hard-constraint-guardrail',
    title: 'Integrity Hard Constraint Guardrail',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(messy);
  const baseComputed = live.computed;

  const searchCandidates = (args: Parameters<typeof searchIdeaDateCandidates>[0]) => {
    const lat = args.stop.placeRef?.latLng?.lat ?? 37.79;
    const lng = args.stop.placeRef?.latLng?.lng ?? -122.41;
    return [
      {
        placeId: `guardrail-hard-violation-${args.stop.id}`,
        name: 'Guardrail Hard Violation',
        lat: lat + 0.0011,
        lng: lng + 0.0011,
        types: ['restaurant'],
      },
      {
        placeId: `guardrail-safe-${args.stop.id}`,
        name: 'Guardrail Safe Candidate',
        lat: lat + 0.0012,
        lng: lng + 0.0012,
        types: ['cafe'],
      },
    ];
  };

  const recomputeCandidatePlan = (candidatePlan: Plan) => {
    const placeIds = (candidatePlan.stops ?? []).map(
      (stop) => stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? ''
    );
    const hasHardViolationCandidate = placeIds.some((placeId) => placeId.includes('guardrail-hard-violation-'));
    const hasSafeCandidate = placeIds.some((placeId) => placeId.includes('guardrail-safe-'));
    if (!hasHardViolationCandidate && !hasSafeCandidate) {
      return { computed: baseComputed };
    }

    const toComputed = (input: {
      journeyDelta: number;
      arcDelta: number;
      hardCount: number;
      softCount: number;
      frictionPenalty: number;
    }) => {
      const journeyScore = Math.max(0, Math.min(1, baseComputed.journeyScore + input.journeyDelta));
      return {
        computed: {
          ...baseComputed,
          journeyScore,
          journeyScore100: Math.round(journeyScore * 100),
          arcContributionTotal: baseComputed.arcContributionTotal + input.arcDelta,
          frictionPenalty: input.frictionPenalty,
          components: {
            fatigue: { ...baseComputed.components.fatigue },
            friction: {
              ...baseComputed.components.friction,
              penalty: input.frictionPenalty,
            },
          },
          constraintHardCount: input.hardCount,
          constraintSoftCount: input.softCount,
        },
      };
    };

    if (hasHardViolationCandidate) {
      return toComputed({
        journeyDelta: 0.03,
        arcDelta: 0.08,
        hardCount: baseComputed.constraintHardCount + 1,
        softCount: baseComputed.constraintSoftCount,
        frictionPenalty: Math.max(0, baseComputed.frictionPenalty - 0.02),
      });
    }

    return toComputed({
      journeyDelta: 0.02,
      arcDelta: 0.05,
      hardCount: baseComputed.constraintHardCount,
      softCount: Math.max(0, baseComputed.constraintSoftCount - 1),
      frictionPenalty: Math.max(0, baseComputed.frictionPenalty - 0.01),
    });
  };

  const replacement = await generateReplacementSuggestionsWithStats(live.plan, baseComputed, {
    searchCandidates,
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
    recomputeCandidatePlan,
  });
  const stats = replacement.refineStats;
  assertRefinePassBreakdownConsistency(stats, 'Hard constraint guardrail');

  const discardedAsHardIncrease = stats.discardCounts.increases_hard_constraints ?? 0;
  assertCondition(
    discardedAsHardIncrease > 0,
    `Hard constraint guardrail failed: expected increases_hard_constraints discard count > 0, got ${discardedAsHardIncrease}.`
  );
  const hardCandidateDiscarded = replacement.suggestions.every(
    (suggestion) => !suggestion.id.includes('guardrail-hard-violation-')
  );
  assertCondition(
    hardCandidateDiscarded,
    `Hard constraint guardrail failed: hard-constraint-increasing candidate was retained. ids=${replacement.suggestions.map((entry) => entry.id).join(',')}`
  );

  return {
    discardedAsHardIncrease,
    suggestionsGenerated: replacement.suggestions.length,
    hardCandidateDiscarded,
  };
}

async function runPrefTiltSensitivityCheck(): Promise<PrefTiltSensitivityCheck> {
  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-pref-tilt',
    title: 'Integrity Pref Tilt',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(messy);
  const baseComputed = live.computed;

  const searchCandidates = (args: Parameters<typeof searchIdeaDateCandidates>[0]) => {
    const lat = args.stop.placeRef?.latLng?.lat ?? 37.79;
    const lng = args.stop.placeRef?.latLng?.lng ?? -122.41;
    const sharedTypes = ['cafe', 'museum', 'dessert_shop', 'bar', 'tea_house'];
    return [
      {
        placeId: `tilt-sensitivity-a-${args.stop.id}`,
        name: 'Tilt Sensitivity A',
        lat: lat + 0.0008,
        lng: lng + 0.0008,
        types: sharedTypes,
      },
      {
        placeId: `tilt-sensitivity-b-${args.stop.id}`,
        name: 'Tilt Sensitivity B',
        lat: lat + 0.0010,
        lng: lng + 0.0010,
        types: sharedTypes,
      },
      {
        placeId: `tilt-sensitivity-c-${args.stop.id}`,
        name: 'Tilt Sensitivity C',
        lat: lat + 0.0012,
        lng: lng + 0.0012,
        types: sharedTypes,
      },
    ];
  };

  const recomputeCandidatePlan = (candidatePlan: Plan) => {
    const placeIds = (candidatePlan.stops ?? []).map(
      (stop) => stop.placeRef?.placeId ?? stop.placeLite?.placeId ?? ''
    );
    const hasA = placeIds.some((placeId) => placeId.includes('tilt-sensitivity-a-'));
    const hasB = placeIds.some((placeId) => placeId.includes('tilt-sensitivity-b-'));
    const hasC = placeIds.some((placeId) => placeId.includes('tilt-sensitivity-c-'));
    const baseJourney = baseComputed.journeyScore;
    const withVariant = (input: {
      journeyDelta: number;
      fatiguePenalty: number;
      frictionPenalty: number;
      arcDelta: number;
    }) => {
      const journeyScore = Math.max(0, Math.min(1, baseJourney + input.journeyDelta));
      return {
        computed: {
          ...baseComputed,
          journeyScore,
          journeyScore100: Math.round(journeyScore * 100),
          fatiguePenalty: input.fatiguePenalty,
          frictionPenalty: input.frictionPenalty,
          arcContributionTotal: baseComputed.arcContributionTotal + input.arcDelta,
          components: {
            fatigue: {
              ...baseComputed.components.fatigue,
              penalty: input.fatiguePenalty,
            },
            friction: {
              ...baseComputed.components.friction,
              penalty: input.frictionPenalty,
            },
          },
        },
      };
    };

    if (hasA) {
      return withVariant({
        journeyDelta: 0.016,
        fatiguePenalty: Math.max(0, baseComputed.fatiguePenalty - 0.25),
        frictionPenalty: Math.min(1, baseComputed.frictionPenalty + 0.35),
        arcDelta: 0.08,
      });
    }
    if (hasB) {
      return withVariant({
        journeyDelta: 0.015,
        fatiguePenalty: Math.min(1, baseComputed.fatiguePenalty + 0.05),
        frictionPenalty: Math.max(0, baseComputed.frictionPenalty - 0.25),
        arcDelta: 0.02,
      });
    }
    if (hasC) {
      return withVariant({
        journeyDelta: 0.006,
        fatiguePenalty: Math.min(1, baseComputed.fatiguePenalty + 0.08),
        frictionPenalty: Math.min(1, baseComputed.frictionPenalty + 0.05),
        arcDelta: 0.005,
      });
    }
    return { computed: baseComputed };
  };

  const runWithTilt = async (prefTilt: { vibe: -1 | 0 | 1; walking: -1 | 0 | 1; peak: -1 | 0 | 1 }) => {
    const output = await generateReplacementSuggestionsWithStats(live.plan, baseComputed, {
      searchCandidates,
      replacementRanking: {
        diversityPolicy: readIdeaDateDiversityPolicy('development'),
        familyKeyAdapter: ideaDatePlaceFamilyAdapter,
      },
      recomputeCandidatePlan,
      prefTilt,
    });
    return output.suggestions.map((suggestion) => suggestion.id);
  };

  const neutralRunOne = await runWithTilt({ vibe: 0, walking: 0, peak: 0 });
  const neutralRunTwo = await runWithTilt({ vibe: 0, walking: 0, peak: 0 });
  const walkingRunOne = await runWithTilt({ vibe: 0, walking: -1, peak: 0 });
  const walkingRunTwo = await runWithTilt({ vibe: 0, walking: -1, peak: 0 });

  assertCondition(neutralRunOne.length > 0, 'Pref-tilt sensitivity failed: neutral run returned no suggestions.');
  assertCondition(walkingRunOne.length > 0, 'Pref-tilt sensitivity failed: walking run returned no suggestions.');
  assertArrayEqual(neutralRunOne, neutralRunTwo, 'Pref-tilt neutral determinism');
  assertArrayEqual(walkingRunOne, walkingRunTwo, 'Pref-tilt walking determinism');

  const neutralTopId = neutralRunOne[0] ?? null;
  const walkingTopId = walkingRunOne[0] ?? null;
  assertCondition(
    neutralTopId !== walkingTopId,
    `Pref-tilt sensitivity failed: expected top suggestion to change when walking tilt changes (neutral=${String(neutralTopId)}, walking=${String(walkingTopId)}).`
  );

  return {
    deterministicNeutral: true,
    deterministicWalkingSensitive: true,
    neutralSuggestionId: neutralTopId,
    walkingSensitiveSuggestionId: walkingTopId,
    changed: neutralTopId !== walkingTopId,
  };
}

async function runPrefTiltRefFreshnessCheck(): Promise<PrefTiltRefFreshnessCheck> {
  clearIdeaDateTravelCache();
  const messy = buildIdeaDateSeedPlan({
    id: 'integrity-pref-tilt-ref',
    title: 'Integrity Pref Tilt Ref',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(messy);
  const prefTiltRef: {
    current: { vibe: -1 | 0 | 1; walking: -1 | 0 | 1; peak: -1 | 0 | 1 };
  } = {
    current: { vibe: 0, walking: -1, peak: 0 },
  };

  const runRefineWithRefTilt = async () => generateReplacementSuggestionsWithStats(live.plan, live.computed, {
    searchCandidates: () => [],
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
    prefTilt: prefTiltRef.current,
  });

  const previous = { ...prefTiltRef.current };
  const previousRun = await runRefineWithRefTilt();
  assertCondition(
    Boolean(previousRun.refineStats.debugPrefTilt),
    'Pref-tilt ref freshness failed: missing debugPrefTilt in previous run.'
  );

  prefTiltRef.current = { vibe: 0, walking: 0, peak: 1 };
  const current = { ...prefTiltRef.current };
  const currentRun = await runRefineWithRefTilt();
  const reportedRaw = currentRun.refineStats.debugPrefTilt ?? null;
  const reported = reportedRaw
    ? {
        vibe: reportedRaw.vibe,
        walking: reportedRaw.walking,
        peak: reportedRaw.peak,
      }
    : null;
  assertCondition(Boolean(reported), 'Pref-tilt ref freshness failed: missing debugPrefTilt in current run.');
  if (!reported) {
    return {
      previous,
      current,
      reported,
      matchedCurrent: false,
      matchedPrevious: false,
    };
  }

  const matchedCurrent = reported.vibe === current.vibe
    && reported.walking === current.walking
    && reported.peak === current.peak;
  const matchedPrevious = reported.vibe === previous.vibe
    && reported.walking === previous.walking
    && reported.peak === previous.peak;
  assertCondition(
    matchedCurrent,
    `Pref-tilt ref freshness failed: telemetry mismatch. expected=${JSON.stringify(current)}, actual=${JSON.stringify(reported)}`
  );
  assertCondition(
    !matchedPrevious,
    `Pref-tilt ref freshness failed: telemetry still matched previous tilt ${JSON.stringify(previous)}`
  );

  return {
    previous,
    current,
    reported,
    matchedCurrent,
    matchedPrevious,
  };
}

async function runPrefTiltPlanMetaPersistenceCheck(): Promise<PrefTiltPlanMetaPersistenceCheck> {
  clearIdeaDateTravelCache();
  const seeded = buildIdeaDateSeedPlan({
    id: 'integrity-pref-tilt-meta',
    title: 'Integrity Pref Tilt Meta',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const stored: PrefTiltTriplet = { vibe: 1, walking: -1, peak: 1 };
  const persistedPlan = withPlanMetaPrefTilt(seeded, stored);

  const firstInit = await recomputeIdeaDateLive(persistedPlan);
  const restored = readPlanPrefTiltMeta(firstInit.plan);
  assertCondition(
    prefTiltTripletMatches(restored, stored),
    `Pref-tilt meta persistence failed on first init. expected=${JSON.stringify(stored)}, actual=${JSON.stringify(restored)}`
  );

  const secondInit = await recomputeIdeaDateLive(firstInit.plan);
  const restoredSecondInit = readPlanPrefTiltMeta(secondInit.plan);
  assertCondition(
    prefTiltTripletMatches(restoredSecondInit, stored),
    `Pref-tilt meta persistence failed on second init. expected=${JSON.stringify(stored)}, actual=${JSON.stringify(restoredSecondInit)}`
  );

  assertCondition(
    firstInit.plan.stops.length > 1,
    'Pref-tilt meta persistence failed: seed needs at least two stops for preview simulation.'
  );
  const previewCandidateStop = firstInit.plan.stops[1];
  const previewPlan = applyIdeaDateOps(firstInit.plan, [
    {
      op: 'moveStop',
      stopId: previewCandidateStop.id,
      toIndex: 0,
    },
  ]);
  const committedAfterPreview = readPlanPrefTiltMeta(firstInit.plan);
  const previewPlanTilt = readPlanPrefTiltMeta(previewPlan);
  assertCondition(
    prefTiltTripletMatches(committedAfterPreview, stored),
    `Pref-tilt meta persistence failed after preview simulation. expected=${JSON.stringify(stored)}, actual=${JSON.stringify(committedAfterPreview)}`
  );
  assertCondition(
    prefTiltTripletMatches(previewPlanTilt, stored),
    `Pref-tilt meta persistence failed on preview plan copy. expected=${JSON.stringify(stored)}, actual=${JSON.stringify(previewPlanTilt)}`
  );

  return {
    stored,
    restored,
    restoredSecondInit,
    committedAfterPreview,
    previewPlanTilt,
    deterministic: prefTiltTripletMatches(restored, restoredSecondInit),
    unaffectedByPreview: prefTiltTripletMatches(committedAfterPreview, stored),
  };
}

async function runModePolicyDefaultsCheck(): Promise<ModePolicyDefaultsCheck> {
  clearIdeaDateTravelCache();
  const seeded = buildIdeaDateSeedPlan({
    id: 'integrity-mode-policy',
    title: 'Integrity Mode Policy',
    seed: IDEA_DATE_MESSY_SEED,
  });

  const firstInit = await recomputeIdeaDateLive(seeded);
  const defaultWhenMissing = readPlanModeMeta(firstInit.plan);
  assertCondition(
    defaultWhenMissing === 'default',
    `Mode policy failed: missing mode should default to "default", got "${defaultWhenMissing}".`
  );

  const nextMode: IdeaDateMode = 'tourist_day';
  const modePlan = withPlanMetaMode(firstInit.plan, nextMode);
  const modeInit = await recomputeIdeaDateLive(modePlan);
  const modeAfterSet = readPlanModeMeta(modeInit.plan);
  assertCondition(
    modeAfterSet === nextMode,
    `Mode policy failed: mode write mismatch. expected="${nextMode}", actual="${modeAfterSet}".`
  );

  const expectedDefaultPrefTilt = toPrefTiltTriplet(getIdeaDateModePolicy(nextMode).defaultPrefTilt);
  const defaultsAppliedPlan = withPlanModeDefaultsApplied(modeInit.plan, nextMode);
  const defaultsAppliedInit = await recomputeIdeaDateLive(defaultsAppliedPlan);
  const appliedPrefTilt = readPlanPrefTiltMeta(defaultsAppliedInit.plan);
  assertCondition(
    prefTiltTripletMatches(appliedPrefTilt, expectedDefaultPrefTilt),
    `Mode policy failed: applyModeDefaults prefTilt mismatch. expected=${JSON.stringify(expectedDefaultPrefTilt)}, actual=${JSON.stringify(appliedPrefTilt)}`
  );

  const reloadedInit = await recomputeIdeaDateLive(defaultsAppliedInit.plan);
  const modeAfterReload = readPlanModeMeta(reloadedInit.plan);
  assertCondition(
    modeAfterReload === nextMode,
    `Mode policy failed: mode did not persist across reload. expected="${nextMode}", actual="${modeAfterReload}".`
  );
  const reloadedPrefTilt = readPlanPrefTiltMeta(reloadedInit.plan);
  assertCondition(
    prefTiltTripletMatches(reloadedPrefTilt, expectedDefaultPrefTilt),
    `Mode policy failed: prefTilt did not persist across reload. expected=${JSON.stringify(expectedDefaultPrefTilt)}, actual=${JSON.stringify(reloadedPrefTilt)}`
  );

  return {
    defaultWhenMissing,
    modeAfterSet,
    modeAfterReload,
    expectedDefaultPrefTilt,
    appliedPrefTilt,
    reloadedPrefTilt,
    deterministic: prefTiltTripletMatches(appliedPrefTilt, reloadedPrefTilt),
  };
}

async function runModeAwareRefineCompositionCheck(): Promise<ModeAwareRefineCompositionCheck> {
  clearIdeaDateTravelCache();
  const seeded = buildIdeaDateSeedPlan({
    id: 'integrity-mode-aware-refine',
    title: 'Integrity Mode-aware Refine',
    seed: IDEA_DATE_MESSY_SEED,
  });
  const live = await recomputeIdeaDateLive(seeded);
  const sharedOptions = {
    searchCandidates: () => [],
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy('development'),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
  };

  const runWith = async (input: {
    prefTilt: PrefTiltTriplet;
    mode: IdeaDateMode;
  }): Promise<{
    planPrefTilt: PrefTiltTriplet;
    modeDefaults: PrefTiltTriplet;
    effectiveTilt: PrefTiltTriplet;
  }> => {
    const output = await generateReplacementSuggestionsWithStats(live.plan, live.computed, {
      ...sharedOptions,
      prefTilt: input.prefTilt,
      mode: input.mode,
    });
    const planPrefTiltRaw = output.refineStats.debugPlanPrefTilt ?? null;
    const modeDefaultsRaw = output.refineStats.debugModeDefaultPrefTilt ?? null;
    const effectiveTiltRaw = output.refineStats.debugEffectivePrefTilt ?? output.refineStats.debugPrefTilt ?? null;
    assertCondition(
      Boolean(planPrefTiltRaw && modeDefaultsRaw && effectiveTiltRaw),
      `Mode-aware refine composition failed: missing tilt telemetry for mode "${input.mode}".`
    );
    if (!planPrefTiltRaw || !modeDefaultsRaw || !effectiveTiltRaw) {
      const empty: PrefTiltTriplet = { vibe: 0, walking: 0, peak: 0 };
      return {
        planPrefTilt: empty,
        modeDefaults: empty,
        effectiveTilt: empty,
      };
    }
    return {
      planPrefTilt: toPrefTiltTriplet(planPrefTiltRaw),
      modeDefaults: toPrefTiltTriplet(modeDefaultsRaw),
      effectiveTilt: toPrefTiltTriplet(effectiveTiltRaw),
    };
  };

  const neutralPrefTilt: PrefTiltTriplet = { vibe: 0, walking: 0, peak: 0 };
  const neutralExpected = toPrefTiltTriplet(getIdeaDateModePolicy('tourist_day').defaultPrefTilt);
  const neutralRunOne = await runWith({ prefTilt: neutralPrefTilt, mode: 'tourist_day' });
  const neutralRunTwo = await runWith({ prefTilt: neutralPrefTilt, mode: 'tourist_day' });
  assertCondition(
    prefTiltTripletMatches(neutralRunOne.planPrefTilt, neutralPrefTilt),
    `Mode-aware refine composition failed: neutral plan prefTilt mismatch. expected=${JSON.stringify(neutralPrefTilt)}, actual=${JSON.stringify(neutralRunOne.planPrefTilt)}`
  );
  assertCondition(
    prefTiltTripletMatches(neutralRunOne.modeDefaults, neutralExpected),
    `Mode-aware refine composition failed: neutral mode defaults mismatch. expected=${JSON.stringify(neutralExpected)}, actual=${JSON.stringify(neutralRunOne.modeDefaults)}`
  );
  assertCondition(
    prefTiltTripletMatches(neutralRunOne.effectiveTilt, neutralExpected),
    `Mode-aware refine composition failed: neutral effective tilt should follow mode defaults. expected=${JSON.stringify(neutralExpected)}, actual=${JSON.stringify(neutralRunOne.effectiveTilt)}`
  );
  assertCondition(
    prefTiltTripletMatches(neutralRunTwo.effectiveTilt, neutralExpected),
    `Mode-aware refine composition failed: neutral effective tilt changed across deterministic run. expected=${JSON.stringify(neutralExpected)}, actual=${JSON.stringify(neutralRunTwo.effectiveTilt)}`
  );

  const nonNeutralExpected: PrefTiltTriplet = { vibe: 0, walking: -1, peak: 0 };
  const nonNeutralTouristDay = await runWith({ prefTilt: nonNeutralExpected, mode: 'tourist_day' });
  const nonNeutralFamily = await runWith({ prefTilt: nonNeutralExpected, mode: 'family' });
  assertCondition(
    prefTiltTripletMatches(nonNeutralTouristDay.effectiveTilt, nonNeutralExpected),
    `Mode-aware refine composition failed: non-neutral tilt should win over mode defaults (tourist_day). expected=${JSON.stringify(nonNeutralExpected)}, actual=${JSON.stringify(nonNeutralTouristDay.effectiveTilt)}`
  );
  assertCondition(
    prefTiltTripletMatches(nonNeutralFamily.effectiveTilt, nonNeutralExpected),
    `Mode-aware refine composition failed: non-neutral tilt should win over mode defaults (family). expected=${JSON.stringify(nonNeutralExpected)}, actual=${JSON.stringify(nonNeutralFamily.effectiveTilt)}`
  );
  assertCondition(
    !prefTiltTripletMatches(nonNeutralTouristDay.modeDefaults, nonNeutralFamily.modeDefaults),
    `Mode-aware refine composition failed: mode defaults should differ between modes for this check. tourist_day=${JSON.stringify(nonNeutralTouristDay.modeDefaults)}, family=${JSON.stringify(nonNeutralFamily.modeDefaults)}`
  );

  return {
    neutralExpected,
    neutralModeDefaults: neutralRunOne.modeDefaults,
    neutralEffectiveRunOne: neutralRunOne.effectiveTilt,
    neutralEffectiveRunTwo: neutralRunTwo.effectiveTilt,
    neutralDeterministic: prefTiltTripletMatches(neutralRunOne.effectiveTilt, neutralRunTwo.effectiveTilt),
    nonNeutralExpected,
    nonNeutralEffectiveTouristDay: nonNeutralTouristDay.effectiveTilt,
    nonNeutralEffectiveFamily: nonNeutralFamily.effectiveTilt,
    nonNeutralModeIndependent: prefTiltTripletMatches(nonNeutralTouristDay.effectiveTilt, nonNeutralFamily.effectiveTilt),
    deterministic: prefTiltTripletMatches(neutralRunOne.effectiveTilt, neutralRunTwo.effectiveTilt)
      && prefTiltTripletMatches(nonNeutralTouristDay.effectiveTilt, nonNeutralFamily.effectiveTilt),
  };
}

function runTiltNarrativeCouplingCheck(): TiltNarrativeCouplingCheck {
  const baseSuggestion: IdeaDateSuggestion = {
    id: 'integrity-tilt-narrative-suggestion',
    kind: 'reorder',
    reasonCode: 'reorder_repair_arc_smoothing',
    patchOps: [
      {
        op: 'moveStop',
        stopId: 'integrity-stop-2',
        toIndex: 1,
      },
    ],
    impact: {
      before: 0.5,
      after: 0.6,
      delta: 0.1,
      before100: 50,
      after100: 60,
    },
    preview: true,
    subjectStopId: 'integrity-stop-2',
  };

  const walkingContext = {
    worstEdgeMinutesSaved: 4,
    totalTravelMinutesSaved: 7,
    deltaArcContributionTotal: 0.02,
    fixedArcIssue: false,
  };
  const walkingNoteOne = buildIdeaDateTiltNarrativeNote({
    prefTilt: { vibe: 0, walking: -1, peak: 0 },
    context: walkingContext,
  });
  const walkingNoteTwo = buildIdeaDateTiltNarrativeNote({
    prefTilt: { vibe: 0, walking: -1, peak: 0 },
    context: walkingContext,
  });
  assertCondition(
    walkingNoteOne === walkingNoteTwo,
    `Tilt narrative determinism failed for walking note. one=${String(walkingNoteOne)}, two=${String(walkingNoteTwo)}`
  );
  const walkingNarrative = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        conciergeTiltNote: walkingNoteOne ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    walkingNarrative,
    'Tilt narrative coupling walking suggestion note'
  );
  const walkingNarrativeLower = walkingNarrative.toLowerCase();
  assertCondition(
    walkingNarrativeLower.includes('less walking'),
    `Tilt narrative coupling failed for walking=-1. narrative="${walkingNarrativeLower}"`
  );

  const peakContext = {
    worstEdgeMinutesSaved: 0,
    totalTravelMinutesSaved: 1,
    deltaArcContributionTotal: 0.03,
    fixedArcIssue: true,
  };
  const peakNote = buildIdeaDateTiltNarrativeNote({
    prefTilt: { vibe: 0, walking: 0, peak: 1 },
    context: peakContext,
  });
  const peakNarrative = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        conciergeTiltNote: peakNote ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    peakNarrative,
    'Tilt narrative coupling peak suggestion note'
  );
  const peakNarrativeLower = peakNarrative.toLowerCase();
  assertCondition(
    peakNarrativeLower.includes('later peak') || peakNarrativeLower.includes('build longer'),
    `Tilt narrative coupling failed for peak=1. narrative="${peakNarrativeLower}"`
  );

  const peakDuplicateGuardNarrative = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        structuralNarrative: 'Moves the peak later',
        conciergeTiltNote: peakNote ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    peakDuplicateGuardNarrative,
    'Tilt narrative coupling peak duplicate guard note'
  );
  const peakDupGuard = countLaterPeakNarrativeMentions(peakDuplicateGuardNarrative) <= 1;
  assertCondition(
    peakDupGuard,
    `Tilt narrative coupling failed: peak=1 produced duplicate later-peak mentions. note="${peakDuplicateGuardNarrative}"`
  );

  const neutralNote = buildIdeaDateTiltNarrativeNote({
    prefTilt: { vibe: 0, walking: 0, peak: 0 },
    context: walkingContext,
  });
  assertCondition(
    neutralNote == null,
    `Tilt narrative coupling failed for neutral tilt. expected null, got "${String(neutralNote)}"`
  );
  const neutralNarrative = translateSuggestion(
    baseSuggestion,
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    neutralNarrative,
    'Tilt narrative coupling neutral suggestion note'
  );
  const neutralNarrativeLower = neutralNarrative.toLowerCase();
  assertCondition(
    !neutralNarrativeLower.includes('director note:'),
    `Tilt narrative coupling failed for neutral translation. narrative="${neutralNarrativeLower}"`
  );

  return {
    deterministic: true,
    walkingNote: walkingNoteOne,
    peakNote,
    neutralNote,
    peakDupGuard,
  };
}

function runConstraintNarrativeCouplingCheck(): ConstraintNarrativeCouplingCheck {
  const baseSuggestion: IdeaDateSuggestion = {
    id: 'integrity-constraint-narrative-suggestion',
    kind: 'reorder',
    reasonCode: 'reorder_repair_arc_smoothing',
    patchOps: [
      {
        op: 'moveStop',
        stopId: 'integrity-stop-2',
        toIndex: 1,
      },
    ],
    impact: {
      before: 0.5,
      after: 0.6,
      delta: 0.1,
      before100: 50,
      after100: 60,
    },
    preview: true,
    subjectStopId: 'integrity-stop-2',
  };

  const hardDelta = buildIdeaDateSuggestionConstraintDelta({
    baseline: {
      hardCount: 1,
      softCount: 1,
      violations: [
        {
          kind: ConstraintKind.MaxTravelEdge,
          severity: 'hard',
          message: 'baseline hard',
        },
        {
          kind: ConstraintKind.LateSpike,
          severity: 'soft',
          message: 'baseline soft',
        },
      ],
    },
    after: {
      hardCount: 0,
      softCount: 1,
      violations: [
        {
          kind: ConstraintKind.LateSpike,
          severity: 'soft',
          message: 'after soft',
        },
      ],
    },
  });
  const hardNote = buildIdeaDateConstraintNarrativeNote(hardDelta);
  assertCondition(
    Boolean(hardNote) && /hard constraint/i.test(String(hardNote)),
    `Constraint narrative coupling failed: hard note missing hard-constraint concept. note=${String(hardNote)}`
  );
  const hardNarrative = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        constraintNarrativeNote: hardNote ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    hardNarrative,
    'Constraint narrative coupling hard suggestion note'
  );
  assertCondition(
    /hard constraint/i.test(hardNarrative),
    `Constraint narrative coupling failed: translated hard narrative missing concept. narrative="${hardNarrative}"`
  );

  const softDelta = buildIdeaDateSuggestionConstraintDelta({
    baseline: {
      hardCount: 0,
      softCount: 2,
      violations: [
        {
          kind: ConstraintKind.LateSpike,
          severity: 'soft',
          message: 'baseline taper',
        },
        {
          kind: ConstraintKind.DuplicateFamily,
          severity: 'soft',
          message: 'baseline variety',
        },
      ],
    },
    after: {
      hardCount: 0,
      softCount: 1,
      violations: [
        {
          kind: ConstraintKind.DuplicateFamily,
          severity: 'soft',
          message: 'after variety',
        },
      ],
    },
  });
  const softNote = buildIdeaDateConstraintNarrativeNote(softDelta);
  assertCondition(
    Boolean(softNote) && /(pacing|taper)/i.test(String(softNote)),
    `Constraint narrative coupling failed: soft note missing pacing/taper concept. note=${String(softNote)}`
  );
  const softNarrative = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        constraintNarrativeNote: softNote ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertNarrativeLineLimit(
    softNarrative,
    'Constraint narrative coupling soft suggestion note'
  );
  assertCondition(
    /(pacing|taper)/i.test(softNarrative),
    `Constraint narrative coupling failed: translated soft narrative missing concept. narrative="${softNarrative}"`
  );

  const neutralDelta = buildIdeaDateSuggestionConstraintDelta({
    baseline: {
      hardCount: 1,
      softCount: 1,
      violations: [
        {
          kind: ConstraintKind.RoleOrder,
          severity: 'hard',
          message: 'baseline order',
        },
        {
          kind: ConstraintKind.LateSpike,
          severity: 'soft',
          message: 'baseline taper',
        },
      ],
    },
    after: {
      hardCount: 1,
      softCount: 1,
      violations: [
        {
          kind: ConstraintKind.RoleOrder,
          severity: 'hard',
          message: 'after order',
        },
        {
          kind: ConstraintKind.LateSpike,
          severity: 'soft',
          message: 'after taper',
        },
      ],
    },
  });
  const neutralNote = buildIdeaDateConstraintNarrativeNote(neutralDelta);
  assertCondition(
    neutralNote == null,
    `Constraint narrative coupling failed: expected null for unchanged constraints, got "${String(neutralNote)}".`
  );

  const hardNarrativeTwo = translateSuggestion(
    {
      ...baseSuggestion,
      meta: {
        constraintNarrativeNote: hardNote ?? undefined,
      },
    },
    [],
    {
      intentScore: 0.7,
      journeyScore: 0.6,
    },
    'first_date_low_pressure',
    { debug: true }
  ).note;
  assertCondition(
    hardNarrative === hardNarrativeTwo,
    `Constraint narrative determinism failed for hard note. one="${hardNarrative}", two="${hardNarrativeTwo}".`
  );

  const hardPhraseCount = countCaseInsensitiveOccurrences(
    hardNarrative,
    'Fixes a hard constraint'
  );
  const hardPhraseUnique = hardPhraseCount <= 1;
  assertCondition(
    hardPhraseUnique,
    `Constraint narrative duplicate phrase guard failed. occurrences=${hardPhraseCount}, narrative="${hardNarrative}".`
  );

  const hasNoNumericLeak = !/\d/.test(hardNarrative) && !/\d/.test(softNarrative);
  assertCondition(
    hasNoNumericLeak,
    `Constraint narrative numeric leakage check failed. hard="${hardNarrative}", soft="${softNarrative}".`
  );
  const lineCapGuard = splitNarrativeLines(hardNarrative).length <= 2
    && splitNarrativeLines(softNarrative).length <= 2;

  return {
    deterministic: true,
    hardNote,
    softNote,
    neutralNote,
    numericLeakGuard: hasNoNumericLeak,
    lineCapGuard,
    hardPhraseUnique,
  };
}

function runStructuralNarrativeComposerCheck(): StructuralNarrativeComposerCheck {
  const deterministicInput = {
    deltaArc: 0.22,
    constraintDelta: {
      hardDelta: 0,
      softDelta: -1,
      improvedKinds: ['late_spike'],
    },
    arcContext: {
      peakShifted: 'later' as const,
      taperImproved: true,
      buildImproved: true,
    },
    frictionReduced: true,
    tiltInfluence: {
      peakShift: 1,
      walkingReduced: false,
    },
  };
  const deterministicOne = composeStructuralNarrativeDelta(deterministicInput);
  const deterministicTwo = composeStructuralNarrativeDelta(deterministicInput);
  assertCondition(
    deterministicOne === deterministicTwo,
    `Structural composer determinism failed. one="${String(deterministicOne)}", two="${String(deterministicTwo)}"`
  );

  const hardClause = composeStructuralNarrativeDelta({
    deltaArc: 0.05,
    constraintDelta: {
      hardDelta: -1,
      softDelta: 0,
    },
    arcContext: {
      peakShifted: 'earlier',
      taperImproved: true,
      buildImproved: true,
    },
    frictionReduced: true,
  });
  assertCondition(
    Boolean(hardClause) && String(hardClause).startsWith('Fixes a hard constraint'),
    `Structural composer hard-clause priority failed. narrative="${String(hardClause)}"`
  );

  const peakLaterClause = composeStructuralNarrativeDelta({
    deltaArc: 0.03,
    arcContext: {
      peakShifted: 'later',
      taperImproved: true,
      buildImproved: true,
    },
  });
  const peakLaterNormalized = peakLaterClause?.replace(/\.$/, '') ?? '';
  assertCondition(
    peakLaterNormalized === 'Moves the peak later',
    `Structural composer peak-shift clause failed. narrative="${String(peakLaterClause)}"`
  );

  const samples = [deterministicOne, hardClause, peakLaterClause].filter(
    (value): value is string => Boolean(value)
  );
  const numericLeakGuard = samples.every((sample) => !/\d/.test(sample));
  assertCondition(
    numericLeakGuard,
    `Structural composer numeric leakage failed: ${JSON.stringify(samples)}`
  );
  const maxLengthGuard = samples.every((sample) => sample.length <= 160);
  assertCondition(
    maxLengthGuard,
    `Structural composer max-length guard failed: ${JSON.stringify(samples.map((sample) => sample.length))}`
  );

  return {
    deterministic: true,
    hardClause: hardClause ?? null,
    peakLaterClause: peakLaterClause ?? null,
    numericLeakGuard,
    maxLengthGuard,
  };
}

async function runEngineInvariants26Check(): Promise<EngineInvariants26Check> {
  clearIdeaDateTravelCache();
  const seedPlan = buildIdeaDateSeedPlan({
    id: 'integrity-engine-invariants-26',
    title: 'Integrity Engine Invariants 2.6',
    seed: IDEA_DATE_MESSY_SEED,
  });

  const replacementRanking = {
    diversityPolicy: readIdeaDateDiversityPolicy('development'),
    familyKeyAdapter: ideaDatePlaceFamilyAdapter,
  };
  const offlineSearchOptions = {
    searchCandidates: () => [],
    searchPlacesNear: () => [],
    replacementRanking,
  };

  const baselineLiveOne = await recomputeIdeaDateLive(seedPlan);
  const baselineLiveTwo = await recomputeIdeaDateLive(seedPlan);
  const baselineSnapshotOne = toComputedPrimitiveSnapshot(baselineLiveOne.computed);
  const baselineSnapshotTwo = toComputedPrimitiveSnapshot(baselineLiveTwo.computed);
  assertComputedPrimitiveSnapshotEqual(
    baselineSnapshotOne,
    baselineSnapshotTwo,
    'Engine Invariants 2.6.A1 baseline recompute determinism'
  );

  const pack = await generateIdeaDateSuggestionPack(baselineLiveOne.plan, {
    ...offlineSearchOptions,
    prefTilt: readPlanPrefTiltMeta(baselineLiveOne.plan),
    mode: readPlanModeMeta(baselineLiveOne.plan),
  });
  assertCondition(
    pack.suggestions.length > 0,
    'Engine Invariants 2.6 requires at least one suggestion for preview/apply checks.'
  );
  const topSuggestion = pack.suggestions[0];
  const baselinePlanSignature = buildPlanStateSignature(baselineLiveOne.plan);
  const previewPlan = applyIdeaDatePatchOps(baselineLiveOne.plan, topSuggestion.patchOps);
  await recomputeIdeaDateLive(previewPlan);
  const baselineAfterPreviewLive = await recomputeIdeaDateLive(baselineLiveOne.plan);
  assertCondition(
    buildPlanStateSignature(baselineLiveOne.plan) === baselinePlanSignature,
    'Engine Invariants 2.6.A2 preview isolation failed: baseline plan mutated during preview simulation.'
  );
  assertComputedPrimitiveSnapshotEqual(
    baselineSnapshotOne,
    toComputedPrimitiveSnapshot(baselineAfterPreviewLive.computed),
    'Engine Invariants 2.6.A2 preview isolation baseline recompute'
  );

  let suggestionsChecked = 0;
  for (const suggestion of pack.suggestions) {
    const previewCandidatePlan = applyIdeaDatePatchOps(baselineLiveOne.plan, suggestion.patchOps);
    const applyCandidatePlan = applyIdeaDatePatchOps(baselineLiveOne.plan, suggestion.patchOps);
    const previewCandidateLive = await recomputeIdeaDateLive(previewCandidatePlan);
    const applyCandidateLive = await recomputeIdeaDateLive(applyCandidatePlan);
    const previewSignature = buildPlanStateSignature(previewCandidateLive.plan);
    const applySignature = buildPlanStateSignature(applyCandidateLive.plan);
    assertCondition(
      previewSignature === applySignature,
      `Engine Invariants 2.6.A3 apply correctness plan mismatch for ${suggestion.id}: preview=${previewSignature}, apply=${applySignature}`
    );
    assertComputedPrimitiveSnapshotEqual(
      toComputedPrimitiveSnapshot(previewCandidateLive.computed),
      toComputedPrimitiveSnapshot(applyCandidateLive.computed),
      `Engine Invariants 2.6.A3 apply correctness computed (${suggestion.id})`
    );
    suggestionsChecked += 1;
  }

  const isolatedMetaPlan = withPlanMetaMode(
    withPlanMetaPrefTilt(baselineLiveOne.plan, { vibe: 1, walking: -1, peak: 1 }),
    'family'
  );
  const isolatedMetaLive = await recomputeIdeaDateLive(isolatedMetaPlan);
  assertComputedPrimitiveSnapshotEqual(
    baselineSnapshotOne,
    toComputedPrimitiveSnapshot(isolatedMetaLive.computed),
    'Engine Invariants 2.6.B4 baseline scoring isolation from mode/prefTilt'
  );

  const neutralRefine = await generateReplacementSuggestionsWithStats(
    baselineLiveOne.plan,
    baselineLiveOne.computed,
    {
      ...offlineSearchOptions,
      prefTilt: { vibe: 0, walking: 0, peak: 0 },
      mode: 'default',
    }
  );
  const tiltedRefine = await generateReplacementSuggestionsWithStats(
    baselineLiveOne.plan,
    baselineLiveOne.computed,
    {
      ...offlineSearchOptions,
      prefTilt: { vibe: 0, walking: -1, peak: 1 },
      mode: 'family',
    }
  );
  const neutralEffectiveTilt = neutralRefine.refineStats.debugEffectivePrefTilt ?? neutralRefine.refineStats.debugPrefTilt;
  const tiltedEffectiveTilt = tiltedRefine.refineStats.debugEffectivePrefTilt ?? tiltedRefine.refineStats.debugPrefTilt;
  assertCondition(
    Boolean(neutralEffectiveTilt && tiltedEffectiveTilt),
    'Engine Invariants 2.6.B4 refine telemetry check failed: missing effective tilt telemetry.'
  );
  assertCondition(
    JSON.stringify(neutralEffectiveTilt) !== JSON.stringify(tiltedEffectiveTilt),
    `Engine Invariants 2.6.B4 refine telemetry did not change. neutral=${JSON.stringify(neutralEffectiveTilt)}, tilted=${JSON.stringify(tiltedEffectiveTilt)}`
  );
  assertCondition(
    JSON.stringify(neutralRefine.refineStats.debugTiltWeightMap ?? null)
      !== JSON.stringify(tiltedRefine.refineStats.debugTiltWeightMap ?? null),
    `Engine Invariants 2.6.B4 refine weight map did not change. neutral=${JSON.stringify(neutralRefine.refineStats.debugTiltWeightMap)}, tilted=${JSON.stringify(tiltedRefine.refineStats.debugTiltWeightMap)}`
  );

  const deterministicPlan = withPlanMetaMode(
    withPlanMetaPrefTilt(baselineLiveOne.plan, { vibe: 0, walking: -1, peak: 1 }),
    'tourist_day'
  );
  const deterministicLive = await recomputeIdeaDateLive(deterministicPlan);
  const deterministicPrefTilt = readPlanPrefTiltMeta(deterministicLive.plan);
  const deterministicMode = readPlanModeMeta(deterministicLive.plan);
  const deterministicRefineOptions = {
    ...offlineSearchOptions,
    prefTilt: deterministicPrefTilt,
    mode: deterministicMode,
  };
  const deterministicRunOne = await generateReplacementSuggestionsWithStats(
    deterministicLive.plan,
    deterministicLive.computed,
    deterministicRefineOptions
  );
  const deterministicRunTwo = await generateReplacementSuggestionsWithStats(
    deterministicLive.plan,
    deterministicLive.computed,
    deterministicRefineOptions
  );
  const statsOne = deterministicRunOne.refineStats;
  const statsTwo = deterministicRunTwo.refineStats;
  assertCondition(
    statsOne.debugPassUsed === statsTwo.debugPassUsed,
    `Engine Invariants 2.6.B5 passUsed mismatch: one=${String(statsOne.debugPassUsed)}, two=${String(statsTwo.debugPassUsed)}`
  );
  assertCondition(
    statsOne.candidateCount === statsTwo.candidateCount
      && statsOne.evaluatedCount === statsTwo.evaluatedCount
      && statsOne.discardedCount === statsTwo.discardedCount,
    `Engine Invariants 2.6.B5 candidate counters mismatch: one=${JSON.stringify({ candidateCount: statsOne.candidateCount, evaluatedCount: statsOne.evaluatedCount, discardedCount: statsOne.discardedCount })}, two=${JSON.stringify({ candidateCount: statsTwo.candidateCount, evaluatedCount: statsTwo.evaluatedCount, discardedCount: statsTwo.discardedCount })}`
  );
  assertCondition(
    JSON.stringify(statsOne.discardCounts) === JSON.stringify(statsTwo.discardCounts),
    `Engine Invariants 2.6.B5 discard breakdown mismatch: one=${JSON.stringify(statsOne.discardCounts)}, two=${JSON.stringify(statsTwo.discardCounts)}`
  );
  assertCondition(
    JSON.stringify(statsOne.debugPassBreakdown ?? null) === JSON.stringify(statsTwo.debugPassBreakdown ?? null),
    `Engine Invariants 2.6.B5 pass breakdown mismatch: one=${compactSerialized(statsOne.debugPassBreakdown)}, two=${compactSerialized(statsTwo.debugPassBreakdown)}`
  );

  const deterministicPackOne = await generateIdeaDateSuggestionPack(deterministicLive.plan, deterministicRefineOptions);
  const deterministicPackTwo = await generateIdeaDateSuggestionPack(deterministicLive.plan, deterministicRefineOptions);
  const topSuggestionOne = deterministicPackOne.suggestions[0] ?? null;
  const topSuggestionTwo = deterministicPackTwo.suggestions[0] ?? null;
  const topSuggestionSemanticSignatureOne = topSuggestionOne
    ? buildIdeaDateSuggestionSemanticSignature(topSuggestionOne, deterministicPackOne.plan)
    : null;
  const topSuggestionSemanticSignatureTwo = topSuggestionTwo
    ? buildIdeaDateSuggestionSemanticSignature(topSuggestionTwo, deterministicPackTwo.plan)
    : null;
  const topSuggestionDeltaArcOne = topSuggestionOne?.arcImpact?.deltaTotal ?? null;
  const topSuggestionDeltaArcTwo = topSuggestionTwo?.arcImpact?.deltaTotal ?? null;
  assertCondition(
    topSuggestionSemanticSignatureOne === topSuggestionSemanticSignatureTwo,
    `Engine Invariants 2.6.B5 top semantic signature mismatch: one=${String(topSuggestionSemanticSignatureOne)}, two=${String(topSuggestionSemanticSignatureTwo)}`
  );
  assertCondition(
    topSuggestionDeltaArcOne === topSuggestionDeltaArcTwo,
    `Engine Invariants 2.6.B5 top deltaArc mismatch: one=${String(topSuggestionDeltaArcOne)}, two=${String(topSuggestionDeltaArcTwo)}`
  );

  const replacementSuggestion = pack.suggestions.find((suggestion) => suggestion.kind === 'replacement') ?? null;
  const reorderSuggestion = pack.suggestions.find((suggestion) => suggestion.kind === 'reorder')
    ?? generateReorderSuggestion(baselineLiveOne.plan, baselineLiveOne.computed)
    ?? {
      id: 'integrity-engine-26-synthetic-reorder',
      kind: 'reorder' as const,
      reasonCode: 'integrity_reorder',
      patchOps: [
        {
          op: 'moveStop' as const,
          stopId: baselineLiveOne.plan.stops[1]?.id ?? baselineLiveOne.plan.stops[0]?.id ?? '',
          toIndex: 0,
        },
      ],
      impact: {
        before: baselineLiveOne.computed.journeyScore,
        after: baselineLiveOne.computed.journeyScore,
        delta: 0,
        before100: baselineLiveOne.computed.journeyScore100,
        after100: baselineLiveOne.computed.journeyScore100,
      },
      preview: true,
      subjectStopId: baselineLiveOne.plan.stops[1]?.id ?? baselineLiveOne.plan.stops[0]?.id ?? '',
    };
  assertCondition(
    Boolean(replacementSuggestion),
    'Engine Invariants 2.6.C requires at least one replacement suggestion for patch invariant checks.'
  );
  assertCondition(
    reorderSuggestion.patchOps.length > 0 && reorderSuggestion.patchOps[0].op === 'moveStop',
    'Engine Invariants 2.6.C requires a reorder moveStop patch for patch invariant checks.'
  );
  if (!replacementSuggestion) {
    throw new Error('Engine Invariants 2.6.C missing replacement suggestion.');
  }
  const replacementPatchedPlan = applyIdeaDatePatchOps(baselineLiveOne.plan, replacementSuggestion.patchOps);
  assertCondition(
    replacementPatchedPlan.stops.length === baselineLiveOne.plan.stops.length,
    `Engine Invariants 2.6.C replacement stop-count invariant failed: before=${baselineLiveOne.plan.stops.length}, after=${replacementPatchedPlan.stops.length}`
  );
  assertUniqueStopIds(replacementPatchedPlan, 'Engine Invariants 2.6.C replacement unique stopIds');
  const replacementDuplicatePlaceIds = collectDuplicatePlaceIds(replacementPatchedPlan);
  assertCondition(
    replacementDuplicatePlaceIds.length === 0,
    `Engine Invariants 2.6.C replacement duplicate place occupancy: ${replacementDuplicatePlaceIds.join(', ')}`
  );
  const reorderPatchedPlan = applyIdeaDatePatchOps(baselineLiveOne.plan, reorderSuggestion.patchOps);
  assertUniqueStopIds(reorderPatchedPlan, 'Engine Invariants 2.6.C reorder unique stopIds');
  assertRolesMatchIndexConvention(reorderPatchedPlan, 'Engine Invariants 2.6.C reorder role normalization');

  const signatures = pack.suggestions.map((suggestion) =>
    buildIdeaDateSuggestionSemanticSignature(suggestion, pack.plan)
  );
  const uniqueSignatures = new Set(signatures);
  assertCondition(
    uniqueSignatures.size === signatures.length,
    `Engine Invariants 2.6.D duplicate semantic signatures found: ${signatures.join(', ')}`
  );
  const duplicateCandidate: IdeaDateSuggestion = {
    ...pack.suggestions[0],
    id: `${pack.suggestions[0].id}-dup-engine-26`,
  };
  const dedupedSuggestions = dedupeIdeaDateSuggestionsBySemanticSignature(
    [...pack.suggestions, duplicateCandidate],
    pack.plan
  );
  assertCondition(
    dedupedSuggestions.length === pack.suggestions.length,
    `Engine Invariants 2.6.D dedupe length mismatch: expected=${pack.suggestions.length}, actual=${dedupedSuggestions.length}`
  );
  assertArrayEqual(
    dedupedSuggestions.map((suggestion) => suggestion.id),
    pack.suggestions.map((suggestion) => suggestion.id),
    'Engine Invariants 2.6.D stable order first-wins'
  );

  const suggestionContext = buildSuggestionContext(pack.plan);
  let narrativeCheckedCount = 0;
  for (const suggestion of pack.suggestions) {
    const translation = translateSuggestion(
      suggestion,
      baselineLiveOne.computed.violations,
      {
        intentScore: baselineLiveOne.computed.intentScore,
        journeyScore: baselineLiveOne.computed.journeyScore,
      },
      'first_date_low_pressure',
      suggestionContext
    );
    assertNoNarrativeDebugLeak(
      translation.note,
      `Engine Invariants 2.6.E suggestion note (${suggestion.id})`
    );
    assertNarrativeLineLimit(
      translation.note,
      `Engine Invariants 2.6.E line cap (${suggestion.id})`
    );
    assertCondition(
      countCaseInsensitiveOccurrences(translation.note, 'Fixes a hard constraint') <= 1,
      `Engine Invariants 2.6.E duplicate hard-constraint phrase (${suggestion.id}). note="${translation.note}"`
    );
    assertCondition(
      countLaterPeakNarrativeMentions(translation.note) <= 1,
      `Engine Invariants 2.6.E duplicate later-peak mentions (${suggestion.id}). note="${translation.note}"`
    );
    if (translation.constraintNote) {
      assertNoNarrativeDebugLeak(
        translation.constraintNote,
        `Engine Invariants 2.6.E constraint note (${suggestion.id})`
      );
    }
    narrativeCheckedCount += 1;
  }
  assertCondition(
    narrativeCheckedCount > 0,
    'Engine Invariants 2.6.E requires at least one translated suggestion note.'
  );

  return {
    recomputePreviewApply: {
      baselineDeterministic: true,
      previewIsolation: true,
      applyMatchesPreview: true,
      suggestionsChecked,
    },
    refineIsolation: {
      baselineUnaffectedByModePrefTilt: true,
      refineTelemetryChanged: true,
      refineDeterministic: true,
      topSuggestionSemanticSignature: topSuggestionSemanticSignatureOne,
      topSuggestionDeltaArc: topSuggestionDeltaArcOne,
    },
    patchOpsInvariants: {
      replacementChecked: true,
      reorderChecked: true,
    },
    suggestionDedupe: {
      uniqueSignatures: true,
      stableFirstWins: true,
      signatureCount: signatures.length,
    },
    narrativeNonLeakage: {
      checkedCount: narrativeCheckedCount,
      passed: true,
    },
  };
}

async function main(): Promise<void> {
  const startMs = Date.now();
  const deterministicMessy = await runDeterminismCheck();
  const boundary = await runStopCountBoundaryCheck();
  const degenerate = await runDegenerateTravelCheck();
  const monotonic = await runMonotonicFrictionCheck();
  const validity = await runSuggestionValidityCheck(deterministicMessy);
  const telemetry = await runResolverTelemetrySanityCheck();
  const lensSemanticDedupe = await runLensSemanticDedupeCheck();
  const arcTieBreak = await runArcTieBreakRegressionCheck();
  const diversityClassifier = runDiversityClassifierDeterminismCheck();
  const queryHardening = await runQueryHardeningScenarioCheck();
  const repairMode = await runRepairModeMockCandidateCheck();
  const reorderRepair = await runReorderRepairFallbackCheck();
  const hardConstraintGuardrail = await runHardConstraintGuardrailCheck();
  const prefTiltSensitivity = await runPrefTiltSensitivityCheck();
  const prefTiltRefFreshness = await runPrefTiltRefFreshnessCheck();
  const prefTiltPlanMetaPersistence = await runPrefTiltPlanMetaPersistenceCheck();
  const modePolicyDefaults = await runModePolicyDefaultsCheck();
  const modeAwareRefineComposition = await runModeAwareRefineCompositionCheck();
  const tiltNarrativeCoupling = runTiltNarrativeCouplingCheck();
  const constraintNarrativeCoupling = runConstraintNarrativeCouplingCheck();
  const structuralNarrativeComposer = runStructuralNarrativeComposerCheck();
  const engineInvariants26 = await runEngineInvariants26Check();
  const runtimeMs = Date.now() - startMs;

  // eslint-disable-next-line no-console
  console.log('Idea-Date integrity checks passed');
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        messy: {
          score100: deterministicMessy.score100,
          violations: deterministicMessy.violations,
          constraintHardCount: deterministicMessy.constraintHardCount,
          constraintSoftCount: deterministicMessy.constraintSoftCount,
          constraintNarratives: deterministicMessy.constraintNarratives,
          suggestions: deterministicMessy.suggestionCount,
          suggestionIds: deterministicMessy.suggestionIds,
          arcPoints: deterministicMessy.arcPoints,
          arcContributionTotal: Number(deterministicMessy.arcContributionTotal.toFixed(6)),
        },
        stopBoundaries: boundary.map((entry) => ({
          stopCount: entry.stopCount,
          score100: entry.score100,
          arcPoints: entry.arcPoints,
          arcContributionTotal: Number(entry.arcContributionTotal.toFixed(6)),
          violations: entry.violations,
        })),
        degenerateTravel: {
          score100: degenerate.score100,
          score01: Number(degenerate.score01.toFixed(3)),
          friction: Number(degenerate.friction.toFixed(6)),
          arcPoints: degenerate.arcPoints,
          arcContributionTotal: Number(degenerate.arcContributionTotal.toFixed(6)),
        },
        monotonic: {
          baseScore100: monotonic.base.score100,
          stretchedScore100: monotonic.stretched.score100,
          baseFriction: Number(monotonic.base.friction.toFixed(3)),
          stretchedFriction: Number(monotonic.stretched.friction.toFixed(3)),
        },
        suggestionOps: {
          beforeScore100: validity.beforeScore100,
          beforeArcContributionTotal: Number(validity.beforeArcContributionTotal.toFixed(6)),
          suggestions: validity.suggestionCount,
          validatedOps: validity.validatedOps,
          appliedSuggestions: validity.appliedSuggestions,
        },
        resolverTelemetry: {
          lastResolverUsed: telemetry.resolverUsed,
          lastCandidateCount: telemetry.candidateCount,
          lastResolverError: telemetry.resolverError,
        },
        lensSemanticDedupe: {
          before: lensSemanticDedupe.before,
          after: lensSemanticDedupe.after,
          duplicateRemoved: lensSemanticDedupe.duplicateRemoved,
          reorderBefore: lensSemanticDedupe.reorderBefore,
          reorderAfter: lensSemanticDedupe.reorderAfter,
          reorderDuplicateRemoved: lensSemanticDedupe.reorderDuplicateRemoved,
        },
        arcTieBreak: {
          syntheticTiePreserved: arcTieBreak.syntheticTiePreserved,
          observedRuntimeTies: arcTieBreak.observedRuntimeTies,
        },
        diversityClassifier: {
          deterministic: diversityClassifier.deterministic,
          families: diversityClassifier.families,
        },
        queryHardening: {
          candidatesSeen: queryHardening.candidatesSeen,
          candidatesKept: queryHardening.candidatesKept,
          suggestionsGenerated: queryHardening.suggestionsGenerated,
          passUsed: queryHardening.passUsed,
          templateUsed: queryHardening.templateUsed,
          queryTypesCount: queryHardening.queryTypesCount,
          queryRadiusMeters: queryHardening.queryRadiusMeters,
          planFamilyKeys: queryHardening.planFamilyKeys,
        },
        repairMode: {
          passUsed: repairMode.passUsed,
          suggestionsGenerated: repairMode.suggestionsGenerated,
          candidatesSeen: repairMode.candidatesSeen,
          candidatesKept: repairMode.candidatesKept,
        },
        reorderRepair: {
          passUsed: reorderRepair.passUsed,
          suggestionsGenerated: reorderRepair.suggestionsGenerated,
          candidatesSeen: reorderRepair.candidatesSeen,
          candidatesKept: reorderRepair.candidatesKept,
          reorderCandidatesEvaluated: reorderRepair.reorderCandidatesEvaluated,
        },
        hardConstraintGuardrail: {
          discardedAsHardIncrease: hardConstraintGuardrail.discardedAsHardIncrease,
          suggestionsGenerated: hardConstraintGuardrail.suggestionsGenerated,
          hardCandidateDiscarded: hardConstraintGuardrail.hardCandidateDiscarded,
        },
        prefTiltSensitivity: {
          deterministicNeutral: prefTiltSensitivity.deterministicNeutral,
          deterministicWalkingSensitive: prefTiltSensitivity.deterministicWalkingSensitive,
          neutralSuggestionId: prefTiltSensitivity.neutralSuggestionId,
          walkingSensitiveSuggestionId: prefTiltSensitivity.walkingSensitiveSuggestionId,
          changed: prefTiltSensitivity.changed,
        },
        prefTiltRefFreshness: {
          previous: prefTiltRefFreshness.previous,
          current: prefTiltRefFreshness.current,
          reported: prefTiltRefFreshness.reported,
          matchedCurrent: prefTiltRefFreshness.matchedCurrent,
          matchedPrevious: prefTiltRefFreshness.matchedPrevious,
        },
        prefTiltPlanMetaPersistence: {
          stored: prefTiltPlanMetaPersistence.stored,
          restored: prefTiltPlanMetaPersistence.restored,
          restoredSecondInit: prefTiltPlanMetaPersistence.restoredSecondInit,
          committedAfterPreview: prefTiltPlanMetaPersistence.committedAfterPreview,
          previewPlanTilt: prefTiltPlanMetaPersistence.previewPlanTilt,
          deterministic: prefTiltPlanMetaPersistence.deterministic,
          unaffectedByPreview: prefTiltPlanMetaPersistence.unaffectedByPreview,
        },
        modePolicyDefaults: {
          defaultWhenMissing: modePolicyDefaults.defaultWhenMissing,
          modeAfterSet: modePolicyDefaults.modeAfterSet,
          modeAfterReload: modePolicyDefaults.modeAfterReload,
          expectedDefaultPrefTilt: modePolicyDefaults.expectedDefaultPrefTilt,
          appliedPrefTilt: modePolicyDefaults.appliedPrefTilt,
          reloadedPrefTilt: modePolicyDefaults.reloadedPrefTilt,
          deterministic: modePolicyDefaults.deterministic,
        },
        modeAwareRefineComposition: {
          neutralExpected: modeAwareRefineComposition.neutralExpected,
          neutralModeDefaults: modeAwareRefineComposition.neutralModeDefaults,
          neutralEffectiveRunOne: modeAwareRefineComposition.neutralEffectiveRunOne,
          neutralEffectiveRunTwo: modeAwareRefineComposition.neutralEffectiveRunTwo,
          neutralDeterministic: modeAwareRefineComposition.neutralDeterministic,
          nonNeutralExpected: modeAwareRefineComposition.nonNeutralExpected,
          nonNeutralEffectiveTouristDay: modeAwareRefineComposition.nonNeutralEffectiveTouristDay,
          nonNeutralEffectiveFamily: modeAwareRefineComposition.nonNeutralEffectiveFamily,
          nonNeutralModeIndependent: modeAwareRefineComposition.nonNeutralModeIndependent,
          deterministic: modeAwareRefineComposition.deterministic,
        },
        tiltNarrativeCoupling: {
          deterministic: tiltNarrativeCoupling.deterministic,
          walkingNote: tiltNarrativeCoupling.walkingNote,
          peakNote: tiltNarrativeCoupling.peakNote,
          neutralNote: tiltNarrativeCoupling.neutralNote,
          peakDupGuard: tiltNarrativeCoupling.peakDupGuard,
        },
        constraintNarrativeCoupling: {
          deterministic: constraintNarrativeCoupling.deterministic,
          hardNote: constraintNarrativeCoupling.hardNote,
          softNote: constraintNarrativeCoupling.softNote,
          neutralNote: constraintNarrativeCoupling.neutralNote,
          numericLeakGuard: constraintNarrativeCoupling.numericLeakGuard,
          lineCapGuard: constraintNarrativeCoupling.lineCapGuard,
          hardPhraseUnique: constraintNarrativeCoupling.hardPhraseUnique,
        },
        structuralNarrativeComposer: {
          deterministic: structuralNarrativeComposer.deterministic,
          hardClause: structuralNarrativeComposer.hardClause,
          peakLaterClause: structuralNarrativeComposer.peakLaterClause,
          numericLeakGuard: structuralNarrativeComposer.numericLeakGuard,
          maxLengthGuard: structuralNarrativeComposer.maxLengthGuard,
        },
        'Engine Invariants (2.6)': {
          recomputePreviewApply: engineInvariants26.recomputePreviewApply,
          refineIsolation: engineInvariants26.refineIsolation,
          patchOpsInvariants: engineInvariants26.patchOpsInvariants,
          suggestionDedupe: engineInvariants26.suggestionDedupe,
          narrativeNonLeakage: engineInvariants26.narrativeNonLeakage,
        },
        runtimeMs,
      },
      null,
      2
    )
  );
}

void main();
