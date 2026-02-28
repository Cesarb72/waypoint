import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '@/app/plan-engine/types';
import {
  IDEA_DATE_DEFAULT_PREF_TILT,
  IDEA_DATE_DISCARD_REASON_ORDER,
  generateIdeaDateSuggestionPack,
  normalizeIdeaDatePrefTilt,
  recomputeIdeaDateLive,
  IdeaDateStopProfileSchema,
  parseIdeaDatePlanProfile,
  translateSuggestion,
  type IdeaDateArcModel,
  type IdeaDateComputedMetrics,
  type IdeaDatePrefTilt,
  type IdeaDatePrefTiltValue,
  type IdeaDateRefineStats,
  type IdeaDateRole,
  type IdeaDateSuggestion,
  type IdeaDateTravelSummary,
} from '@/lib/engine/idea-date';
import type { IdeaDateOverrides } from '@/lib/engine/idea-date/schemas';
import { applyIdeaDateOps } from './ops';
import { searchIdeaDateCandidates } from './candidateSearch';
import { readIdeaDateDiversityPolicy } from './diversityPolicy';
import { searchGoogleCandidates } from './googleCandidateResolver';
import { ideaDatePlaceFamilyAdapter } from './placeFamilyAdapter';
import { IDEA_DATE_CLEAN_SEED, buildIdeaDateSeedPlan } from './seeds';
import { getPlan, setPlan } from './store';
import {
  IDEA_DATE_DEFAULT_MODE,
  getIdeaDateModePolicy,
  normalizeIdeaDateMode,
  type IdeaDateMode,
} from './modePolicy';

const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
const enableLocalCandidateResolver = process.env.NEXT_PUBLIC_IDEA_DATE_REAL_RESOLVER === '1';
const enableGoogleCandidateResolver = process.env.NEXT_PUBLIC_IDEA_DATE_GOOGLE_RESOLVER === '1';
const isDevelopment = process.env.NODE_ENV !== 'production';
export type ResolverUsed = 'google' | 'local' | 'mock' | 'unknown';

export type IdeaDateResolverTelemetry = {
  used: ResolverUsed;
  count: number;
  error: string | null;
};

export type { IdeaDatePrefTilt, IdeaDatePrefTiltValue };
export { IDEA_DATE_DEFAULT_PREF_TILT };
export type { IdeaDateMode };
export { IDEA_DATE_DEFAULT_MODE };

function isResolverUsed(value: unknown): value is ResolverUsed {
  return value === 'google' || value === 'local' || value === 'mock' || value === 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readPlanPrefTiltMeta(plan: Pick<Plan, 'meta'> | null | undefined): IdeaDatePrefTilt {
  const rawPrefTilt = isRecord(plan?.meta) && isRecord(plan.meta.prefTilt)
    ? plan.meta.prefTilt
    : null;
  return normalizeIdeaDatePrefTilt(rawPrefTilt);
}

export function readPlanModeMeta(plan: Pick<Plan, 'meta'> | null | undefined): IdeaDateMode {
  const rawMode = isRecord(plan?.meta) ? plan.meta.mode : undefined;
  return normalizeIdeaDateMode(rawMode);
}

export function withPlanMetaPrefTilt(plan: Plan, prefTilt: Partial<IdeaDatePrefTilt>): Plan {
  const nextPrefTilt = normalizeIdeaDatePrefTilt(prefTilt);
  const currentMeta = isRecord(plan.meta) ? plan.meta : {};
  return {
    ...plan,
    meta: {
      ...currentMeta,
      prefTilt: nextPrefTilt,
    },
  };
}

export function withPlanMetaMode(plan: Plan, mode: IdeaDateMode): Plan {
  const currentMeta = isRecord(plan.meta) ? plan.meta : {};
  return {
    ...plan,
    meta: {
      ...currentMeta,
      mode: normalizeIdeaDateMode(mode),
    },
  };
}

export function withPlanModeDefaultsApplied(plan: Plan, mode?: IdeaDateMode): Plan {
  const nextMode = normalizeIdeaDateMode(mode ?? readPlanModeMeta(plan));
  const policy = getIdeaDateModePolicy(nextMode);
  return withPlanMetaPrefTilt(withPlanMetaMode(plan, nextMode), policy.defaultPrefTilt);
}

function prefTiltEquals(left: IdeaDatePrefTilt, right: IdeaDatePrefTilt): boolean {
  return left.vibe === right.vibe && left.walking === right.walking && left.peak === right.peak;
}

function sanitizeTelemetryError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? 'resolver_error');
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 119)}...`;
}

function formatRefineDiscardSummary(stats: IdeaDateRefineStats | undefined): string | null {
  if (!stats) return null;
  const entries = IDEA_DATE_DISCARD_REASON_ORDER
    .map((reason) => ({ reason, count: stats.discardCounts[reason] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.reason}=${entry.count}`);
  if (entries.length === 0) return null;
  return entries.join(', ');
}

function readSeedResolverTelemetry(plan: Plan): IdeaDateResolverTelemetry | null {
  const rawIdeaDate = isRecord(plan.meta?.ideaDate) ? plan.meta.ideaDate : null;
  const rawTelemetry = rawIdeaDate && isRecord(rawIdeaDate.seedResolverTelemetry)
    ? rawIdeaDate.seedResolverTelemetry
    : null;
  if (!rawTelemetry) return null;
  const used = isResolverUsed(rawTelemetry.used) ? rawTelemetry.used : 'unknown';
  const count = typeof rawTelemetry.count === 'number' && Number.isFinite(rawTelemetry.count)
    ? Math.max(0, Math.floor(rawTelemetry.count))
    : 0;
  const error = typeof rawTelemetry.error === 'string' && rawTelemetry.error.trim().length > 0
    ? rawTelemetry.error.trim()
    : null;
  return { used, count, error };
}

function readRole(stop: Plan['stops'][number]): IdeaDateRole {
  const raw = isRecord(stop.ideaDate) ? stop.ideaDate.role : null;
  if (raw === 'start' || raw === 'main' || raw === 'windDown' || raw === 'flex') return raw;
  if (stop.role === 'anchor') return 'start';
  if (stop.role === 'support') return 'main';
  return 'flex';
}

function readOverrides(stop: Plan['stops'][number]): IdeaDateOverrides {
  const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
  const rawOverrides = rawIdeaDate && isRecord(rawIdeaDate.overrides) ? rawIdeaDate.overrides : null;
  const read = (key: keyof IdeaDateOverrides) => {
    const value = rawOverrides?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    chillLively: read('chillLively'),
    relaxedActive: read('relaxedActive'),
    quickLingering: read('quickLingering'),
  };
}

type IdeaDateSuggestionPack = Awaited<ReturnType<typeof generateIdeaDateSuggestionPack>>;

function readReplacePatchOpPlaceId(
  op: Extract<IdeaDateSuggestion['patchOps'][number], { op: 'replaceStop' }>
): string {
  const fromRef = op.newPlace.placeRef?.placeId?.trim();
  if (fromRef) return fromRef;
  const fromLite = op.newPlace.placeLite?.placeId?.trim();
  if (fromLite) return fromLite;
  return '';
}

export function stablePatchOpsSignature(patchOps: IdeaDateSuggestion['patchOps']): string {
  return patchOps
    .map((op) => {
      if (op.op === 'moveStop') {
        return `move:${op.stopId}:${op.toIndex}`;
      }
      return `replace:${op.stopId}:${readReplacePatchOpPlaceId(op)}`;
    })
    .join('|');
}

function buildReorderFinalOrderSignature(plan: Plan, patchOps: IdeaDateSuggestion['patchOps']): string | null {
  try {
    const nextPlan = applyIdeaDateOps(plan, patchOps);
    return (nextPlan.stops ?? []).map((stop) => stop.id).join('>');
  } catch {
    return null;
  }
}

function isReorderOnlySuggestion(suggestion: IdeaDateSuggestion): boolean {
  const hasMoveStop = suggestion.patchOps.some((op) => op.op === 'moveStop');
  const hasReplaceStop = suggestion.patchOps.some((op) => op.op === 'replaceStop');
  return hasMoveStop && !hasReplaceStop;
}

export function buildIdeaDateSuggestionSemanticSignature(
  suggestion: IdeaDateSuggestion,
  plan?: Plan
): string {
  if (isReorderOnlySuggestion(suggestion) && plan) {
    const finalOrderSignature = buildReorderFinalOrderSignature(plan, suggestion.patchOps);
    if (finalOrderSignature) return `reorder:${finalOrderSignature}`;
  }
  return `${suggestion.kind}:${stablePatchOpsSignature(suggestion.patchOps)}`;
}

export function dedupeIdeaDateSuggestionsBySemanticSignature(
  suggestions: IdeaDateSuggestion[],
  plan?: Plan
): IdeaDateSuggestion[] {
  const seen = new Set<string>();
  const deduped: IdeaDateSuggestion[] = [];
  for (const suggestion of suggestions) {
    const signature = buildIdeaDateSuggestionSemanticSignature(suggestion, plan);
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(suggestion);
  }
  return deduped;
}

export async function generateIdeaDateSuggestionPackWithTelemetry(
  plan: Plan,
  options?: {
    enableGoogleResolver?: boolean;
    enableLocalResolver?: boolean;
    prefTilt?: Partial<IdeaDatePrefTilt>;
    mode?: IdeaDateMode;
  }
): Promise<{
  pack: IdeaDateSuggestionPack;
  telemetry: IdeaDateResolverTelemetry;
}> {
  const useGoogleResolver = options?.enableGoogleResolver ?? enableGoogleCandidateResolver;
  const useLocalResolver = options?.enableLocalResolver ?? enableLocalCandidateResolver;
  const telemetry: IdeaDateResolverTelemetry = {
    used: useGoogleResolver || useLocalResolver ? 'unknown' : 'mock',
    count: 0,
    error: null,
  };

  const searchCandidates = useGoogleResolver || useLocalResolver
    ? async (args: Parameters<typeof searchGoogleCandidates>[0]) => {
        let googleCandidates: Awaited<ReturnType<typeof searchGoogleCandidates>> = [];
        if (useGoogleResolver) {
          try {
            googleCandidates = await searchGoogleCandidates(args);
          } catch (nextError) {
            telemetry.error = sanitizeTelemetryError(nextError);
            googleCandidates = [];
          }
          if (googleCandidates.length >= 3) {
            telemetry.used = 'google';
            telemetry.count = googleCandidates.length;
            return googleCandidates;
          }
        }

        if (useLocalResolver) {
          try {
            const localCandidates = await searchIdeaDateCandidates(args);
            telemetry.used = localCandidates.length > 0 ? 'local' : 'mock';
            telemetry.count = localCandidates.length;
            return localCandidates;
          } catch (nextError) {
            if (!telemetry.error) {
              telemetry.error = sanitizeTelemetryError(nextError);
            }
            telemetry.used = 'mock';
            telemetry.count = 0;
            return [];
          }
        }

        telemetry.used = googleCandidates.length > 0 ? 'google' : 'mock';
        telemetry.count = googleCandidates.length;
        return googleCandidates;
      }
    : undefined;

  const pack = await generateIdeaDateSuggestionPack(plan, {
    searchCandidates,
    replacementRanking: {
      diversityPolicy: readIdeaDateDiversityPolicy(),
      familyKeyAdapter: ideaDatePlaceFamilyAdapter,
    },
    prefTilt: options?.prefTilt,
    mode: options?.mode,
  });

  // `unknown` means the resolver callback was never exercised in this refine cycle.
  // Do not treat that as missing plan meta telemetry.
  if (telemetry.used === 'unknown') {
    telemetry.used = 'mock';
  }

  return { pack, telemetry };
}

export type IdeaDateTravelSummaryLite = {
  worstEdgeMin: number;
  totalTravelMin: number;
  edgeCount: number;
};

export type IdeaDateAppliedNotice = {
  title: string;
  lines: string[];
  ts: number;
};

function normalizeNoticeLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function containsNumericLeak(value: string): boolean {
  return /\d/.test(value);
}

function dedupeNoticeLines(lines: string[], maxLines = 2): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    const normalized = normalizeNoticeLine(line);
    if (!normalized || deduped.includes(normalized)) continue;
    if (containsNumericLeak(normalized)) continue;
    deduped.push(normalized);
    if (deduped.length >= maxLines) break;
  }
  return deduped;
}

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function semanticTokenSet(value: string): Set<string> {
  const normalized = normalizeNoticeLine(value).toLowerCase();
  const tokens = new Set<string>();
  if (includesAny(normalized, ['hard constraint'])) tokens.add('hard_constraint');
  if (includesAny(normalized, ['pacing', 'taper'])) tokens.add('pacing');
  if (includesAny(normalized, ['later peak', 'peak later', 'build longer'])) tokens.add('peak_later');
  if (includesAny(normalized, ['earlier peak', 'peak earlier', 'quicker wind-down'])) tokens.add('peak_earlier');
  if (includesAny(normalized, ['handoff', 'transfer', 'travel', 'friction'])) tokens.add('handoff');
  if (includesAny(normalized, ['walking', 'stroll'])) tokens.add('walking');
  return tokens;
}

function isSemanticallyRedundant(left: string, right: string): boolean {
  const leftNormalized = normalizeNoticeLine(left).toLowerCase();
  const rightNormalized = normalizeNoticeLine(right).toLowerCase();
  if (!leftNormalized || !rightNormalized) return true;
  if (leftNormalized === rightNormalized) return true;
  const leftTokens = semanticTokenSet(leftNormalized);
  const rightTokens = semanticTokenSet(rightNormalized);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function mapPrimaryLineFromConstraint(constraintNote: string): string {
  const normalized = normalizeNoticeLine(constraintNote).toLowerCase();
  if (includesAny(normalized, ['fixes a hard constraint', 'hard constraint'])) {
    return 'Hard constraint fixed.';
  }
  if (includesAny(normalized, ['improves pacing constraints', 'pacing constraints'])) {
    return 'Cleaner taper at the end.';
  }
  if (includesAny(normalized, ['moves the peak later', 'later peak', 'build longer'])) {
    return 'Smoother pacing.';
  }
  if (includesAny(normalized, ['smoother handoffs', 'less travel', 'transition friction', 'long transfers'])) {
    return 'Smoother handoffs.';
  }
  return 'Plan adjusted for smoother pacing.';
}

function mapPrimaryLineFromSuggestionNote(line: string): string {
  const normalized = normalizeNoticeLine(line).toLowerCase();
  if (includesAny(normalized, ['hard constraint'])) {
    return 'Hard constraint fixed.';
  }
  if (includesAny(normalized, ['improves pacing constraints', 'pacing constraints', 'cleaner taper'])) {
    return 'Cleaner taper at the end.';
  }
  if (includesAny(normalized, ['moves the peak later', 'later peak', 'build longer'])) {
    return 'Smoother pacing.';
  }
  if (includesAny(normalized, ['smoother handoffs', 'less travel', 'long transfers', 'transition friction', 'handoff', 'friction'])) {
    return 'Smoother handoffs.';
  }
  if (includesAny(normalized, ['pacing', 'taper', 'build', 'peak'])) {
    return 'Smoother pacing.';
  }
  return 'Plan adjusted for smoother pacing.';
}

function mapOptionalLineFromTilt(tiltNote: string): string | null {
  const normalized = normalizeNoticeLine(tiltNote).replace(/^director note:\s*/i, '');
  const lowered = normalized.toLowerCase();
  if (!normalized) return null;
  if (includesAny(lowered, ['less walking'])) {
    return 'Walking load eased while flow stays steady.';
  }
  if (includesAny(lowered, ['later peak', 'build longer toward a later peak'])) {
    return 'Build now leans toward a later peak.';
  }
  if (includesAny(lowered, ['earlier peak', 'quicker wind-down'])) {
    return 'Build now leans toward an earlier peak.';
  }
  if (includesAny(lowered, ['calmer', 'lower-pressure'])) {
    return 'Tone now feels calmer and lower-pressure.';
  }
  if (includesAny(lowered, ['livelier', 'stronger build'])) {
    return 'Tone now feels livelier with a stronger build.';
  }
  if (includesAny(lowered, ['longer stroll'])) {
    return 'Route keeps a longer stroll where flow benefits.';
  }
  return null;
}

function buildAppliedNoticeFromSuggestion(input: {
  suggestion: IdeaDateSuggestion;
  computedBaseline: IdeaDateComputedMetrics | null;
  vibeId: ReturnType<typeof parseIdeaDatePlanProfile>['vibeId'];
}): IdeaDateAppliedNotice {
  const constraintNote = normalizeNoticeLine(input.suggestion.meta?.constraintNarrativeNote);
  const primaryFromConstraint = constraintNote
    ? mapPrimaryLineFromConstraint(constraintNote)
    : null;
  const translated = input.computedBaseline
    ? translateSuggestion(
        input.suggestion,
        input.computedBaseline.violations,
        {
          intentScore: input.computedBaseline.intentScore,
          journeyScore: input.computedBaseline.journeyScore,
        },
        input.vibeId
      )
    : null;
  const translatedFirstLine = translated
    ? normalizeNoticeLine(translated.note.split(/\r?\n/)[0])
    : '';
  const primaryFromTranslation = translatedFirstLine
    ? mapPrimaryLineFromSuggestionNote(translatedFirstLine)
    : null;
  const primaryLine = primaryFromConstraint
    || primaryFromTranslation
    || 'Plan adjusted for smoother pacing.';

  const tiltNote = normalizeNoticeLine(input.suggestion.meta?.conciergeTiltNote);
  const optionalTiltLine = tiltNote ? mapOptionalLineFromTilt(tiltNote) : null;
  const secondLine = optionalTiltLine && !isSemanticallyRedundant(primaryLine, optionalTiltLine)
    ? optionalTiltLine
    : null;

  return {
    title: 'Locked in.',
    lines: dedupeNoticeLines([primaryLine, secondLine ?? '']),
    ts: Date.now(),
  };
}

function summarizeTravel(travel: IdeaDateTravelSummary): IdeaDateTravelSummaryLite {
  return {
    worstEdgeMin: travel.edges.reduce((max, edge) => Math.max(max, edge.minutes), 0),
    totalTravelMin: travel.totalMinutes,
    edgeCount: travel.edges.length,
  };
}

function clonePlanSnapshot(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan) as Plan;
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

async function buildFallbackSuggestion(
  plan: Plan,
  computed: IdeaDateComputedMetrics
): Promise<IdeaDateSuggestion | null> {
  const readPlaceId = (stop: Plan['stops'][number]): string | null => {
    const fromRef = stop.placeRef?.placeId?.trim();
    if (fromRef) return fromRef;
    const fromLite = stop.placeLite?.placeId?.trim();
    if (fromLite) return fromLite;
    return null;
  };
  const stops = plan.stops ?? [];
  if (stops.length < 2) return null;
  const target = stops[stops.length - 1];
  const donor = stops[stops.length - 2];
  const donorPlaceId = readPlaceId(donor);
  if (donorPlaceId) {
    const wouldDuplicateExistingPlace = stops.some(
      (stop) => stop.id !== target.id && readPlaceId(stop) === donorPlaceId
    );
    if (wouldDuplicateExistingPlace) return null;
  }
  const parsedProfile = IdeaDateStopProfileSchema.safeParse(target.ideaDate);
  if (!parsedProfile.success) return null;

  const patchOps: IdeaDateSuggestion['patchOps'] = [
    {
      op: 'replaceStop',
      stopId: target.id,
      newPlace: {
        name: donor.name,
        placeRef: donor.placeRef,
        placeLite: donor.placeLite,
      },
      newIdeaDateProfile: parsedProfile.data,
    },
  ];
  const previewPlan = applyIdeaDateOps(plan, patchOps);
  const preview = await recomputeIdeaDateLive(previewPlan);
  const delta = preview.computed.journeyScore - computed.journeyScore;
  if (delta <= 0) return null;

  return {
    id: `idea-date-dev-fallback-${target.id}-${donor.id}`,
    kind: 'replacement',
    reasonCode: 'dev_fallback_friction_relief',
    patchOps,
    newPlace: {
      name: donor.name,
      placeRef: donor.placeRef,
      placeLite: donor.placeLite,
    },
    meta: {
      originalPlaceName: target.name?.trim() || undefined,
    },
    impact: {
      before: computed.journeyScore,
      after: preview.computed.journeyScore,
      delta,
      before100: computed.journeyScore100,
      after100: preview.computed.journeyScore100,
    },
    preview: true,
    subjectStopId: target.id,
  };
}

export function useIdeaDateLens(planId: string) {
  const [baselinePlan, setBaselinePlan] = useState<Plan | null>(null);
  const [baselineComputed, setBaselineComputed] = useState<IdeaDateComputedMetrics | null>(null);
  const [baselineArcModel, setBaselineArcModel] = useState<IdeaDateArcModel | null>(null);
  const [baselineTravelSummary, setBaselineTravelSummary] = useState<IdeaDateTravelSummaryLite | null>(null);
  const [plan, setLivePlan] = useState<Plan | null>(null);
  const [previewPlan, setPreviewPlan] = useState<Plan | null>(null);
  const [previewSuggestionId, setPreviewSuggestionId] = useState<string | null>(null);
  const [computed, setComputed] = useState<IdeaDateComputedMetrics | null>(null);
  const [arcModel, setArcModel] = useState<IdeaDateArcModel | null>(null);
  const [activeTravelSummary, setActiveTravelSummary] = useState<IdeaDateTravelSummaryLite | null>(null);
  const [suggestionPack, setSuggestionPack] = useState<IdeaDateSuggestionPack | null>(null);
  const [emptySuggestions, setEmptySuggestions] = useState(false);
  const [emptySuggestionsMessage, setEmptySuggestionsMessage] = useState<string | null>(null);
  const [usedDevFallbackSuggestion, setUsedDevFallbackSuggestion] = useState(false);
  const [lastResolverUsed, setLastResolverUsed] = useState<ResolverUsed>('unknown');
  const [lastResolverCandidateCount, setLastResolverCandidateCount] = useState(0);
  const [lastResolverError, setLastResolverError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refineNotice, setRefineNotice] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<IdeaDateAppliedNotice | null>(null);
  const [holdAppliedNotice, setHoldAppliedNotice] = useState(false);
  const [canUndoLastApply, setCanUndoLastApply] = useState(false);
  const [prefTilt, setPrefTiltState] = useState<IdeaDatePrefTilt>(IDEA_DATE_DEFAULT_PREF_TILT);
  const [mode, setModeState] = useState<IdeaDateMode>(IDEA_DATE_DEFAULT_MODE);
  const prefTiltRef = useRef<IdeaDatePrefTilt>(prefTilt);
  const modeRef = useRef<IdeaDateMode>(mode);
  const refineInFlightRef = useRef(false);
  const appliedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPlanRef = useRef<Plan | null>(null);

  useEffect(() => {
    prefTiltRef.current = prefTilt;
  }, [prefTilt]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const clearLastAppliedSnapshot = useCallback(() => {
    previousPlanRef.current = null;
    setCanUndoLastApply(false);
  }, []);

  const clearAppliedNotice = useCallback((options?: { clearUndo?: boolean }) => {
    if (appliedNoticeTimerRef.current) {
      clearTimeout(appliedNoticeTimerRef.current);
      appliedNoticeTimerRef.current = null;
    }
    setAppliedNotice(null);
    if (options?.clearUndo ?? true) {
      clearLastAppliedSnapshot();
    }
  }, [clearLastAppliedSnapshot]);

  const scheduleAppliedNoticeAutoClear = useCallback(() => {
    if (appliedNoticeTimerRef.current) {
      clearTimeout(appliedNoticeTimerRef.current);
      appliedNoticeTimerRef.current = null;
    }
    appliedNoticeTimerRef.current = setTimeout(() => {
      setAppliedNotice(null);
      clearLastAppliedSnapshot();
      appliedNoticeTimerRef.current = null;
    }, 2500);
  }, [clearLastAppliedSnapshot]);

  const publishAppliedNotice = useCallback((notice: IdeaDateAppliedNotice) => {
    if (appliedNoticeTimerRef.current) {
      clearTimeout(appliedNoticeTimerRef.current);
      appliedNoticeTimerRef.current = null;
    }
    setAppliedNotice(notice);
    if (!(isDevelopment && holdAppliedNotice)) {
      scheduleAppliedNoticeAutoClear();
    }
  }, [holdAppliedNotice, scheduleAppliedNoticeAutoClear]);

  useEffect(() => {
    if (!isDevelopment || !appliedNotice) return;
    if (holdAppliedNotice) {
      if (appliedNoticeTimerRef.current) {
        clearTimeout(appliedNoticeTimerRef.current);
        appliedNoticeTimerRef.current = null;
      }
      return;
    }
    if (!appliedNoticeTimerRef.current) {
      scheduleAppliedNoticeAutoClear();
    }
  }, [appliedNotice, holdAppliedNotice, scheduleAppliedNoticeAutoClear]);

  useEffect(() => () => {
    if (appliedNoticeTimerRef.current) {
      clearTimeout(appliedNoticeTimerRef.current);
      appliedNoticeTimerRef.current = null;
    }
  }, []);

  const recomputeCommittedPlan = useCallback(
    async (nextPlan: Plan, options?: { clearSuggestions?: boolean; preserveUndoSnapshot?: boolean }) => {
      setIsBusy(true);
      try {
        if (!(options?.preserveUndoSnapshot ?? false)) {
          clearLastAppliedSnapshot();
        }
        const live = await recomputeIdeaDateLive(nextPlan);
        const nextPrefTilt = readPlanPrefTiltMeta(live.plan);
        const nextMode = readPlanModeMeta(live.plan);
        setPlan(planId, live.plan);
        setBaselinePlan(live.plan);
        setBaselineComputed(live.computed);
        setBaselineArcModel(live.arcModel);
        setBaselineTravelSummary(summarizeTravel(live.travel));
        setLivePlan(live.plan);
        setComputed(live.computed);
        setArcModel(live.arcModel);
        setActiveTravelSummary(summarizeTravel(live.travel));
        setPrefTiltState(nextPrefTilt);
        prefTiltRef.current = nextPrefTilt;
        setModeState(nextMode);
        modeRef.current = nextMode;
        setPreviewPlan(null);
        setPreviewSuggestionId(null);
        if (options?.clearSuggestions ?? true) {
          setSuggestionPack(null);
          setEmptySuggestions(false);
          setEmptySuggestionsMessage(null);
          setUsedDevFallbackSuggestion(false);
        }
      } finally {
        setIsBusy(false);
      }
    },
    [clearLastAppliedSnapshot, planId]
  );

  const applyMutation = useCallback(
    async (mutator: (current: Plan) => Plan) => {
      if (!baselinePlan) return;
      const nextPlan = mutator(baselinePlan);
      await recomputeCommittedPlan(nextPlan);
    },
    [baselinePlan, recomputeCommittedPlan]
  );

  const seedMessy = useCallback(async () => {
    const seeded = buildIdeaDateSeedPlan({ id: planId, title: 'Idea-Date: Surprise Me' });
    await recomputeCommittedPlan(seeded);
  }, [planId, recomputeCommittedPlan]);

  const seedClean = useCallback(async () => {
    const seeded = buildIdeaDateSeedPlan({
      id: planId,
      title: 'Idea-Date: Clean QA Seed',
      seed: IDEA_DATE_CLEAN_SEED,
    });
    await recomputeCommittedPlan(seeded);
  }, [planId, recomputeCommittedPlan]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      const stored = getPlan(planId);
      if (!stored) {
        if (!cancelled) {
          setError('Plan not found.');
          setIsLoading(false);
        }
        return;
      }
      try {
        const live = await recomputeIdeaDateLive(stored);
        if (cancelled) return;
        const seedTelemetry = readSeedResolverTelemetry(live.plan);
        const nextPrefTilt = readPlanPrefTiltMeta(live.plan);
        const nextMode = readPlanModeMeta(live.plan);
        setBaselinePlan(live.plan);
        setBaselineComputed(live.computed);
        setBaselineArcModel(live.arcModel);
        setBaselineTravelSummary(summarizeTravel(live.travel));
        setLivePlan(live.plan);
        setComputed(live.computed);
        setArcModel(live.arcModel);
        setActiveTravelSummary(summarizeTravel(live.travel));
        setPrefTiltState(nextPrefTilt);
        prefTiltRef.current = nextPrefTilt;
        setModeState(nextMode);
        modeRef.current = nextMode;
        if (seedTelemetry) {
          setLastResolverUsed(seedTelemetry.used);
          setLastResolverCandidateCount(seedTelemetry.count);
          setLastResolverError(seedTelemetry.error);
        }
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed to load plan.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const moveUp = useCallback(
    async (stopId: string) => {
      await applyMutation((current) => {
        const index = current.stops.findIndex((stop) => stop.id === stopId);
        if (index <= 0) return current;
        const nextStops = [...current.stops];
        const [item] = nextStops.splice(index, 1);
        nextStops.splice(index - 1, 0, item);
        return { ...current, stops: nextStops };
      });
    },
    [applyMutation]
  );

  const moveDown = useCallback(
    async (stopId: string) => {
      await applyMutation((current) => {
        const index = current.stops.findIndex((stop) => stop.id === stopId);
        if (index < 0 || index >= current.stops.length - 1) return current;
        const nextStops = [...current.stops];
        const [item] = nextStops.splice(index, 1);
        nextStops.splice(index + 1, 0, item);
        return { ...current, stops: nextStops };
      });
    },
    [applyMutation]
  );

  const removeStop = useCallback(
    async (stopId: string) => {
      await applyMutation((current) => ({
        ...current,
        stops: current.stops.filter((stop) => stop.id !== stopId),
      }));
    },
    [applyMutation]
  );

  const setRole = useCallback(
    async (stopId: string, role: IdeaDateRole) => {
      await applyMutation((current) => ({
        ...current,
        stops: current.stops.map((stop) => {
          if (stop.id !== stopId) return stop;
          const raw = isRecord(stop.ideaDate) ? stop.ideaDate : {};
          return {
            ...stop,
            ideaDate: { ...raw, role },
          };
        }),
      }));
    },
    [applyMutation]
  );

  const setOverrides = useCallback(
    async (stopId: string, partialOverrides: Partial<IdeaDateOverrides>) => {
      await applyMutation((current) => ({
        ...current,
        stops: current.stops.map((stop) => {
          if (stop.id !== stopId) return stop;
          const raw = isRecord(stop.ideaDate) ? stop.ideaDate : {};
          const role = readRole(stop);
          const existingOverrides = readOverrides(stop);
          return {
            ...stop,
            ideaDate: {
              ...raw,
              role,
              overrides: {
                ...existingOverrides,
                ...partialOverrides,
              },
            },
          };
        }),
      }));
    },
    [applyMutation]
  );

  const persistPrefTilt = useCallback(
    (nextPrefTiltInput: Partial<IdeaDatePrefTilt>) => {
      const nextPrefTilt = normalizeIdeaDatePrefTilt(nextPrefTiltInput);
      if (prefTiltEquals(prefTiltRef.current, nextPrefTilt)) return;
      setPrefTiltState(nextPrefTilt);
      prefTiltRef.current = nextPrefTilt;
      void applyMutation((current) => withPlanMetaPrefTilt(current, nextPrefTilt));
    },
    [applyMutation]
  );

  const setPrefTilt = useCallback((partial: Partial<IdeaDatePrefTilt>) => {
    const current = prefTiltRef.current;
    persistPrefTilt({
      vibe: partial.vibe ?? current.vibe,
      walking: partial.walking ?? current.walking,
      peak: partial.peak ?? current.peak,
    });
  }, [persistPrefTilt]);

  const setPrefTiltVibe = useCallback((nextVibe: IdeaDatePrefTilt['vibe']) => {
    const current = prefTiltRef.current;
    persistPrefTilt({ ...current, vibe: nextVibe });
  }, [persistPrefTilt]);

  const setPrefTiltWalking = useCallback((nextWalking: IdeaDatePrefTilt['walking']) => {
    const current = prefTiltRef.current;
    persistPrefTilt({ ...current, walking: nextWalking });
  }, [persistPrefTilt]);

  const setPrefTiltPeak = useCallback((nextPeak: IdeaDatePrefTilt['peak']) => {
    const current = prefTiltRef.current;
    persistPrefTilt({ ...current, peak: nextPeak });
  }, [persistPrefTilt]);

  const setMode = useCallback((nextModeInput: IdeaDateMode) => {
    const nextMode = normalizeIdeaDateMode(nextModeInput);
    if (modeRef.current === nextMode) return;
    setModeState(nextMode);
    modeRef.current = nextMode;
    void applyMutation((current) => withPlanMetaMode(current, nextMode));
  }, [applyMutation]);

  const applyModeDefaults = useCallback(() => {
    const activeMode = modeRef.current;
    const policy = getIdeaDateModePolicy(activeMode);
    const nextPrefTilt = policy.defaultPrefTilt;
    setPrefTiltState(nextPrefTilt);
    prefTiltRef.current = nextPrefTilt;
    void applyMutation((current) => withPlanModeDefaultsApplied(current, activeMode));
  }, [applyMutation]);

  const refine = useCallback(async () => {
    if (refineInFlightRef.current) {
      setRefineNotice('Refine already running.');
      return;
    }
    const sourcePlan = plan ?? baselinePlan;
    if (!sourcePlan) {
      setRefineNotice('Refine unavailable: missing live plan state.');
      return;
    }
    refineInFlightRef.current = true;
    setRefineNotice(null);
    setIsBusy(true);
    setLastResolverUsed('unknown');
    setLastResolverCandidateCount(0);
    setLastResolverError(null);
    try {
      const live = await recomputeIdeaDateLive(sourcePlan);
      const planPrefTilt = readPlanPrefTiltMeta(live.plan);
      const planMode = readPlanModeMeta(live.plan);
      const { pack, telemetry } = await generateIdeaDateSuggestionPackWithTelemetry(live.plan, {
        prefTilt: planPrefTilt,
        mode: planMode,
      });
      let suggestions = pack.suggestions;
      let usedDevFallback = false;
      if (suggestions.length === 0 && debug) {
        const fallback = await buildFallbackSuggestion(pack.plan, live.computed);
        if (fallback) {
          suggestions = [fallback];
          usedDevFallback = true;
        }
      }
      const finalizedSuggestions = dedupeIdeaDateSuggestionsBySemanticSignature(suggestions, pack.plan).slice(0, 3);

      const nextPack: IdeaDateSuggestionPack = {
        ...pack,
        suggestions: finalizedSuggestions,
      };

      const shouldShowEmptySuggestions = !debug && nextPack.suggestions.length === 0;

      setPlan(planId, pack.plan);
      setBaselinePlan(pack.plan);
      setBaselineComputed(pack.computed);
      setBaselineArcModel(pack.arcModel);
      setBaselineTravelSummary(summarizeTravel(pack.travel));
      setLivePlan(pack.plan);
      setComputed(pack.computed);
      setArcModel(pack.arcModel);
      setActiveTravelSummary(summarizeTravel(pack.travel));
      setPreviewPlan(null);
      setPreviewSuggestionId(null);
      setSuggestionPack(nextPack);
      setUsedDevFallbackSuggestion(usedDevFallback);
      setEmptySuggestions(shouldShowEmptySuggestions);
      setEmptySuggestionsMessage(
        shouldShowEmptySuggestions ? "You're in great shape. This plan already flows well." : null
      );
      setLastResolverUsed(telemetry.used);
      setLastResolverCandidateCount(telemetry.count);
      setLastResolverError(telemetry.error);
      if (debug && nextPack.suggestions.length === 0) {
        const passUsed = nextPack.debugRefineStats?.debugPassUsed ?? 'primary';
        const discardSummary = formatRefineDiscardSummary(nextPack.debugRefineStats);
        const passPrefix = passUsed === 'repair'
          ? 'Repair-mode found no viable suggestions.'
          : passUsed === 'reorder_repair'
            ? 'Reorder-repair found no viable suggestions.'
            : 'No viable suggestions.';
        if (discardSummary) {
          setRefineNotice(`${passPrefix} Discards: ${discardSummary}`);
        } else {
          setRefineNotice(`${passPrefix} Discards: none recorded.`);
        }
      } else {
        setRefineNotice(null);
      }
    } catch (nextError) {
      setLastResolverUsed('unknown');
      setLastResolverCandidateCount(0);
      const nextMessage = sanitizeTelemetryError(nextError);
      setLastResolverError(nextMessage);
      setRefineNotice(`Refine failed: ${nextMessage}`);
    } finally {
      refineInFlightRef.current = false;
      setIsBusy(false);
    }
  }, [baselinePlan, plan, planId]);

  const findSuggestion = useCallback(
    (suggestionId: string): IdeaDateSuggestion | null => {
      if (!suggestionPack) return null;
      return suggestionPack.suggestions.find((suggestion) => suggestion.id === suggestionId) ?? null;
    },
    [suggestionPack]
  );

  const previewSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!baselinePlan) return;
      const suggestion = findSuggestion(suggestionId);
      if (!suggestion) return;
      setIsBusy(true);
      try {
        const nextPlan = applyIdeaDateOps(baselinePlan, suggestion.patchOps);
        const live = await recomputeIdeaDateLive(nextPlan);
        setPreviewPlan(live.plan);
        setPreviewSuggestionId(suggestion.id);
        setLivePlan(live.plan);
        setComputed(live.computed);
        setArcModel(live.arcModel);
        setActiveTravelSummary(summarizeTravel(live.travel));
      } finally {
        setIsBusy(false);
      }
    },
    [baselinePlan, findSuggestion]
  );

  const undoPreview = useCallback(() => {
    if (!baselinePlan || !baselineComputed || !baselineArcModel) return;
    setPreviewPlan(null);
    setPreviewSuggestionId(null);
    setLivePlan(baselinePlan);
    setComputed(baselineComputed);
    setArcModel(baselineArcModel);
    setActiveTravelSummary(baselineTravelSummary);
  }, [baselineArcModel, baselineComputed, baselinePlan, baselineTravelSummary]);

  const applySuggestion = useCallback(
    async (suggestionId: string) => {
      if (!baselinePlan) return;
      const suggestion = findSuggestion(suggestionId);
      if (!suggestion) return;
      const vibeId = parseIdeaDatePlanProfile(baselinePlan.meta?.ideaDate).vibeId;
      const nextNotice = buildAppliedNoticeFromSuggestion({
        suggestion,
        computedBaseline: baselineComputed,
        vibeId,
      });
      previousPlanRef.current = clonePlanSnapshot(baselinePlan);
      setCanUndoLastApply(true);
      const nextPlan = applyIdeaDateOps(baselinePlan, suggestion.patchOps);
      try {
        await recomputeCommittedPlan(nextPlan, { preserveUndoSnapshot: true });
        publishAppliedNotice(nextNotice);
      } catch (nextError) {
        clearLastAppliedSnapshot();
        throw nextError;
      }
    },
    [
      baselineComputed,
      baselinePlan,
      clearLastAppliedSnapshot,
      findSuggestion,
      publishAppliedNotice,
      recomputeCommittedPlan,
    ]
  );

  const undoLastApply = useCallback(async () => {
    const previousPlan = previousPlanRef.current;
    if (!previousPlan) return;
    const snapshot = clonePlanSnapshot(previousPlan);
    clearAppliedNotice();
    await recomputeCommittedPlan(snapshot);
  }, [clearAppliedNotice, recomputeCommittedPlan]);

  const makeMessier = useCallback(async () => {
    if (!debug) return;
    await applyMutation((current) => {
      if (current.stops.length < 3) return current;
      const nextStops = [...current.stops];
      const [tail] = nextStops.splice(nextStops.length - 1, 1);
      nextStops.splice(1, 0, tail);
      const tailIndex = nextStops.length - 1;
      const next = nextStops.map((stop, index) => {
        if (index !== tailIndex) return stop;
        const raw = isRecord(stop.ideaDate) ? stop.ideaDate : {};
        const existingOverrides = readOverrides(stop);
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
      return { ...current, stops: next };
    });
  }, [applyMutation]);

  const vibeId = useMemo(() => {
    if (!baselinePlan) return 'first_date_low_pressure';
    return parseIdeaDatePlanProfile(baselinePlan.meta?.ideaDate).vibeId;
  }, [baselinePlan]);

  const modePolicy = useMemo(() => getIdeaDateModePolicy(mode), [mode]);

  return {
    baselinePlan,
    plan,
    previewPlan,
    previewSuggestionId,
    computedBaseline: baselineComputed,
    computedActive: computed,
    baselineTravelSummary,
    activeTravelSummary,
    computed,
    arcModel,
    suggestionPack,
    emptySuggestions,
    emptySuggestionsMessage,
    usedDevFallbackSuggestion,
    lastResolverUsed,
    lastResolverCandidateCount,
    lastResolverError,
    refineNotice,
    appliedNotice,
    holdAppliedNotice,
    canUndoLastApply,
    mode,
    modePolicy,
    prefTilt,
    isLoading,
    isBusy,
    error,
    debug,
    vibeId,
    seedMessy,
    seedClean,
    makeMessier,
    moveUp,
    moveDown,
    removeStop,
    setRole,
    setOverrides,
    setPrefTilt,
    setPrefTiltVibe,
    setPrefTiltWalking,
    setPrefTiltPeak,
    setMode,
    applyModeDefaults,
    refine,
    previewSuggestion,
    undoPreview,
    applySuggestion,
    undoLastApply,
    clearAppliedNotice,
    setHoldAppliedNotice,
  };
}
