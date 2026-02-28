'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translateFinalSummary, translateSuggestion } from '@/lib/engine/idea-date';
import { useIdeaDateLens, type IdeaDatePrefTilt } from '@/lib/idea-date/useIdeaDateLens';
import { IDEA_DATE_MODE_OPTIONS, type IdeaDateMode } from '@/lib/idea-date/modePolicy';
import Arc from './components/Arc';
import ConfirmModal from './components/ConfirmModal';
import StopDetails from './components/StopDetails';

const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
const showOperatorTelemetry = process.env.NODE_ENV !== 'production';
const googleResolverEnabled = process.env.NEXT_PUBLIC_IDEA_DATE_GOOGLE_RESOLVER === '1';
const localResolverEnabled = process.env.NEXT_PUBLIC_IDEA_DATE_REAL_RESOLVER === '1';

type IdeaDateLensClientProps = {
  planId: string;
};

type ComputedLike = {
  journeyScore100: number;
  journeyScore: number;
  intentScore: number;
  fatiguePenalty: number;
  frictionPenalty: number;
  violations: Array<{ type: string; severity: 'info' | 'warn' | 'critical' }>;
};

type PreviewComputedStatus = {
  fatiguePenalty: number;
  frictionPenalty: number;
  constraintHardCount: number;
  constraintSoftCount: number;
  violations: Array<{ type: string }>;
};

type PreviewSuggestionLike = {
  meta?: {
    structuralNarrative?: string;
    constraintNarrativeNote?: string;
    constraintDelta?: {
      deltas?: {
        hardDelta?: number;
        softDelta?: number;
      };
    };
  };
};

type PreviewImpactContrast = {
  beforeLines: string[];
  afterLines: string[];
};

type ResolverUsed = 'google' | 'local' | 'mock' | 'unknown';

type SeedTelemetry = {
  used: ResolverUsed;
  count: number;
  error: string | null;
  requestId: string | null;
};

type PingTelemetry = {
  requestId: string | null;
  candidateNames: string[];
  route: string | null;
  cacheHit: boolean | null;
};

type PrefTiltValue = IdeaDatePrefTilt['vibe'];

type TuningOption = {
  label: string;
  value: PrefTiltValue;
};

type TuningSegmentedControlProps = {
  label: string;
  value: PrefTiltValue;
  options: readonly TuningOption[];
  onChange: (next: PrefTiltValue) => void;
};

const VIBE_TUNING_OPTIONS: readonly TuningOption[] = [
  { label: 'Chill', value: -1 },
  { label: 'Neutral', value: 0 },
  { label: 'Lively', value: 1 },
];

const WALKING_TUNING_OPTIONS: readonly TuningOption[] = [
  { label: 'Less', value: -1 },
  { label: 'Neutral', value: 0 },
  { label: 'More ok', value: 1 },
];

const PEAK_TUNING_OPTIONS: readonly TuningOption[] = [
  { label: 'Earlier', value: -1 },
  { label: 'Neutral', value: 0 },
  { label: 'Later', value: 1 },
];

const MODE_OPTIONS: readonly IdeaDateMode[] = IDEA_DATE_MODE_OPTIONS;

const REFINE_DISCARD_REASON_ORDER = [
  'duplicate_placeId',
  'invariant_violation',
  'increases_hard_constraints',
  'no_arc_improvement',
  'worsens_journeyScore',
  'increases_violations',
  'role_mismatch',
  'missing_stop_profile',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResolverUsed(value: unknown): value is ResolverUsed {
  return value === 'google' || value === 'local' || value === 'mock' || value === 'unknown';
}

function readSeedTelemetry(plan: { meta?: unknown } | null): SeedTelemetry | null {
  if (!plan || !isRecord(plan.meta)) return null;
  const ideaDate = isRecord(plan.meta.ideaDate) ? plan.meta.ideaDate : null;
  if (!ideaDate || !isRecord(ideaDate.seedResolverTelemetry)) return null;
  const raw = ideaDate.seedResolverTelemetry;
  return {
    used: isResolverUsed(raw.used) ? raw.used : 'unknown',
    count: typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count)) : 0,
    error: typeof raw.error === 'string' && raw.error.trim().length > 0 ? raw.error.trim() : null,
    requestId:
      typeof raw.requestId === 'string' && raw.requestId.trim().length > 0 ? raw.requestId.trim() : null,
  };
}

function readRole(stop: { role: string; ideaDate?: unknown }): 'start' | 'main' | 'windDown' | 'flex' {
  const rawRole = isRecord(stop.ideaDate) ? stop.ideaDate.role : null;
  if (rawRole === 'start' || rawRole === 'main' || rawRole === 'windDown' || rawRole === 'flex') {
    return rawRole;
  }
  if (stop.role === 'anchor') return 'start';
  if (stop.role === 'support') return 'main';
  return 'flex';
}

function buildWhyLines(computed: ComputedLike): string[] {
  if (computed.violations.length === 0 && computed.journeyScore100 >= 75) {
    return [
      'Balanced pacing and low transition friction.',
      'Good intent match for the current vibe.',
    ];
  }

  const messageByType: Record<string, string> = {
    friction_high: 'High friction: long transitions between stops.',
    travel_edge_high: 'High friction: one handoff is too long.',
    no_taper: "Arc issue: energy doesn't taper at the end.",
    double_peak: 'Arc issue: pacing has multiple peaks.',
    fatigue_high: 'Arc issue: current pacing may feel draining.',
    intent_low: "Intent mismatch: stops don't match the vibe strongly.",
  };
  const severityRank = { critical: 3, warn: 2, info: 1 } as const;
  const typeRank: Record<string, number> = {
    friction_high: 1,
    travel_edge_high: 2,
    fatigue_high: 3,
    no_taper: 4,
    double_peak: 5,
    intent_low: 6,
  };

  const fromViolations = [...computed.violations]
    .sort((a, b) => {
      const severityDelta = severityRank[b.severity] - severityRank[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return (typeRank[a.type] ?? 99) - (typeRank[b.type] ?? 99);
    })
    .map((violation) => messageByType[violation.type])
    .filter((message): message is string => Boolean(message));

  const deduped = [...new Set(fromViolations)];
  if (deduped.length >= 2) return deduped.slice(0, 2);

  const inferred: string[] = [];
  if (computed.frictionPenalty >= 0.35) {
    inferred.push('High friction: long transitions between stops.');
  }
  if (computed.fatiguePenalty >= 0.45) {
    inferred.push("Arc issue: energy doesn't taper at the end.");
  }
  if (computed.intentScore < 0.6) {
    inferred.push("Intent mismatch: stops don't match the vibe strongly.");
  }
  if (inferred.length === 0) {
    inferred.push('Balanced pacing and low transition friction.');
  }

  return [...new Set([...deduped, ...inferred])].slice(0, 2);
}

function getScoreBandLabel(score: number): string {
  if (score >= 80) return 'Excellent flow';
  if (score >= 60) return 'Solid - can improve';
  return 'Rough draft';
}

function getAssistantStatusLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Solid';
  return 'Rough draft';
}

function toHumanWhyLine(line: string): string {
  if (line.startsWith('High friction:')) {
    return line.replace('High friction:', 'Long transfer:');
  }
  if (line.startsWith('Arc issue:')) {
    return line.replace('Arc issue:', 'Pacing:');
  }
  if (line.startsWith('Intent mismatch:')) {
    return line.replace('Intent mismatch:', 'Vibe mismatch:');
  }
  return line;
}

function truncateSingleLine(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1))}...`;
}

function toNarrativeLines(note: string, maxLines = 2): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  const lines = note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    deduped.push(line);
    if (deduped.length >= maxLines) break;
  }
  return deduped;
}

function includesAnyTerm(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function dedupeLimited(lines: string[], maxLines: number): string[] {
  const deduped: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || deduped.includes(line)) continue;
    deduped.push(line);
    if (deduped.length >= maxLines) break;
  }
  return deduped;
}

function buildPreviewImpactContrast(input: {
  baseline: PreviewComputedStatus;
  active: PreviewComputedStatus;
  suggestion: PreviewSuggestionLike | null;
  narrativeLines: string[];
}): PreviewImpactContrast {
  const maxLines = 2;
  const beforePairs: string[] = [];
  const afterPairs: string[] = [];
  const seenPairs = new Set<string>();
  const pushPair = (beforeLine: string, afterLine: string) => {
    if (beforePairs.length >= maxLines || afterPairs.length >= maxLines) return;
    const normalizedBefore = beforeLine.trim();
    const normalizedAfter = afterLine.trim();
    if (!normalizedBefore || !normalizedAfter) return;
    const key = `${normalizedBefore}||${normalizedAfter}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    beforePairs.push(normalizedBefore);
    afterPairs.push(normalizedAfter);
  };

  const hardDelta = input.suggestion?.meta?.constraintDelta?.deltas?.hardDelta ?? 0;
  const softDelta = input.suggestion?.meta?.constraintDelta?.deltas?.softDelta ?? 0;
  const baselineHasHard = input.baseline.constraintHardCount > 0;
  const activeHasHard = input.active.constraintHardCount > 0;
  const baselineHasNoTaper = input.baseline.violations.some((violation) => violation.type === 'no_taper');
  const activeHasNoTaper = input.active.violations.some((violation) => violation.type === 'no_taper');
  const combinedNarrative = [
    ...input.narrativeLines,
    input.suggestion?.meta?.structuralNarrative ?? '',
    input.suggestion?.meta?.constraintNarrativeNote ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const hardFixed = hardDelta < 0 || (baselineHasHard && !activeHasHard);
  if (hardFixed) {
    pushPair('Hard constraint in the route', 'Hard constraint fixed');
  }

  const softImproved = softDelta < 0
    || (input.baseline.constraintSoftCount > input.active.constraintSoftCount)
    || (baselineHasNoTaper && !activeHasNoTaper);
  if (softImproved) {
    pushPair(
      baselineHasNoTaper ? "Ending doesn't taper cleanly" : 'Pacing feels uneven',
      baselineHasNoTaper ? 'Cleaner taper at the end' : 'Smoother pacing'
    );
  }

  const frictionImproved = input.active.frictionPenalty < input.baseline.frictionPenalty
    || includesAnyTerm(combinedNarrative, ['friction', 'handoff', 'transfer', 'long transfers']);
  if (frictionImproved) {
    pushPair('One handoff feels too long', 'Smoother handoffs');
  }

  const arcImproved = input.active.fatiguePenalty < input.baseline.fatiguePenalty
    || includesAnyTerm(combinedNarrative, ['peak', 'taper', 'build', 'pacing']);
  if (arcImproved) {
    pushPair('Pacing feels draining', 'Smoother pacing');
  }

  if (beforePairs.length === 0 || afterPairs.length === 0) {
    pushPair('Flow feels uneven', 'Flow feels steadier');
  }

  return {
    beforeLines: dedupeLimited(beforePairs, maxLines),
    afterLines: dedupeLimited(afterPairs, maxLines),
  };
}

function formatRefineDiscardSummary(
  stats:
    | {
        discardCounts: Record<string, number>;
      }
    | null
    | undefined
): string {
  if (!stats) return 'none';
  const entries = REFINE_DISCARD_REASON_ORDER
    .map((reason) => ({ reason, count: stats.discardCounts[reason] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.reason}=${entry.count}`);
  if (entries.length === 0) return 'none';
  return entries.join(', ');
}

function formatDiscardCountsSummary(discardCounts: Record<string, number> | null | undefined): string {
  if (!discardCounts) return 'none';
  const entries = REFINE_DISCARD_REASON_ORDER
    .map((reason) => ({ reason, count: discardCounts[reason] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.reason}=${entry.count}`);
  if (entries.length === 0) return 'none';
  return entries.join(', ');
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      setPrefersReducedMotion(media.matches);
    };
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return prefersReducedMotion;
}

function TuningSegmentedControl({ label, value, options, onChange }: TuningSegmentedControlProps) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-gray-300">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={`${label}-${option.value}`}
              type="button"
              onClick={() => onChange(option.value)}
              className={selected
                ? 'rounded-md border border-sky-400 bg-sky-500/20 px-2 py-1 text-xs font-semibold text-sky-100'
                : 'rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-gray-200'}
              aria-pressed={selected}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function IdeaDateLensClient({ planId }: IdeaDateLensClientProps) {
  const lens = useIdeaDateLens(planId);
  const [detailsStopId, setDetailsStopId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBullets, setConfirmBullets] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPingingPlaces, setIsPingingPlaces] = useState(false);
  const [pingResults, setPingResults] = useState<Array<{ name: string; placeId: string }>>([]);
  const [pingError, setPingError] = useState<string | null>(null);
  const [lastPingTelemetry, setLastPingTelemetry] = useState<PingTelemetry | null>(null);
  const handlePingPlaces = useCallback(async () => {
    if (!debug) return;
    setIsPingingPlaces(true);
    setPingResults([]);
    setPingError(null);
    setLastPingTelemetry(null);
    try {
      const res = await fetch('/api/places/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lat: 37.7784,
          lng: -122.4231,
          radiusMeters: 1200,
          includedTypes: ['dessert_shop', 'bar'],
          keyword: 'dessert lounge bar',
          limit: 5,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        requestId?: string;
        _debug?: { route?: string; cacheHit?: boolean };
        results?: Array<{ placeId?: string; name?: string }>;
      };
      const requestId = typeof data.requestId === 'string' && data.requestId.trim().length > 0
        ? data.requestId.trim()
        : null;
      const debugRoute = typeof data._debug?.route === 'string' && data._debug.route.trim().length > 0
        ? data._debug.route.trim()
        : null;
      const cacheHit = typeof data._debug?.cacheHit === 'boolean' ? data._debug.cacheHit : null;
      const rows = Array.isArray(data.results)
        ? data.results
            .map((item) => ({
              name: item.name?.trim() ?? '',
              placeId: item.placeId?.trim() ?? '',
            }))
            .filter((item) => item.name.length > 0 && item.placeId.length > 0)
            .slice(0, 3)
        : [];
      setLastPingTelemetry({
        requestId,
        candidateNames: rows.map((item) => item.name),
        route: debugRoute,
        cacheHit,
      });
      if (!res.ok) {
        setPingError(`HTTP ${res.status} while pinging /api/places/search`);
        return;
      }
      if (!data.ok) {
        setPingError(data.error ? truncateSingleLine(data.error) : 'ping_failed');
        return;
      }
      setPingResults(rows);
      if (rows.length === 0) {
        setPingError('No candidates returned.');
      }
    } catch (nextError) {
      setPingError(
        truncateSingleLine(nextError instanceof Error ? nextError.message : 'ping_exception')
      );
    } finally {
      setIsPingingPlaces(false);
    }
  }, []);
  const prefersReducedMotion = usePrefersReducedMotion();
  const scoreTarget = (lens.computedActive ?? lens.computed)?.journeyScore100 ?? 0;
  const [displayScore, setDisplayScore] = useState(scoreTarget);
  const scoreFrameRef = useRef<number | null>(null);
  const scoreCurrentRef = useRef(scoreTarget);
  const hasInitializedScoreRef = useRef(false);

  useEffect(() => {
    scoreCurrentRef.current = displayScore;
  }, [displayScore]);

  useEffect(() => {
    const hasComputed = Boolean(lens.computedActive ?? lens.computed);
    if (lens.isLoading || lens.error || !hasComputed) return;

    const target = scoreTarget;
    if (!hasInitializedScoreRef.current) {
      hasInitializedScoreRef.current = true;
      setDisplayScore(target);
      scoreCurrentRef.current = target;
      return;
    }

    if (scoreFrameRef.current !== null) {
      cancelAnimationFrame(scoreFrameRef.current);
      scoreFrameRef.current = null;
    }

    if (prefersReducedMotion || target === scoreCurrentRef.current) {
      setDisplayScore(target);
      scoreCurrentRef.current = target;
      return;
    }

    const startScore = scoreCurrentRef.current;
    const delta = target - startScore;
    const durationMs = 250;
    let startTime: number | null = null;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const nextScore = Math.round(startScore + delta * progress);
      setDisplayScore(nextScore);
      scoreCurrentRef.current = nextScore;
      if (progress < 1) {
        scoreFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      scoreFrameRef.current = null;
      setDisplayScore(target);
      scoreCurrentRef.current = target;
    };

    scoreFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (scoreFrameRef.current !== null) {
        cancelAnimationFrame(scoreFrameRef.current);
        scoreFrameRef.current = null;
      }
    };
  }, [lens.computed, lens.computedActive, lens.error, lens.isLoading, prefersReducedMotion, scoreTarget]);

  const activeStop = useMemo(() => {
    if (!lens.plan || !detailsStopId) return null;
    return lens.plan.stops.find((stop) => stop.id === detailsStopId) ?? null;
  }, [detailsStopId, lens.plan]);

  const suggestionStopContext = useMemo(() => {
    const sourcePlan = lens.baselinePlan ?? lens.plan;
    if (!sourcePlan) return { debug };
    const stopById: Record<string, { name?: string; role?: 'start' | 'main' | 'windDown' | 'flex' }> = {};
    for (const stop of sourcePlan.stops) {
      stopById[stop.id] = {
        name: stop.name,
        role: readRole(stop),
      };
    }
    return { stopById, debug };
  }, [lens.baselinePlan, lens.plan]);

  if (lens.isLoading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-md bg-slate-950 p-4 text-sm text-gray-300">
        Loading Idea-Date lens...
      </main>
    );
  }

  if (lens.error || !lens.plan || !lens.computed || !lens.arcModel) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-md bg-slate-950 p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-sm font-semibold text-white">Idea-Date plan unavailable</div>
          <p className="mt-1 text-sm text-gray-300">{lens.error ?? 'Missing plan state.'}</p>
          <button
            type="button"
            onClick={() => {
              void lens.seedMessy();
            }}
            className="mt-3 w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950"
          >
            Seed Messy Plan
          </button>
        </div>
      </main>
    );
  }

  const suggestions = lens.suggestionPack?.suggestions ?? [];
  const engineSuggestions = suggestions.filter(
    (suggestion) => !suggestion.id.startsWith('idea-date-dev-fallback-')
  );
  const suggestionsCount = engineSuggestions.length;
  const computedBaseline = lens.computedBaseline ?? lens.computed;
  const computedActive = lens.computedActive ?? lens.computed;
  const liveArcContributionByIndex = Array.isArray(computedActive.arcContributionByIndex)
    ? computedActive.arcContributionByIndex
    : [];
  const arcSeriesForChart =
    liveArcContributionByIndex.length === lens.plan.stops.length
      ? liveArcContributionByIndex
      : [];
  const violationsCount = computedActive.violations.length;
  const constraintHardCount = computedActive.constraintHardCount;
  const constraintSoftCount = computedActive.constraintSoftCount;
  const constraintMessages = computedActive.constraintViolations.map((violation) => violation.message);
  const uniqueConstraintMessages = Array.from(
    new Set(
      constraintMessages
        .filter(Boolean)
        .map((message) => message.trim())
        .filter(Boolean)
    )
  );
  const constraintHeadline = constraintHardCount > 0
    ? `Constraints: ${computedActive.constraintNarratives[0] ?? 'long transfer risk'}.`
    : null;
  const isPreviewing = Boolean(lens.previewSuggestionId);
  const isAnyPreviewing = isPreviewing;
  const whyLines = buildWhyLines(computedActive as ComputedLike);
  const scoreBandLabel = getScoreBandLabel(computedActive.journeyScore100);
  const assistantStatusLabel = getAssistantStatusLabel(displayScore);
  const baselineHasArcIssue = computedBaseline.violations.some(
    (violation) => violation.type === 'no_taper' || violation.type === 'double_peak'
  );
  const activeHasArcIssue = computedActive.violations.some(
    (violation) => violation.type === 'no_taper' || violation.type === 'double_peak'
  );
  const arcNarrativeLines = (() => {
    const narratives = computedActive.arcNarrativesByIndex ?? [];
    if (narratives.length === 0) return ['Arc pacing is stable across this route.'];
    const selected: string[] = [];
    const pushNarrative = (index: number | null) => {
      if (index == null) return;
      if (!Number.isInteger(index) || index < 0 || index >= narratives.length) return;
      const line = narratives[index]?.trim();
      if (!line || selected.includes(line)) return;
      selected.push(line);
    };
    pushNarrative(lens.arcModel?.peakIndexActual ?? null);
    pushNarrative(narratives.length - 1);
    for (const line of narratives) {
      const normalized = line.trim();
      if (!normalized || selected.includes(normalized)) continue;
      selected.push(normalized);
      if (selected.length >= 2) break;
    }
    return selected.slice(0, 2);
  })();
  const nextActionMessage =
    suggestionsCount > 0
      ? 'Next: Preview a suggestion, then Apply to see arc/score change.'
      : violationsCount > 0
        ? 'Next: Tap Refine to generate improvements.'
        : debug
          ? 'Next: Try Seed Messy to stress-test refine.'
          : 'Next: Try Refine to explore upgrades, or tweak a stop to see alternatives.';
  const activePreviewSuggestion = lens.previewSuggestionId
    ? suggestions.find((suggestion) => suggestion.id === lens.previewSuggestionId) ?? null
    : null;
  const previewTranslation = activePreviewSuggestion
    ? translateSuggestion(
        activePreviewSuggestion,
        computedActive.violations ?? [],
        {
          intentScore: computedActive.intentScore,
          journeyScore: computedActive.journeyScore,
        },
        lens.vibeId,
        suggestionStopContext
      )
    : null;
  const previewNarrativeLines = previewTranslation
    ? toNarrativeLines(previewTranslation.note, 2)
    : [];
  const previewImpactContrast = isPreviewing
    ? buildPreviewImpactContrast({
        baseline: {
          fatiguePenalty: computedBaseline.fatiguePenalty,
          frictionPenalty: computedBaseline.frictionPenalty,
          constraintHardCount: computedBaseline.constraintHardCount,
          constraintSoftCount: computedBaseline.constraintSoftCount,
          violations: computedBaseline.violations.map((violation) => ({ type: violation.type })),
        },
        active: {
          fatiguePenalty: computedActive.fatiguePenalty,
          frictionPenalty: computedActive.frictionPenalty,
          constraintHardCount: computedActive.constraintHardCount,
          constraintSoftCount: computedActive.constraintSoftCount,
          violations: computedActive.violations.map((violation) => ({ type: violation.type })),
        },
        suggestion: activePreviewSuggestion,
        narrativeLines: previewNarrativeLines,
      })
    : null;
  const assistantPreviewLine = (() => {
    if (!isPreviewing) return null;
    const hardDelta = activePreviewSuggestion?.meta?.constraintDelta?.deltas.hardDelta ?? 0;
    if (hardDelta < 0 || (computedBaseline.constraintHardCount > 0 && computedActive.constraintHardCount < computedBaseline.constraintHardCount)) {
      return 'Previewing a route with a hard constraint fix.';
    }
    if (baselineHasArcIssue && !activeHasArcIssue) return 'Previewing a cleaner taper at the end.';
    if (computedActive.frictionPenalty < computedBaseline.frictionPenalty) {
      return 'Previewing smoother handoffs.';
    }
    if (computedActive.violations.length < computedBaseline.violations.length) {
      return 'Previewing lower flow risk.';
    }
    return 'Previewing a different flow.';
  })();
  const assistantSubline = assistantPreviewLine ?? toHumanWhyLine(whyLines[0] ?? 'Flow is in a stable place.');
  const previewBannerText = (() => {
    if (!lens.previewSuggestionId) return null;
    if (!activePreviewSuggestion) return 'Previewing suggestion. This is not applied yet.';
    const translatedTitle = previewTranslation?.title.trim() ?? '';
    if (translatedTitle.length === 0) return 'Previewing suggestion. This is not applied yet.';
    return `Previewing: ${translatedTitle}`;
  })();
  const resolverErrorDisplay = lens.lastResolverError
    ? truncateSingleLine(lens.lastResolverError)
    : null;
  const topSuggestionDeltaArc = suggestions[0]?.arcImpact?.deltaTotal;
  const refineStats = lens.suggestionPack?.debugRefineStats;
  const topReplacementRoleQuery = suggestions.find((suggestion) => suggestion.kind === 'replacement')?.meta?.debugRoleQuery
    ?? refineStats?.debugRoleQuery
    ?? { templateUsed: 'generic' as const, typesCount: 4, keywordUsed: true, radiusMeters: 250 };
  const topReplacementDiversity = suggestions.find((suggestion) => suggestion.kind === 'replacement')?.meta?.debugDiversity
    ?? refineStats?.debugDiversity
    ?? null;
  const topReplacementFamilyCounts = topReplacementDiversity?.planFamilyCounts ?? refineStats?.debugPlanFamilyCounts ?? { other: 0 };
  const topReplacementFamilySummary = Object.entries(topReplacementFamilyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, count]) => `${family}=${count}`)
        .join(', ');
  const refinePassUsed = refineStats?.debugPassUsed ?? 'primary';
  const repairThresholds = refineStats?.debugRepairThresholds ?? null;
  const reorderRepairDebug = refineStats?.debugReorderRepair ?? null;
  const passBreakdown = refineStats?.debugPassBreakdown ?? null;
  const refineDiscardSummary = formatRefineDiscardSummary(refineStats);
  const primaryPassDiscardSummary = formatDiscardCountsSummary(passBreakdown?.primaryReplacement.discardCounts);
  const repairPassDiscardSummary = formatDiscardCountsSummary(passBreakdown?.repairReplacement.discardCounts);
  const refinePlanPrefTilt = refineStats?.debugPlanPrefTilt ?? null;
  const refineModeDefaultsPrefTilt = refineStats?.debugModeDefaultPrefTilt ?? null;
  const refineEffectivePrefTilt = refineStats?.debugEffectivePrefTilt ?? refineStats?.debugPrefTilt ?? null;
  const refineTiltWeightMap = refineStats?.debugTiltWeightMap ?? null;
  const refineTiltsApplied = refineStats?.debugTiltsApplied ?? false;
  const refineDebugTiming = refineStats?.debugTiming ?? null;
  const topSuggestionConstraintDelta = suggestions[0]?.meta?.constraintDelta ?? null;
  const topConstraintDeltaFromStats = refineStats?.debugTopConstraintDelta ?? null;
  const topConstraintBaselineHard = topSuggestionConstraintDelta?.baseline.hardCount
    ?? topConstraintDeltaFromStats?.baselineHardCount
    ?? null;
  const topConstraintBaselineSoft = topSuggestionConstraintDelta?.baseline.softCount
    ?? topConstraintDeltaFromStats?.baselineSoftCount
    ?? null;
  const topConstraintAfterHard = topSuggestionConstraintDelta?.after.hardCount
    ?? topConstraintDeltaFromStats?.afterHardCount
    ?? null;
  const topConstraintAfterSoft = topSuggestionConstraintDelta?.after.softCount
    ?? topConstraintDeltaFromStats?.afterSoftCount
    ?? null;
  const topConstraintHardDelta = topSuggestionConstraintDelta?.deltas.hardDelta
    ?? topConstraintDeltaFromStats?.hardDelta
    ?? null;
  const topConstraintSoftDelta = topSuggestionConstraintDelta?.deltas.softDelta
    ?? topConstraintDeltaFromStats?.softDelta
    ?? null;
  const topSuggestionImprovedKinds = topSuggestionConstraintDelta?.improvedKinds ?? [];
  const seedTelemetry = readSeedTelemetry(lens.plan);
  const showSeedFallbackBanner = !debug
    && googleResolverEnabled
    && seedTelemetry?.used === 'local'
    && Boolean(seedTelemetry.error);
  const resolverStatusMessage = (() => {
    if (lens.lastResolverUsed === 'google') return 'Using Google Places for candidates';
    if (lens.lastResolverUsed === 'local') return 'Falling back to local dataset';
    if (lens.lastResolverUsed === 'mock') return 'Using mock candidates (offline)';
    return 'Resolver not run yet for this refine cycle';
  })();
  const resolverStatusSentence = (() => {
    if (lens.lastResolverUsed === 'google') return 'Using Google Places for candidates';
    if (lens.lastResolverUsed === 'local') return 'Falling back to local dataset';
    if (lens.lastResolverUsed === 'mock') return 'Using mock candidates (offline)';
    return 'Resolver not run yet for this refine cycle';
  })();

  void resolverStatusSentence;
  return (
    <main className="mx-auto min-h-screen w-full max-w-md space-y-3 bg-slate-950 p-3 pb-36 text-gray-300">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Idea-Date Lens</div>
            <h1 className="text-base font-semibold text-white">{lens.plan.title}</h1>
          </div>
          <Link href="/idea-date" className="text-xs text-gray-300 underline">
            New seed
          </Link>
        </div>
        {notice ? (
          <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
            {notice}
          </div>
        ) : null}
        {showOperatorTelemetry ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={lens.holdAppliedNotice}
              onChange={(event) => lens.setHoldAppliedNotice(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-sky-400"
            />
            Hold banner
          </label>
        ) : null}
        {lens.appliedNotice ? (
          <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-sky-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide">{lens.appliedNotice.title}</div>
                {lens.canUndoLastApply ? (
                  <button
                    type="button"
                    onClick={() => {
                      void lens.undoLastApply();
                    }}
                    className="rounded border border-sky-300/40 px-1.5 py-0.5 text-[11px] text-sky-100"
                  >
                    Undo
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => lens.clearAppliedNotice()}
                className="rounded border border-sky-300/40 px-1.5 py-0.5 text-[11px] text-sky-100"
                aria-label="Close locked-in banner"
              >
                x
              </button>
            </div>
            <div className="mt-1 space-y-1 text-xs">
              {lens.appliedNotice.lines.slice(0, 2).map((line) => (
                <div key={`applied-notice-${line}`}>{line}</div>
              ))}
            </div>
          </div>
        ) : null}
        {previewBannerText ? (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
            {previewBannerText}
          </div>
        ) : null}
        {showSeedFallbackBanner ? (
          <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
            Using backup places (Google search unavailable).
          </div>
        ) : null}
      </div>

      {debug ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-gray-400">Truth Panel</div>
          <div className="mt-1 text-2xl font-semibold text-white">{computedActive.journeyScore100}</div>
          <div className="text-xs text-gray-300">Seamlessness score</div>
          <div className="text-sm text-gray-300">{scoreBandLabel}</div>
          <div className="mt-2 text-xs text-gray-300">Violations: {violationsCount}</div>
          <div className="mt-1 text-xs text-gray-300">
            Constraints: hard={constraintHardCount}, soft={constraintSoftCount}
          </div>
          {uniqueConstraintMessages.length > 0 ? (
            <div className="mt-1 space-y-1 text-[11px] text-gray-400">
              {uniqueConstraintMessages.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          ) : null}
          {debug ? (
            <div className="mt-1 text-[11px] text-gray-400">
              I {computedActive.intentScore.toFixed(2)} | Fa {computedActive.fatiguePenalty.toFixed(2)} | Fr{' '}
              {computedActive.frictionPenalty.toFixed(2)}
            </div>
          ) : null}
          {debug ? (
            <div className="mt-2 text-sm text-gray-300">
              Score {computedActive.journeyScore100} | Violations {violationsCount} | Suggestions {suggestionsCount}
            </div>
          ) : null}
          {showOperatorTelemetry ? (
            <details className="mt-2 rounded-md border border-slate-800 bg-slate-950/35 px-2 py-1">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Operator Telemetry
              </summary>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>
                  Arc Total:{' '}
                  <span className="font-mono text-gray-300">
                    {computedActive.arcContributionTotal.toFixed(6)}
                  </span>
                </div>
                <div>
                  Arc By Stop:{' '}
                  <span className="font-mono text-gray-300">
                    {JSON.stringify(liveArcContributionByIndex)}
                  </span>
                </div>
                <div>
                  Suggestions:{' '}
                  <span className="font-mono text-gray-300">{suggestions.length}</span>
                </div>
                {typeof topSuggestionDeltaArc === 'number' && Number.isFinite(topSuggestionDeltaArc) ? (
                  <div>
                    Top suggestion deltaArc:{' '}
                    <span className="font-mono text-gray-300">
                      {topSuggestionDeltaArc.toFixed(6)}
                    </span>
                  </div>
                ) : null}
                {topConstraintBaselineHard != null
                  && topConstraintBaselineSoft != null
                  && topConstraintAfterHard != null
                  && topConstraintAfterSoft != null
                  && topConstraintHardDelta != null
                  && topConstraintSoftDelta != null ? (
                  <>
                    <div>
                      Top suggestion constraints baseline:{' '}
                      <span className="font-mono text-gray-300">
                        hard={topConstraintBaselineHard}, soft={topConstraintBaselineSoft}
                      </span>
                    </div>
                    <div>
                      Top suggestion constraints after:{' '}
                      <span className="font-mono text-gray-300">
                        hard={topConstraintAfterHard}, soft={topConstraintAfterSoft}
                      </span>
                    </div>
                    <div>
                      Top suggestion constraint deltas:{' '}
                      <span className="font-mono text-gray-300">
                        hardDelta={topConstraintHardDelta}, softDelta={topConstraintSoftDelta}
                      </span>
                    </div>
                    <div>
                      Top suggestion improved kinds:{' '}
                      <span className="font-mono text-gray-300">
                        {topSuggestionImprovedKinds.length > 0
                          ? topSuggestionImprovedKinds.join(', ')
                          : 'none'}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </details>
          ) : null}
          {debug ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={lens.isBusy}
                onClick={() => {
                  void lens.seedMessy();
                }}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-60"
              >
                Seed Messy
              </button>
              <button
                type="button"
                disabled={lens.isBusy}
                onClick={() => {
                  void lens.seedClean();
                }}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-60"
              >
                Seed Clean
              </button>
              <button
                type="button"
                disabled={lens.isBusy}
                onClick={() => {
                  void lens.makeMessier();
                }}
                className="rounded-md border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-xs text-amber-200 disabled:opacity-60"
              >
                Make Messier
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-base font-medium text-white">
            {assistantStatusLabel} ({displayScore})
          </div>
          <div className="mt-1 truncate text-sm text-gray-300">{assistantSubline}</div>
          {constraintHeadline ? (
            <div className="mt-1 text-xs text-amber-200">{constraintHeadline}</div>
          ) : null}
          <div className="mt-2 space-y-1 text-xs text-gray-300">
            {arcNarrativeLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {isPreviewing ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-sm font-semibold text-white">Preview Impact</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Before</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {(previewImpactContrast?.beforeLines ?? []).map((line) => (
                  <li key={`before-${line}`} className="text-xs text-gray-300">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">After</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {(previewImpactContrast?.afterLines ?? []).map((line) => (
                  <li key={`after-${line}`} className="text-xs text-gray-300">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {debug ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-sm font-semibold text-white">Why this score?</div>
          <div className="mt-1 space-y-1">
            {whyLines.map((line) => (
              <div key={line} className="text-sm text-gray-300">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-gray-300">
        {nextActionMessage}
      </div>

      <Arc
        arcModel={lens.arcModel}
        title={debug ? 'ENERGY ARC' : 'PACING ARC'}
        series={arcSeriesForChart}
      />

      {debug ? (
        <details className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-white">Legend (QA)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-300">
            <li>Seamlessness Score blends intent fit, arc fatigue, and travel friction.</li>
            <li>Violations flag flow risks like no taper, high friction, or role mismatch.</li>
            <li>Energy Arc should build toward main and taper by windDown.</li>
            <li>Refine generates reorder/replacement suggestions; Preview then Apply.</li>
            <li>Preview is draft-only; Apply commits the change to the plan.</li>
            <li>QA tip: compare Seed Messy vs Seed Clean to validate suggestion behavior.</li>
          </ul>
        </details>
      ) : null}

      {showOperatorTelemetry ? (
        <details className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            Resolver Status (Debug)
          </summary>

          <div className="mt-3 space-y-4 text-xs text-gray-300">
            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">A) Session</div>
              <div className="mt-1 text-[11px] text-gray-400">
                Session: {resolverStatusMessage} | mode {lens.mode} ({lens.modePolicy.label})
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>Using Google Places for candidates: {resolverStatusMessage}</div>
                <div>
                  Flags: google={googleResolverEnabled ? 'true' : 'false'} | localFallback=
                  {localResolverEnabled ? 'true' : 'false'}
                </div>
                <div>
                  Current mode: {lens.mode} ({lens.modePolicy.label})
                </div>
                <div>
                  Current prefTilt:{' '}
                  <span className="font-mono">
                    vibe={lens.prefTilt.vibe}, walking={lens.prefTilt.walking}, peak={lens.prefTilt.peak}
                  </span>
                </div>
                <div>
                  Mode default prefTilt:{' '}
                  <span className="font-mono">
                    vibe={lens.modePolicy.defaultPrefTilt.vibe}, walking={lens.modePolicy.defaultPrefTilt.walking},
                    peak={lens.modePolicy.defaultPrefTilt.peak}
                  </span>
                </div>
                <div>Last resolver used: {lens.lastResolverUsed}</div>
                <div>Last candidate count: <span className="font-mono">{lens.lastResolverCandidateCount}</span></div>
                <div>Last error: {resolverErrorDisplay ?? 'none'}</div>
              </div>
            </section>

            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                B) This Refine Cycle
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Refine: {refinePassUsed} | seen {refineStats?.candidateCount ?? 0} | kept {refineStats?.evaluatedCount ?? 0}{' '}
                | discarded {refineStats?.discardedCount ?? 0} | t {refineDebugTiming?.totalRefineMs ?? 0}ms
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>Refine pass used: {refinePassUsed}</div>
                <div>
                  candidates seen / kept / discarded:{' '}
                  <span className="font-mono">
                    {refineStats?.candidateCount ?? 0} / {refineStats?.evaluatedCount ?? 0} /{' '}
                    {refineStats?.discardedCount ?? 0}
                  </span>
                </div>
                <div>discard breakdown: {refineDiscardSummary}</div>
                <div>Refine tilts applied: {String(refineTiltsApplied)}</div>
                <div>
                  Refine mode defaults:{' '}
                  <span className="font-mono">
                    vibe={refineModeDefaultsPrefTilt?.vibe ?? 0}, walking={refineModeDefaultsPrefTilt?.walking ?? 0},
                    peak={refineModeDefaultsPrefTilt?.peak ?? 0}
                  </span>
                </div>
                <div>
                  Refine plan prefTilt:{' '}
                  <span className="font-mono">
                    vibe={refinePlanPrefTilt?.vibe ?? 0}, walking={refinePlanPrefTilt?.walking ?? 0}, peak=
                    {refinePlanPrefTilt?.peak ?? 0}
                  </span>
                </div>
                <div>
                  Refine effective tilt:{' '}
                  <span className="font-mono">
                    vibe={refineEffectivePrefTilt?.vibe ?? 0}, walking={refineEffectivePrefTilt?.walking ?? 0}, peak=
                    {refineEffectivePrefTilt?.peak ?? 0}
                  </span>
                </div>
                <div>
                  Timing (ms):{' '}
                  <span className="font-mono">
                    total={refineDebugTiming?.totalRefineMs ?? 0}, resolver={refineDebugTiming?.resolverFetchMs ?? 0},
                    prep={refineDebugTiming?.candidatePrepMs ?? 0}, eval={refineDebugTiming?.candidateEvaluationMs ?? 0},
                    ranking={refineDebugTiming?.rankingMs ?? 0}
                  </span>
                </div>
                <details className="rounded-md border border-slate-800 bg-slate-950/35 px-2 py-1">
                  <summary className="cursor-pointer text-[11px] font-medium text-gray-500">Weights</summary>
                  <div className="mt-1 space-y-1 text-[11px] text-gray-400">
                    <div>
                      transition: <span className="font-mono">{refineTiltWeightMap?.transitionSmoothnessWeight.toFixed(3) ?? '1.000'}</span>
                    </div>
                    <div>
                      peak: <span className="font-mono">{refineTiltWeightMap?.peakAlignmentWeight.toFixed(3) ?? '1.000'}</span>
                    </div>
                    <div>
                      taper: <span className="font-mono">{refineTiltWeightMap?.taperIntegrityWeight.toFixed(3) ?? '1.000'}</span>
                    </div>
                    <div>
                      fatigue: <span className="font-mono">{refineTiltWeightMap?.fatigueImpactWeight.toFixed(3) ?? '1.000'}</span>
                    </div>
                    <div>
                      friction: <span className="font-mono">{refineTiltWeightMap?.frictionImpactWeight.toFixed(3) ?? '1.000'}</span>
                    </div>
                    <div>
                      peakShift: <span className="font-mono">{refineTiltWeightMap?.idealPeakShift ?? 0}</span>
                    </div>
                  </div>
                </details>
                {passBreakdown ? (
                  <>
                    <div>
                      Primary replacement:{' '}
                      <span className="font-mono">
                        seen={passBreakdown.primaryReplacement.seen}, kept={passBreakdown.primaryReplacement.kept},
                        discarded={passBreakdown.primaryReplacement.discarded}
                      </span>
                    </div>
                    <div>Primary discard breakdown: {primaryPassDiscardSummary}</div>
                    <div>
                      Repair replacement:{' '}
                      <span className="font-mono">
                        seen={passBreakdown.repairReplacement.seen}, kept={passBreakdown.repairReplacement.kept},
                        discarded={passBreakdown.repairReplacement.discarded}
                      </span>
                    </div>
                    <div>Repair discard breakdown: {repairPassDiscardSummary}</div>
                    <div>
                      Reorder-repair:{' '}
                      <span className="font-mono">
                        evaluated={passBreakdown.reorderRepair.evaluated}, kept={passBreakdown.reorderRepair.kept}
                      </span>
                    </div>
                  </>
                ) : null}
                {repairThresholds ? (
                  <div>
                    Repair thresholds:{' '}
                    <span className="font-mono">
                      drop@1v={repairThresholds.maxJourneyDropOneViolationReduced.toFixed(2)}, drop@2v=
                      {repairThresholds.maxJourneyDropTwoViolationsReduced.toFixed(2)}
                    </span>
                  </div>
                ) : null}
                {reorderRepairDebug ? (
                  <div>
                    {(() => {
                      const topDeltaArc = passBreakdown?.reorderRepair.topDeltaArc ?? reorderRepairDebug.topDeltaArc;
                      const topDeltaJourney =
                        passBreakdown?.reorderRepair.topDeltaJourney ?? reorderRepairDebug.topDeltaJourney;
                      const topDeltaViolations =
                        passBreakdown?.reorderRepair.topDeltaViolations ?? reorderRepairDebug.topDeltaViolations;
                      return (
                        <>
                          Reorder-repair top deltas:{' '}
                          <span className="font-mono">
                            deltaArc={typeof topDeltaArc === 'number' ? topDeltaArc.toFixed(4) : 'n/a'}, deltaJourney=
                            {typeof topDeltaJourney === 'number' ? topDeltaJourney.toFixed(4) : 'n/a'},
                            deltaViolations=
                            {typeof topDeltaViolations === 'number' ? topDeltaViolations.toFixed(0) : 'n/a'}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                C) Top Suggestion Outcome
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Top outcome: hardDelta {topConstraintHardDelta ?? 'n/a'} | softDelta {topConstraintSoftDelta ?? 'n/a'} | deltaArc{' '}
                {typeof topSuggestionDeltaArc === 'number' && Number.isFinite(topSuggestionDeltaArc)
                  ? topSuggestionDeltaArc.toFixed(4)
                  : 'n/a'}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                {topConstraintBaselineHard != null
                  && topConstraintBaselineSoft != null
                  && topConstraintAfterHard != null
                  && topConstraintAfterSoft != null
                  && topConstraintHardDelta != null
                  && topConstraintSoftDelta != null ? (
                  <>
                    <div>
                      constraints baseline:{' '}
                      <span className="font-mono">hard={topConstraintBaselineHard}, soft={topConstraintBaselineSoft}</span>
                    </div>
                    <div>
                      constraints after:{' '}
                      <span className="font-mono">hard={topConstraintAfterHard}, soft={topConstraintAfterSoft}</span>
                    </div>
                    <div>
                      deltas:{' '}
                      <span className="font-mono">hardDelta={topConstraintHardDelta}, softDelta={topConstraintSoftDelta}</span>
                    </div>
                    <div>
                      improved kinds: {topSuggestionImprovedKinds.length > 0 ? topSuggestionImprovedKinds.join(', ') : 'none'}
                    </div>
                  </>
                ) : (
                  <div>No top suggestion constraint delta available.</div>
                )}
                <div>
                  Ranking:{' '}
                  <span className="font-mono">
                    deltaArc={topReplacementDiversity?.ranking.deltaArc.toFixed(4) ?? '0.0000'}, adjustedArc=
                    {topReplacementDiversity?.ranking.adjustedArc.toFixed(4) ?? '0.0000'}, nearEq=
                    {topReplacementDiversity?.ranking.nearEqualArcDelta.toFixed(4) ?? '0.0000'}, weight=
                    {topReplacementDiversity?.ranking.weight.toFixed(4) ?? '0.0000'}
                  </span>
                </div>
              </div>
            </section>

            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                D) Candidate Shaping
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Top replacement: {topReplacementRoleQuery.templateUsed} | family {topReplacementDiversity?.candidateFamilyKey ?? 'other'}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>Top replacement template: {topReplacementRoleQuery.templateUsed}</div>
                <div>
                  Top replacement query:{' '}
                  <span className="font-mono">
                    types={topReplacementRoleQuery.typesCount}, keywordUsed={String(topReplacementRoleQuery.keywordUsed)},
                    radius={topReplacementRoleQuery.radiusMeters}m
                  </span>
                </div>
                <div>Top replacement family: {topReplacementDiversity?.candidateFamilyKey ?? 'other'}</div>
                <div>Plan family counts: {topReplacementFamilySummary}</div>
                <div>
                  Diversity penalty:{' '}
                  <span className="font-mono">{topReplacementDiversity?.diversityPenalty.toFixed(4) ?? '0.0000'}</span>
                </div>
              </div>
            </section>

            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                E) Seed Telemetry
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Seed: {seedTelemetry?.used ?? 'unknown'} | count {seedTelemetry?.count ?? 0} | error{' '}
                {seedTelemetry?.error ? 'yes' : 'none'}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>used: {seedTelemetry?.used ?? 'unknown'}</div>
                <div>count: <span className="font-mono">{seedTelemetry?.count ?? 0}</span></div>
                <div>error: {seedTelemetry?.error ? truncateSingleLine(seedTelemetry.error) : 'none'}</div>
                <div>requestId: {seedTelemetry?.requestId ?? 'none'}</div>
              </div>
              <button
                type="button"
                disabled={isPingingPlaces}
                onClick={() => {
                  void handlePingPlaces();
                }}
                className="mt-2 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-60"
              >
                {isPingingPlaces ? 'Pinging...' : 'Ping Places'}
              </button>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400">
                <div>Last Ping requestId: {lastPingTelemetry?.requestId ?? 'none'}</div>
                <div>
                  Last Ping candidateNames:{' '}
                  {lastPingTelemetry && lastPingTelemetry.candidateNames.length > 0
                    ? lastPingTelemetry.candidateNames.join(' | ')
                    : 'none'}
                </div>
                <div>Last Ping route: {lastPingTelemetry?.route ?? 'none'}</div>
                <div>
                  Last Ping cacheHit:{' '}
                  {lastPingTelemetry === null || lastPingTelemetry.cacheHit === null
                    ? 'unknown'
                    : String(lastPingTelemetry.cacheHit)}
                </div>
              </div>
              {pingResults.length > 0 ? (
                <div className="mt-2 space-y-1 text-[11px] text-emerald-200">
                  {pingResults.map((item) => (
                    <div key={item.placeId}>
                      {item.name} ({item.placeId})
                    </div>
                  ))}
                </div>
              ) : null}
              {pingError ? (
                <div className="mt-2 text-[11px] text-rose-200">{truncateSingleLine(pingError)}</div>
              ) : null}
            </section>
          </div>
        </details>
      ) : null}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Stops</div>
        <div className="space-y-2">
          {lens.plan.stops.map((stop, index) => (
            <div key={stop.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-white">
                    {index + 1}. {stop.name}
                  </div>
                  <div className="text-xs text-gray-300">
                    {stop.placeLite?.types?.join(', ') ?? 'No categories'}
                  </div>
                </div>
                <select
                  value={readRole(stop)}
                  onChange={(event) => {
                    void lens.setRole(
                      stop.id,
                      event.target.value as 'start' | 'main' | 'windDown' | 'flex'
                    );
                  }}
                  className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100"
                >
                  <option value="start">start</option>
                  <option value="main">main</option>
                  <option value="windDown">windDown</option>
                  <option value="flex">flex</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void lens.moveUp(stop.id);
                  }}
                  className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void lens.moveDown(stop.id);
                  }}
                  className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsStopId(stop.id)}
                  className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void lens.removeStop(stop.id);
                  }}
                  className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-200"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Tuning</div>
        {debug ? (
          <div className="mb-3 rounded-md border border-slate-700 bg-slate-800/50 p-2">
            <div className="mb-1 text-xs font-semibold text-gray-300">Mode</div>
            <select
              value={lens.mode}
              onChange={(event) => lens.setMode(event.target.value as IdeaDateMode)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100"
            >
              {MODE_OPTIONS.map((modeOption) => (
                <option key={modeOption} value={modeOption}>
                  {modeOption}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-gray-400">
              {lens.modePolicy.label}
              {lens.modePolicy.description ? ` - ${lens.modePolicy.description}` : ''}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={lens.isBusy}
                onClick={() => lens.applyModeDefaults()}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
              >
                Apply mode defaults
              </button>
              <button
                type="button"
                disabled={lens.isBusy}
                onClick={() => lens.setMode('default')}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
              >
                Reset mode
              </button>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <TuningSegmentedControl
            label="Vibe"
            value={lens.prefTilt.vibe}
            options={VIBE_TUNING_OPTIONS}
            onChange={(next) => lens.setPrefTiltVibe(next)}
          />
          <TuningSegmentedControl
            label="Walking"
            value={lens.prefTilt.walking}
            options={WALKING_TUNING_OPTIONS}
            onChange={(next) => lens.setPrefTiltWalking(next)}
          />
          <TuningSegmentedControl
            label="Peak"
            value={lens.prefTilt.peak}
            options={PEAK_TUNING_OPTIONS}
            onChange={(next) => lens.setPrefTiltPeak(next)}
          />
        </div>
        {showOperatorTelemetry ? (
          <div className="mt-2 text-xs text-gray-400">
            prefTilt: vibe={lens.prefTilt.vibe}, walking={lens.prefTilt.walking}, peak={lens.prefTilt.peak}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={lens.isBusy}
            onClick={() => {
              void lens.refine();
            }}
            className="flex-1 rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            Refine My Evening
          </button>
          <button
            type="button"
            disabled={lens.isBusy}
            onClick={() => {
              if (computedActive.violations.length > 0) {
                setConfirmBullets(translateFinalSummary(computedActive.violations));
                setConfirmOpen(true);
                return;
              }
              setNotice('Confirmed with no active violations.');
            }}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-100 disabled:opacity-60"
          >
            Confirm
          </button>
        </div>
        {lens.refineNotice ? (
          <div className="mt-2 text-xs text-amber-200">{lens.refineNotice}</div>
        ) : null}
      </div>

      <div className="space-y-2">
        {!debug && lens.emptySuggestions ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
            <div className="text-sm font-semibold text-emerald-200">This plan already flows well.</div>
            <p className="mt-1 text-xs text-emerald-200">
              Try changing a stop or your vibe sliders to explore alternatives.
            </p>
          </div>
        ) : null}
        {suggestions.map((suggestion) => {
          const isPreviewingThisSuggestion = lens.previewSuggestionId === suggestion.id;
          const copy = translateSuggestion(
            suggestion,
            computedActive.violations ?? [],
            {
              intentScore: computedActive.intentScore,
              journeyScore: computedActive.journeyScore,
            },
            lens.vibeId,
            suggestionStopContext
          );
          const visibleNarrativeLines = toNarrativeLines(copy.note, 2);
          const visibleNarrative = visibleNarrativeLines.join('\n');
          const rawNarrativeComponents = (copy.debugNarrativeComponents ?? [])
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          const hasMoreNarrative = rawNarrativeComponents.some(
            (line) => !visibleNarrativeLines.includes(line)
          );
          const showExtendedNarrative = !isAnyPreviewing
            && !isPreviewingThisSuggestion
            && debug
            && hasMoreNarrative;
          return (
            <div key={suggestion.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-sm font-semibold text-white">{copy.title}</div>
              <p className="mt-1 whitespace-pre-line text-xs text-gray-300">{visibleNarrative}</p>
              {showExtendedNarrative ? (
                <details className="mt-1 text-[11px] text-gray-500">
                  <summary className="cursor-pointer select-none text-gray-400">More</summary>
                  <div className="mt-1 space-y-1">
                    {rawNarrativeComponents.map((line, index) => (
                      <div key={`${suggestion.id}-narrative-component-${index}`}>{line}</div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {copy.chips.map((chip) => (
                  <span
                    key={`${suggestion.id}-${chip}`}
                    className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-gray-200"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              {debug ? (
                <div className="mt-2 text-xs text-gray-400">
                  +{(suggestion.impact.delta * 100).toFixed(1)} score delta (preview)
                </div>
              ) : null}
              {debug && suggestion.arcImpact ? (
                <div className="mt-1 text-[11px] text-gray-500">
                  Arc total {suggestion.arcImpact.beforeTotal.toFixed(3)} -&gt;{' '}
                  {suggestion.arcImpact.afterTotal.toFixed(3)} ({suggestion.arcImpact.deltaTotal >= 0 ? '+' : ''}
                  {suggestion.arcImpact.deltaTotal.toFixed(3)})
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void lens.previewSuggestion(suggestion.id);
                  }}
                  className="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-medium text-gray-100"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void lens.applySuggestion(suggestion.id);
                  }}
                  className="flex-1 rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-slate-950"
                >
                  Apply
                </button>
              </div>
            </div>
          );
        })}
        {lens.previewSuggestionId ? (
          <button
            type="button"
            onClick={() => lens.undoPreview()}
            className="w-full rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200"
          >
            Undo Preview
          </button>
        ) : null}
      </div>

      <StopDetails
        open={Boolean(activeStop)}
        stop={activeStop}
        onClose={() => setDetailsStopId(null)}
        setOverrides={(stopId, partial) => lens.setOverrides(stopId, partial)}
      />

      <ConfirmModal
        open={confirmOpen}
        bullets={confirmBullets}
        onClose={() => setConfirmOpen(false)}
        onConfirmAnyway={() => {
          setConfirmOpen(false);
          setNotice('Confirmed with current violations acknowledged.');
        }}
        onRefine={() => {
          setConfirmOpen(false);
          void lens.refine();
        }}
      />
    </main>
  );
}


