'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Plan } from '@/app/plan-engine/types';
import { getFocusPolicy } from '@/lib/local-activation/focusPolicy';
import { getGroupPolicy } from '@/lib/local-activation/groupPolicy';
import {
  createEmptyLocalActivationSession,
  type ActivationRefinement,
  type FocusType,
  type GroupType,
  type LocalActivationSession,
} from '@/lib/session/localActivationSession';
import {
  buildLocalActivationCacheKey,
  buildLocalActivationPlanId,
} from '@/lib/toolkits/concierge/localActivationKeys';
import { setLocalActivationMeta } from '@/lib/toolkits/concierge/meta';
import {
  buildSeedPlan,
  buildSeedPlanGoogle,
  toSeedResolverError,
  withSeedResolverTelemetry,
} from '@/lib/toolkits/concierge/seeds';
import { enforceSurpriseContract } from '@/lib/toolkits/concierge/surpriseEnforcer';

const googleResolverEnabled =
  process.env.NEXT_PUBLIC_VERTICAL_GOOGLE_RESOLVER === '1' ||
  process.env.NEXT_PUBLIC_GOOGLE_RESOLVER === '1' ||
  process.env.NEXT_PUBLIC_IDEA_DATE_GOOGLE_RESOLVER === '1';
const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';

const GROUP_OPTIONS: Array<{ value: GroupType; label: string }> = [
  { value: 'solo', label: 'Solo' },
  { value: 'friends', label: 'Friends' },
  { value: 'family', label: 'Family' },
  { value: 'community', label: 'Community' },
  { value: 'networking', label: 'Networking' },
];

const FOCUS_OPTIONS: Array<{ value: FocusType; label: string }> = [
  { value: 'art-walk', label: 'Art Walk' },
  { value: 'live-music', label: 'Live Music Night' },
  { value: 'food-makers', label: 'Food & Makers' },
  { value: 'retail-spotlight', label: 'Retail Spotlight' },
  { value: 'night-market', label: 'Night Market' },
  { value: 'seasonal-festival', label: 'Seasonal Festival' },
];

const REFINEMENT_OPTIONS: Array<{ value: Exclude<ActivationRefinement, null>; label: string }> = [
  { value: 'more_unique', label: 'More unique' },
  { value: 'more_energy', label: 'More energy' },
  { value: 'closer_together', label: 'Closer together' },
  { value: 'more_curated', label: 'More curated' },
  { value: 'more_affordable', label: 'More affordable' },
];

type GeneratePlanInput = {
  groupType: GroupType;
  focus: FocusType;
  refinement: ActivationRefinement;
  surprise: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clonePlan(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan);
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

export default function LocalActivationLandingPage() {
  const [session, setSession] = useState<LocalActivationSession>(() => createEmptyLocalActivationSession());
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedPlanId, setGeneratedPlanId] = useState<string | null>(null);
  const [lastGeneratedMeta, setLastGeneratedMeta] = useState<unknown>(null);
  const [lastCacheKey, setLastCacheKey] = useState<string | null>(null);
  const planCacheRef = useRef<Record<string, Plan>>({});

  const canGenerate = Boolean(session.groupType && session.focus);
  const lastLocalActivationMeta = useMemo(() => {
    if (!isRecord(lastGeneratedMeta)) return null;
    const localActivation = lastGeneratedMeta.localActivation;
    if (!isRecord(localActivation)) return null;
    return localActivation;
  }, [lastGeneratedMeta]);

  const generatePlan = useCallback(async (input: GeneratePlanInput): Promise<{ planId: string; cacheKey: string }> => {
    const cacheKey = buildLocalActivationCacheKey(input);
    const planId = buildLocalActivationPlanId(input);
    const groupPolicy = getGroupPolicy(input.groupType);
    const focusPolicy = getFocusPolicy(input.focus);
    const cached = planCacheRef.current[cacheKey];
    if (cached) {
      if (debug) {
        setLastGeneratedMeta(cached.meta ?? null);
      }
      return { planId, cacheKey };
    }

    let seeded = buildSeedPlan({ id: planId, title: 'Local Activation: Surprise Me' });
    if (googleResolverEnabled) {
      try {
        if (debug) {
          console.log('[local-activation][debug] google_seeding_start');
        }
        seeded = await buildSeedPlanGoogle({ id: planId, title: 'Local Activation: Surprise Me' });
      } catch (nextError) {
        const error = toSeedResolverError(nextError);
        if (debug) {
          console.log(`[local-activation][debug] google_seeding_fallback error=${error ?? 'unknown'}`);
        }
        seeded = withSeedResolverTelemetry(seeded, {
          used: 'local',
          count: 0,
          error,
        });
      }
    }

    const withLocalMeta = setLocalActivationMeta(seeded, {
      groupPolicy,
      focusPolicy,
      refinement: input.refinement,
      surprise: true,
    });

    const { plan: enforcedPlan, report } = enforceSurpriseContract({
      plan: clonePlan(withLocalMeta),
      crewPolicy: groupPolicy,
      anchorPolicy: focusPolicy as unknown as Parameters<typeof enforceSurpriseContract>[0]['anchorPolicy'],
    });

    const stablePlan = setLocalActivationMeta(enforcedPlan, {
      surpriseReport: report,
    });

    planCacheRef.current[cacheKey] = stablePlan;
    if (debug) {
      setLastGeneratedMeta(stablePlan.meta ?? null);
    }
    return { planId, cacheKey };
  }, []);

  const regenerate = useCallback(async (nextSession: LocalActivationSession, nextMessage: string) => {
    if (!nextSession.groupType || !nextSession.focus) return;
    setIsGenerating(true);
    try {
      const next = await generatePlan({
        groupType: nextSession.groupType,
        focus: nextSession.focus,
        refinement: nextSession.refinement,
        surprise: true,
      });
      setGeneratedPlanId(next.planId);
      setLastCacheKey(next.cacheKey);
      setMessage(nextMessage);
    } finally {
      setIsGenerating(false);
    }
  }, [generatePlan]);

  const handleGroupSelect = useCallback((nextGroupType: GroupType) => {
    if (session.groupType === nextGroupType) return;
    if (session.lockedGroupType !== null) {
      setMessage('Group is locked for this session.');
      return;
    }
    setMessage(null);
    setSession((prev) => ({
      ...prev,
      groupType: nextGroupType,
    }));
  }, [session.groupType, session.lockedGroupType]);

  const handleFocusSelect = useCallback((nextFocus: FocusType) => {
    if (session.focus === nextFocus) return;
    const nextSession: LocalActivationSession = {
      ...session,
      focus: nextFocus,
    };
    setSession(nextSession);
    setMessage(null);
    if (generatedPlanId && nextSession.groupType) {
      void regenerate(nextSession, 'Focus updated. Regenerated this activation.');
    }
  }, [generatedPlanId, regenerate, session]);

  const handleGenerate = useCallback(async () => {
    if (!session.groupType) {
      setMessage('Select group before generating.');
      return;
    }
    if (!session.focus) {
      setMessage('Select a focus before generating.');
      return;
    }

    setIsGenerating(true);
    setMessage(null);
    try {
      const next = await generatePlan({
        groupType: session.groupType,
        focus: session.focus,
        refinement: session.refinement,
        surprise: true,
      });
      setGeneratedPlanId(next.planId);
      setLastCacheKey(next.cacheKey);
      setSession((prev) => ({
        ...prev,
        lockedGroupType: prev.groupType ?? prev.lockedGroupType,
      }));
      setMessage('Plan generated. Focus/refinement changes regenerate this session.');
    } finally {
      setIsGenerating(false);
    }
  }, [generatePlan, session.focus, session.groupType, session.refinement]);

  const handleRefinement = useCallback((refinement: ActivationRefinement, nextMessage: string) => {
    if (!generatedPlanId || !session.groupType || !session.focus) return;
    const nextSession: LocalActivationSession = {
      ...session,
      refinement,
    };
    setSession(nextSession);
    void regenerate(nextSession, nextMessage);
  }, [generatedPlanId, regenerate, session]);

  const handleStartNewSession = useCallback(() => {
    setSession(createEmptyLocalActivationSession());
    setGeneratedPlanId(null);
    setLastGeneratedMeta(null);
    setLastCacheKey(null);
    setMessage(null);
    planCacheRef.current = {};
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Local Activation Lens</h1>
          <p className="mt-2 text-sm text-slate-600">
            Select group + focus, then generate.
          </p>
        </div>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Group (required)</p>
          <div className="grid grid-cols-2 gap-2">
            {GROUP_OPTIONS.map((option) => {
              const isSelected = session.groupType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleGroupSelect(option.value)}
                  className={
                    isSelected
                      ? 'rounded-md border border-slate-900 bg-slate-900 px-2 py-2 text-xs font-semibold text-white'
                      : 'rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800'
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Focus (required)</p>
          <select
            value={session.focus ?? ''}
            onChange={(event) => handleFocusSelect(event.target.value as FocusType)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Select focus</option>
            {FOCUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Surprise: on
          <br />
          Refinement: {session.refinement ?? 'null'}
        </div>

        {debug ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <summary className="cursor-pointer select-none font-semibold text-slate-800">
              Debug: Local Activation Meta
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <div className="font-semibold text-slate-800">meta.localActivation.groupPolicy</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastLocalActivationMeta?.groupPolicy ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.localActivation.focusPolicy</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastLocalActivationMeta?.focusPolicy ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.localActivation.refinement</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastLocalActivationMeta?.refinement ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.localActivation.surpriseReport</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastLocalActivationMeta?.surpriseReport ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">planId + cacheKey</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify({ planId: generatedPlanId, cacheKey: lastCacheKey }, null, 2)}
                </pre>
              </div>
            </div>
          </details>
        ) : null}

        <button
          type="button"
          onClick={() => {
            void handleGenerate();
          }}
          disabled={isGenerating || !canGenerate}
          className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isGenerating ? 'Building...' : 'Generate Plan'}
        </button>

        {generatedPlanId ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-2">
            <p>
              Current group: <span className="font-semibold">{session.groupType}</span>
            </p>
            <p>
              Current focus: <span className="font-semibold">{session.focus}</span>
            </p>
            <p>
              Refinement: <span className="font-semibold">{session.refinement ?? 'none'}</span>
            </p>
            <p>
              Plan generated (id: <span className="font-semibold">{generatedPlanId}</span>)
            </p>
            <button
              type="button"
              disabled
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500"
              title="TODO: wire a generic plan preview route for Local Activation plans"
            >
              Open current plan (TODO)
            </button>
          </div>
        ) : null}

        {generatedPlanId ? (
          <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Refinement</p>
            <div className="grid grid-cols-2 gap-2">
              {REFINEMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleRefinement(option.value, `Refined: ${option.label}.`)}
                  className={
                    session.refinement === option.value
                      ? 'rounded-md border border-slate-900 bg-slate-900 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50'
                      : 'rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-50'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleRefinement(null, 'Refinement cleared.')}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-50"
            >
              Clear refinement
            </button>
          </section>
        ) : null}

        {message ? <p className="text-xs text-slate-600">{message}</p> : null}

        <button
          type="button"
          onClick={handleStartNewSession}
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800"
        >
          Start New Session
        </button>
      </div>
    </main>
  );
}
