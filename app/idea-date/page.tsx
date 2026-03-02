'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Plan } from '@/app/plan-engine/types';
import {
  buildSurpriseMePlan,
  buildSurpriseMePlanGoogle,
  toSeedResolverError,
  withIdeaDateSeedResolverTelemetry,
} from '@/lib/idea-date/seeds';
import { getAnchorPolicy } from '@/lib/idea-date/anchorPolicy';
import { getCrewPolicy } from '@/lib/idea-date/crewPolicy';
import { enforceSurpriseContract } from '@/lib/idea-date/surpriseEnforcer';
import { setPlan } from '@/lib/idea-date/store';
import {
  createEmptySession,
  type AnchorType,
  type CrewType,
  type IdeaDateSession,
  type MagicRefinement,
} from '@/lib/session/ideaDateSession';
import { buildIdeaDateCacheKey, buildIdeaDatePlanId } from '@/lib/toolkits/concierge/keys';
import { setIdeaDateMeta } from '@/lib/toolkits/concierge/meta';

const googleResolverEnabled = process.env.NEXT_PUBLIC_IDEA_DATE_GOOGLE_RESOLVER === '1';
const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';

const CREW_OPTIONS: Array<{ value: CrewType; label: string }> = [
  { value: 'romantic', label: 'Romantic' },
  { value: 'friends', label: 'Friends' },
  { value: 'family', label: 'Family' },
];

const ANCHOR_OPTIONS: Array<{ value: AnchorType; label: string }> = [
  { value: 'adventurous', label: 'Adventurous' },
  { value: 'creative', label: 'Creative' },
  { value: 'intellectual', label: 'Intellectual' },
  { value: 'cultured', label: 'Cultured' },
  { value: 'high_energy', label: 'High energy' },
  { value: 'playful_competitive', label: 'Playful & competitive' },
  { value: 'purposeful', label: 'Purposeful' },
  { value: 'culinary', label: 'Culinary' },
];

const MAGIC_REFINEMENT_OPTIONS: Array<{ value: Exclude<MagicRefinement, null>; label: string }> = [
  { value: 'more_unique', label: 'More unique' },
  { value: 'more_energy', label: 'More energy' },
  { value: 'closer_together', label: 'Closer together' },
  { value: 'more_curated', label: 'More curated' },
  { value: 'more_affordable', label: 'More affordable' },
];

type GeneratePlanInput = {
  crew: CrewType;
  anchor: AnchorType;
  surprise: true;
  magicRefinement: MagicRefinement;
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

export default function IdeaDateLandingPage() {
  const [session, setSession] = useState<IdeaDateSession>(() => createEmptySession());
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedPlanId, setGeneratedPlanId] = useState<string | null>(null);
  const [lastGeneratedMeta, setLastGeneratedMeta] = useState<unknown>(null);
  const planCacheRef = useRef<Record<string, Plan>>({});

  const canGenerate = Boolean(session.crew && session.anchor);
  const lastIdeaDateMeta = useMemo(() => {
    if (!lastGeneratedMeta || !isRecord(lastGeneratedMeta)) return null;
    const ideaDate = lastGeneratedMeta.ideaDate;
    if (!isRecord(ideaDate)) return null;
    return ideaDate;
  }, [lastGeneratedMeta]);
  const lastCrewPolicy = useMemo(() => {
    if (!lastIdeaDateMeta) return null;
    return lastIdeaDateMeta.crewPolicy ?? null;
  }, [lastIdeaDateMeta]);
  const lastAnchorPolicy = useMemo(() => {
    if (!lastIdeaDateMeta) return null;
    return lastIdeaDateMeta.anchorPolicy ?? null;
  }, [lastIdeaDateMeta]);
  const lastMagicRefinement = useMemo(() => {
    if (!lastIdeaDateMeta) return null;
    return lastIdeaDateMeta.magicRefinement ?? null;
  }, [lastIdeaDateMeta]);
  const lastSurpriseReport = useMemo(() => {
    if (!lastIdeaDateMeta) return null;
    const report = lastIdeaDateMeta.surpriseReport;
    if (!isRecord(report)) return null;
    return report;
  }, [lastIdeaDateMeta]);

  const generatePlan = useCallback(async (input: GeneratePlanInput): Promise<string> => {
    const cacheKey = buildIdeaDateCacheKey(input);
    const planId = buildIdeaDatePlanId(input);
    const crewPolicy = getCrewPolicy(input.crew);
    const anchorPolicy = getAnchorPolicy(input.anchor);
    const cached = planCacheRef.current[cacheKey];
    if (cached) {
      setPlan(planId, clonePlan(cached));
      if (debug) {
        setLastGeneratedMeta(cached.meta ?? null);
      }
      return planId;
    }

    let seeded = buildSurpriseMePlan({ id: planId, title: 'Idea-Date: Surprise Me' });
    if (googleResolverEnabled) {
      try {
        if (debug) {
          console.log('[idea-date][debug] google_seeding_start');
        }
        seeded = await buildSurpriseMePlanGoogle({ id: planId, title: 'Idea-Date: Surprise Me' });
      } catch (nextError) {
        const error = toSeedResolverError(nextError);
        if (debug) {
          console.log(`[idea-date][debug] google_seeding_fallback error=${error ?? 'unknown'}`);
        }
        seeded = withIdeaDateSeedResolverTelemetry(seeded, {
          used: 'local',
          count: 0,
          error,
        });
      }
    }

    const withPolicies = setIdeaDateMeta(seeded, {
      crewPolicy,
      anchorPolicy,
      magicRefinement: input.magicRefinement,
    });

    let stablePlan = clonePlan(withPolicies);
    const { plan: enforcedPlan } = enforceSurpriseContract({
      plan: stablePlan,
      crewPolicy,
      anchorPolicy,
    });
    stablePlan = enforcedPlan;
    planCacheRef.current[cacheKey] = stablePlan;
    if (debug) {
      setLastGeneratedMeta(stablePlan.meta ?? null);
    }
    setPlan(planId, stablePlan);
    return planId;
  }, []);

  const regenerate = useCallback(async (nextSession: IdeaDateSession, nextMessage: string) => {
    if (!nextSession.crew || !nextSession.anchor) return;
    setIsGenerating(true);
    try {
      const id = await generatePlan({
        crew: nextSession.crew,
        anchor: nextSession.anchor,
        surprise: true,
        magicRefinement: nextSession.magicRefinement,
      });
      setGeneratedPlanId(id);
      setMessage(nextMessage);
    } finally {
      setIsGenerating(false);
    }
  }, [generatePlan]);

  const handleCrewSelect = useCallback((nextCrew: CrewType) => {
    if (session.crew === nextCrew) return;

    if (session.crew !== null) {
      if (generatedPlanId) {
        setMessage('Changing crew starts a new night.');
        setGeneratedPlanId(null);
        setLastGeneratedMeta(null);
        setSession(createEmptySession());
        planCacheRef.current = {};
        return;
      }
      setMessage('Crew is locked for this session.');
      return;
    }

    setMessage(null);
    setSession((prev) => ({
      ...prev,
      crew: nextCrew,
    }));
  }, [generatedPlanId, session.crew]);

  const handleAnchorSelect = useCallback((nextAnchor: AnchorType) => {
    if (session.anchor === nextAnchor) return;

    const nextSession: IdeaDateSession = {
      ...session,
      anchor: nextAnchor,
      magicRefinement: null,
    };
    setSession(nextSession);
    setMessage(null);

    if (generatedPlanId && nextSession.crew) {
      void regenerate(nextSession, 'Anchor updated. Regenerated this night.');
    }
  }, [generatedPlanId, regenerate, session]);

  const handleGenerate = useCallback(async () => {
    if (!session.crew) {
      setMessage('Select crew before generating.');
      return;
    }
    if (!session.anchor) {
      setMessage('Select an anchor before generating.');
      return;
    }

    setIsGenerating(true);
    setMessage(null);
    try {
      const id = await generatePlan({
        crew: session.crew,
        anchor: session.anchor,
        surprise: true,
        magicRefinement: session.magicRefinement,
      });
      setGeneratedPlanId(id);
      setMessage('Plan generated. Anchor changes regenerate this session.');
    } finally {
      setIsGenerating(false);
    }
  }, [generatePlan, session.anchor, session.crew, session.magicRefinement]);

  const handleStartNewNight = useCallback(() => {
    setSession(createEmptySession());
    setGeneratedPlanId(null);
    setLastGeneratedMeta(null);
    setMessage(null);
    planCacheRef.current = {};
  }, []);

  const selectedAnchorLabel = useMemo(() => {
    if (!session.anchor) return null;
    return ANCHOR_OPTIONS.find((option) => option.value === session.anchor)?.label ?? session.anchor;
  }, [session.anchor]);

  const handleMagicRefinement = useCallback((refinement: MagicRefinement, nextMessage: string) => {
    if (!generatedPlanId || !session.crew || !session.anchor) return;
    const nextSession: IdeaDateSession = {
      ...session,
      magicRefinement: refinement,
    };
    setSession(nextSession);
    void regenerate(nextSession, nextMessage);
  }, [generatedPlanId, regenerate, session]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Idea-Date Lens</h1>
          <p className="mt-2 text-sm text-slate-600">
            Session scaffold: select crew and anchor, then generate.
          </p>
        </div>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crew (required)</p>
          <div className="grid grid-cols-3 gap-2">
            {CREW_OPTIONS.map((option) => {
              const isSelected = session.crew === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleCrewSelect(option.value)}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anchor (required)</p>
          <select
            value={session.anchor ?? ''}
            onChange={(event) => handleAnchorSelect(event.target.value as AnchorType)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Select anchor</option>
            {ANCHOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Surprise: on
          <br />
          Magic wand: {session.magicRefinement ?? 'null'}
        </div>

        {debug ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <summary className="cursor-pointer select-none font-semibold text-slate-800">
              Debug: Plan Meta (Crew + Anchor Policy)
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <div className="font-semibold text-slate-800">meta.ideaDate.crewPolicy</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastCrewPolicy, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.ideaDate.anchorPolicy</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastAnchorPolicy, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.ideaDate.magicRefinement</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastMagicRefinement, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-800">meta.ideaDate.surpriseReport</div>
                <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] leading-snug text-slate-900">
                  {JSON.stringify(lastSurpriseReport, null, 2)}
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
              Current crew: <span className="font-semibold">{session.crew}</span>
            </p>
            <p>
              Current anchor: <span className="font-semibold">{selectedAnchorLabel}</span>
            </p>
            <p>
              Magic refinement: <span className="font-semibold">{session.magicRefinement ?? 'none'}</span>
            </p>
            <Link href={`/idea-date/${generatedPlanId}`} className="text-slate-900 underline">
              Open current plan
            </Link>
          </div>
        ) : null}

        {generatedPlanId ? (
          <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Magic Wand</p>
            <div className="grid grid-cols-2 gap-2">
              {MAGIC_REFINEMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleMagicRefinement(option.value, `Refined: ${option.label}.`)}
                  className={
                    session.magicRefinement === option.value
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
              onClick={() => handleMagicRefinement(null, 'Refinement cleared.')}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-50"
            >
              Clear refinement
            </button>
          </section>
        ) : null}

        {message ? <p className="text-xs text-slate-600">{message}</p> : null}

        <button
          type="button"
          onClick={handleStartNewNight}
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800"
        >
          Start New Night
        </button>
      </div>
    </main>
  );
}
