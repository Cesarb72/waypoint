'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createEmptyPlan,
  createPlanFromTemplate,
  deserializePlan,
  serializePlan,
  type Plan,
  type Stop,
  validatePlan,
} from '../plan-engine';
import {
  getPlansIndex,
  setSavedById,
  upsertRecentPlan,
  isPlanShared,
  markPlanShared,
} from '../utils/planStorage';
import { PLAN_TEMPLATES } from '../templates/planTemplates';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';

type Props = {
  fromEncoded?: string;
  sourceTitle?: string;
  sourceEncoded?: string;
  originUrl?: string;
};

type VariationOption = {
  id: string;
  label: string;
  detail: string;
  plan: Plan;
};

export default function CreatePlanClient({ fromEncoded, sourceTitle, sourceEncoded, originUrl }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [plan, setPlan] = useState<Plan>(() =>
    createEmptyPlan({
      title: 'New plan',
      intent: 'What do we want to accomplish?',
      audience: 'me-and-friends',
    })
  );
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [hasShared, setHasShared] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isCommitted, setIsCommitted] = useState(false);
  const [commitStatus, setCommitStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [userId, setUserId] = useState<string | null>(null);
  const [sourceExistsInSupabase, setSourceExistsInSupabase] = useState(false);
  const [sourceOwnedByUser, setSourceOwnedByUser] = useState(false);
  const [showCopyNotice, setShowCopyNotice] = useState(false);
  const [planHydratedFromSource, setPlanHydratedFromSource] = useState(!fromEncoded);
  const [variationOptions, setVariationOptions] = useState<VariationOption[]>([]);
  const [showVariations, setShowVariations] = useState(false);
  const hasPrefilledFromSource = useRef(false);

  useEffect(() => {
    setHasShared(isPlanShared(plan.id));
  }, [plan.id]);

  function clonePlanForVariation(base: Plan): Plan {
    const cloned = createPlanFromTemplate(base);
    cloned.stops = cloned.stops.map((stop) => ({ ...stop }));
    cloned.constraints = cloned.constraints ? { ...cloned.constraints } : undefined;
    cloned.signals = cloned.signals ? { ...cloned.signals } : undefined;
    cloned.context = cloned.context ? { ...cloned.context } : undefined;
    cloned.metadata = cloned.metadata ? { ...cloned.metadata } : undefined;
    return cloned;
  }

  function generateVariationOptions(base: Plan): VariationOption[] {
    const options: VariationOption[] = [];
    const anchorName = base.stops.find((s) => s.role === 'anchor')?.name || 'anchor stop';
    const audience = base.audience || 'your crew';

    const timestamp = new Date().toISOString();

    const addOption = (
      id: string,
      label: string,
      detail: string,
      mutate: (draft: Plan) => void
    ) => {
      const draft = clonePlanForVariation(base);
      mutate(draft);
      draft.metadata = {
        ...draft.metadata,
        lastUpdated: timestamp,
      };
      options.push({ id, label, detail, plan: draft });
    };

    addOption(
      'budget-friendly',
      'Budget-friendly',
      'Keep it wallet-light while staying together.',
      (draft) => {
        draft.constraints = { ...draft.constraints, budgetRange: 'Keep it affordable' };
        draft.context = { ...draft.context, localNote: 'Choose budget-friendly options.' };
      }
    );

    addOption(
      'earlier-start',
      'Earlier start',
      `Start earlier so ${audience} has buffer.`,
      (draft) => {
        draft.constraints = { ...draft.constraints, timeWindow: 'Start 45-60 minutes earlier' };
        draft.signals = { ...draft.signals, flexibility: 'tight' };
      }
    );

    addOption(
      'outdoor-shift',
      'Outdoor shift',
      `Lean outdoors for the ${anchorName}.`,
      (draft) => {
        if (draft.stops.length > 0) {
          draft.stops[0] = {
            ...draft.stops[0],
            notes: `${draft.stops[0].notes ?? ''} Try an outdoor-friendly version.`.trim(),
          };
        }
        draft.constraints = { ...draft.constraints, mobility: draft.constraints?.mobility ?? 'easy' };
        draft.context = { ...draft.context, localNote: 'If weather is decent, pick an outdoor spot.' };
      }
    );

    return options.slice(0, 3);
  }

  const getVariationKeys = useCallback(
    (planId: string) => ({
      seen: `variation_seen_${planId}`,
      dismissed: `variation_dismissed_${planId}`,
    }),
    []
  );

  const sourcePlanId = useMemo(() => {
    if (!sourceEncoded) return null;
    try {
      return deserializePlan(sourceEncoded).id || null;
    } catch {
      return null;
    }
  }, [sourceEncoded]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const existing = getPlansIndex().find((item) => item.id === plan.id);
    setIsSaved(existing?.isSaved ?? false);
    setIsCommitted(!!existing);
  }, [plan.id]);
  useEffect(() => {
    if (!fromEncoded) return;
    setSourceExistsInSupabase(false);
    setSourceOwnedByUser(false);
    let cancelled = false;

    (async () => {
      try {
        const decoded = deserializePlan(fromEncoded);
        if (sourcePlanId) {
          const { data: existing } = await supabase
            .from('waypoints')
            .select('id,owner_id')
            .eq('id', sourcePlanId)
            .limit(1);
          if (cancelled) return;
          const exists = !!existing && existing.length > 0;
          const owned = exists && existing?.[0]?.owner_id === userId;
          setSourceExistsInSupabase(exists);
          setSourceOwnedByUser(owned);
          if (owned) {
            setPlan(decoded);
            setPlanHydratedFromSource(true);
            return;
          }
        }
        if (cancelled) return;
        setPlan(createPlanFromTemplate(decoded));
        setPlanHydratedFromSource(true);
      } catch {
        // ignore invalid payloads
        setPlanHydratedFromSource(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromEncoded, sourcePlanId, supabase, userId]);

  useEffect(() => {
    if (!fromEncoded) {
      setPlanHydratedFromSource(true);
    }
  }, [fromEncoded]);

  const validation = useMemo(() => validatePlan(plan), [plan]);

  const encodedPath = useMemo(() => {
    try {
      return `/plan?p=${encodeURIComponent(serializePlan(plan))}`;
    } catch {
      return '';
    }
  }, [plan]);

  const encodedFullUrl = useMemo(() => {
    if (!encodedPath) return '';
    return typeof window !== 'undefined'
      ? `${window.location.origin}${encodedPath}`
      : encodedPath;
  }, [encodedPath]);

  const sourceLink = useMemo(() => {
    if (!sourceEncoded) return '';
    try {
      return `/plan?p=${encodeURIComponent(sourceEncoded)}`;
    } catch {
      return '';
    }
  }, [sourceEncoded]);

  useEffect(() => {
    if (!fromEncoded) return;
    setShowCopyNotice(true);
  }, [fromEncoded]);

  useEffect(() => {
    // Ensure source-driven plans have a meaningful title/anchor stop when they arrive
    if (!planHydratedFromSource || hasPrefilledFromSource.current) return;
    let nextPlan = plan;
    let updated = false;
    const hasTitle = (nextPlan.title ?? '').trim().length > 0;
    if (!hasTitle) {
      nextPlan = {
        ...nextPlan,
        title: 'Waypoint idea',
        intent: nextPlan.intent || 'Start with this setup.',
      };
      updated = true;
    }
    if (!nextPlan.stops || nextPlan.stops.length === 0) {
      const anchorStop: Stop = {
        id: generateStopId(),
        name: nextPlan.title || 'Anchor stop',
        role: 'anchor',
        optionality: 'required',
        notes: nextPlan.intent || 'Kick things off here.',
      };
      nextPlan = { ...nextPlan, stops: [anchorStop] };
      updated = true;
    }
    if (updated) {
      setPlan(nextPlan);
    }
    hasPrefilledFromSource.current = true;
  }, [plan, planHydratedFromSource]);

  useEffect(() => {
    hasPrefilledFromSource.current = false;
  }, [plan.id]);

  function generateStopId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `stop_${Math.random().toString(36).slice(2, 8)}`;
  }

  function updateStop(id: string, updater: (stop: Stop) => Stop) {
    setPlan((prev) => ({
      ...prev,
      stops: prev.stops.map((stop) => (stop.id === id ? updater(stop) : stop)),
    }));
  }

  function removeStop(id: string) {
    setPlan((prev) => ({
      ...prev,
      stops: prev.stops.filter((stop) => stop.id !== id),
    }));
  }

  function addStop() {
    setPlan((prev) => ({
      ...prev,
      stops: [
        ...prev.stops,
        {
          id: generateStopId(),
          name: 'New stop',
          role: 'support',
          optionality: 'flexible',
        },
      ],
    }));
  }

  async function handleOpenShare() {
    if (!encodedPath) return;
    await syncIfCommitted(plan);
    const url = `${encodedPath}&fromEdit=true`;
    router.push(url);
  }

  function handleReturnToOriginal() {
    if (originUrl) {
      router.push(originUrl);
      return;
    }
    if (sourceLink) {
      router.push(sourceLink);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  }

  async function handleCopyShare() {
    if (!encodedFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await syncIfCommitted(plan);
      await navigator.clipboard.writeText(encodedFullUrl);
      markPlanShared(plan.id);
      setShareStatus('copied');
      setHasShared(true);
      setTimeout(() => setShareStatus('idle'), 1500);
    } catch {
      // ignore copy errors in this lightweight UI
    }
  }

  function moveStopUp(index: number) {
    setPlan((prev) => {
      if (index <= 0) return prev;
      const nextStops = [...prev.stops];
      const temp = nextStops[index - 1];
      nextStops[index - 1] = nextStops[index];
      nextStops[index] = temp;
      return { ...prev, stops: nextStops };
    });
  }

  function moveStopDown(index: number) {
    setPlan((prev) => {
      if (index >= prev.stops.length - 1) return prev;
      const nextStops = [...prev.stops];
      const temp = nextStops[index + 1];
      nextStops[index + 1] = nextStops[index];
      nextStops[index] = temp;
      return { ...prev, stops: nextStops };
    });
  }

  const syncIfCommitted = useCallback(
    async (nextPlan: Plan) => {
      if (!isCommitted) return;
      const saved = upsertRecentPlan(nextPlan);
      setIsSaved(saved.isSaved);
      if (!userId) return;
      try {
        const parentId =
          sourceExistsInSupabase && sourcePlanId && sourcePlanId !== nextPlan.id
            ? sourcePlanId
            : null;
        await supabase.from('waypoints').upsert(
          {
            id: nextPlan.id,
            owner_id: userId,
            title: nextPlan.title || 'Waypoint',
            plan: nextPlan,
            parent_id: parentId,
          },
          { onConflict: 'id' }
        );
      } catch {
        // ignore persistence errors to keep UI lightweight
      }
    },
    [isCommitted, sourceExistsInSupabase, sourcePlanId, supabase, userId]
  );

  const handleCommitPlan = useCallback(async () => {
    setCommitStatus('saving');
    try {
      const saved = upsertRecentPlan(plan);
      setIsSaved(saved.isSaved);
      if (userId) {
        const parentId =
          sourceExistsInSupabase && sourcePlanId && sourcePlanId !== plan.id
            ? sourcePlanId
            : null;
        await supabase.from('waypoints').upsert(
          {
            id: plan.id,
            owner_id: userId,
            title: plan.title || 'Waypoint',
            plan,
            parent_id: parentId,
          },
          { onConflict: 'id' }
        );
      }
      setIsCommitted(true);
      setCommitStatus('done');
      setTimeout(() => setCommitStatus('idle'), 1200);
    } catch {
      setCommitStatus('error');
      setTimeout(() => setCommitStatus('idle'), 1500);
    }
  }, [plan, sourceExistsInSupabase, sourcePlanId, supabase, userId]);

  useEffect(() => {
    if (!isCommitted) return;
    void syncIfCommitted(plan);
  }, [isCommitted, plan, syncIfCommitted]);

  useEffect(() => {
    if (!fromEncoded) return;
    if (!planHydratedFromSource) return;
    if (!plan.id) return;
    if (typeof window === 'undefined') return;
    const { seen, dismissed } = getVariationKeys(plan.id);
    if (window.localStorage.getItem(dismissed) === '1') return;
    if (window.localStorage.getItem(seen) === '1') return;

    const options = generateVariationOptions(plan);
    if (options.length === 0) return;
    setVariationOptions(options);
    setShowVariations(true);
    window.localStorage.setItem(seen, '1');
  }, [fromEncoded, getVariationKeys, plan, planHydratedFromSource]);

  const handleDismissVariations = useCallback(() => {
    if (typeof window !== 'undefined' && plan.id) {
      const { dismissed } = getVariationKeys(plan.id);
      window.localStorage.setItem(dismissed, '1');
    }
    setShowVariations(false);
    setVariationOptions([]);
  }, [getVariationKeys, plan.id]);

  const handleUseVariation = useCallback(
    async (option: VariationOption) => {
      handleDismissVariations();
      const nextPlan = createPlanFromTemplate(option.plan);
      nextPlan.stops = nextPlan.stops.map((stop) => ({ ...stop }));
      nextPlan.constraints = nextPlan.constraints ? { ...nextPlan.constraints } : undefined;
      nextPlan.signals = nextPlan.signals ? { ...nextPlan.signals } : undefined;
      nextPlan.context = nextPlan.context ? { ...nextPlan.context } : undefined;
      nextPlan.metadata = nextPlan.metadata ? { ...nextPlan.metadata } : undefined;
      setIsCommitted(false);
      setIsSaved(false);
      const encoded = serializePlan(nextPlan);
      router.push(`/create?from=${encodeURIComponent(encoded)}`);
    },
    [handleDismissVariations, router]
  );

  const hasAnchor = plan.stops.some((stop) => stop.role === 'anchor');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Create a Waypoint</h1>
          <p className="text-sm text-slate-400">
            Draft a shareable plan your crew can react to; everything here is a safe, revisable draft.
          </p>
          {showCopyNotice ? (
            <p className="text-xs text-slate-400">
              You’re editing your version of this plan.
            </p>
          ) : null}
          {!fromEncoded ? (
            <p className="text-xs text-slate-500">You're editing your Waypoint.</p>
          ) : null}
        </header>

        {fromEncoded ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                You're editing a copy of{' '}
                <span className="font-semibold text-slate-50">
                  {sourceTitle ?? 'Unknown plan'}
                </span>
                . Changes here won't affect the original.
              </span>
              <div className="flex items-center gap-3 text-[11px]">
                <button type="button" onClick={handleReturnToOriginal} className={ctaClass('chip')}>
                  Back to original
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-200">Ways to begin</h2>
            <p className="text-[11px] text-slate-500">
              Pick an idea to start or apply a quick tweak—it all rolls into the same plan.
            </p>
          </div>

          {showVariations && variationOptions.length > 0 && (
            <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-100">Quick tweaks for this plan</p>
                  <p className="text-[11px] text-slate-500">Small adjustments before you share.</p>
                </div>
                <button
                  type="button"
                  onClick={handleDismissVariations}
                  className={`${ctaClass('chip')} text-[11px]`}
                >
                  Dismiss
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {variationOptions.map((option) => (
                  <div
                    key={option.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 space-y-2"
                  >
                    <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                    <p className="text-[11px] text-slate-400">{option.detail}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUseVariation(option)}
                        className={`${ctaClass('primary')} text-[11px]`}
                      >
                        Use this idea
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissVariations}
                        className={`${ctaClass('chip')} text-[11px]`}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {PLAN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setPlan(createPlanFromTemplate(tpl.prefill))}
                  className={`${ctaClass('chip')} min-w-[180px] text-left text-xs`}
                >
                  <div className="font-semibold text-slate-100">{tpl.label}</div>
                  {tpl.description ? (
                    <p className="text-[11px] text-slate-400">{tpl.description}</p>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-title">
              Title
            </label>
            <input
              id="plan-title"
              type="text"
              value={plan.title}
              onChange={(e) =>
                setPlan((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-intent">
              Intent
            </label>
            <p className="text-xs text-slate-500">One clear sentence about what this plan is for.</p>
            <input
              id="plan-intent"
              type="text"
              value={plan.intent}
              onChange={(e) =>
                setPlan((prev) => ({
                  ...prev,
                  intent: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="plan-audience">
              Audience
            </label>
            <input
              id="plan-audience"
              type="text"
              value={plan.audience}
              onChange={(e) =>
                setPlan((prev) => ({
                  ...prev,
                  audience: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Plan stops</h2>
            <button
              type="button"
              onClick={addStop}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-750"
            >
              Add stop
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Anchor is the must-do stop; Support fills in around it. Optional stops are nice-to-haves.
          </p>
          {!hasAnchor && plan.stops.length > 0 && (
            <p className="text-xs text-amber-300">
              Add one anchor: the main stop everything else is planned around.
            </p>
          )}

          {plan.stops.length === 0 ? (
            <p className="text-sm text-slate-400">No stops yet. Add one to get started.</p>
          ) : (
            <ol className="space-y-3">
              {plan.stops.map((stop, index) => (
                <li
                  key={stop.id}
                  className={`rounded-lg border border-slate-800 px-3 py-3 space-y-3 ${
                    stop.role === 'anchor' ? 'bg-slate-900/80 border-sky-700/60' : 'bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Stop {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStop(stop.id)}
                      className="text-[11px] text-rose-300 hover:text-rose-100"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex gap-2 text-[11px] text-slate-200">
                    {stop.role === 'anchor' && (
                      <span className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100">
                        Anchor
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => moveStopUp(index)}
                      disabled={index === 0}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                    >
                      ↑ Move up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStopDown(index)}
                      disabled={index === plan.stops.length - 1}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                    >
                      ↓ Move down
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-name-${stop.id}`}>
                        Name
                      </label>
                      <input
                        id={`stop-name-${stop.id}`}
                        type="text"
                        value={stop.name}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-location-${stop.id}`}>
                        Location
                      </label>
                      <input
                        id={`stop-location-${stop.id}`}
                        type="text"
                        value={stop.location ?? ''}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => {
                            const raw = e.target.value;
                            const trimmed = raw.trim();
                            return { ...prev, location: trimmed === '' ? undefined : raw };
                          })
                        }
                        placeholder="e.g. 123 Main St, San Jose or Dolores Park"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-duration-${stop.id}`}>
                        Duration (optional)
                      </label>
                      <input
                        id={`stop-duration-${stop.id}`}
                        type="text"
                        value={stop.duration ?? ''}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({ ...prev, duration: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-slate-200" htmlFor={`stop-role-${stop.id}`}>
                        Role
                      </label>
                      <p className="text-[11px] text-slate-500">
                        How this stop supports the plan: Anchor = must-hit, Support = nice-to-have.
                      </p>
                      <select
                        id={`stop-role-${stop.id}`}
                        value={stop.role}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({
                            ...prev,
                            role: e.target.value as Stop['role'],
                          }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="anchor">anchor</option>
                        <option value="support">support</option>
                        <option value="optional">optional</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label
                        className="text-sm text-slate-200"
                        htmlFor={`stop-optionality-${stop.id}`}
                      >
                        Flexibility
                      </label>
                      <p className="text-[11px] text-slate-500">
                        How easy this stop is to swap or skip if needed.
                      </p>
                      <select
                        id={`stop-optionality-${stop.id}`}
                        value={stop.optionality}
                        onChange={(e) =>
                          updateStop(stop.id, (prev) => ({
                            ...prev,
                            optionality: e.target.value as Stop['optionality'],
                          }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="required">required</option>
                        <option value="flexible">flexible</option>
                      <option value="fallback">fallback</option>
                    </select>
                    <p className="text-[11px] text-slate-500">
                      Your backup move if this stop doesn’t work out.
                    </p>
                  </div>
                </div>

                  <div className="space-y-1">
                    <label className="text-sm text-slate-200" htmlFor={`stop-notes-${stop.id}`}>
                      Notes (optional)
                    </label>
                    <textarea
                      id={`stop-notes-${stop.id}`}
                      value={stop.notes ?? ''}
                      onChange={(e) =>
                        updateStop(stop.id, (prev) => ({ ...prev, notes: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      rows={3}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCommitPlan()}
                disabled={isCommitted || commitStatus === 'saving'}
                className={`${ctaClass('primary')} text-[11px] disabled:opacity-60`}
              >
                {isCommitted ? 'Plan committed' : 'Commit plan to Waypoints'}
              </button>
              <button
                type="button"
                onClick={handleOpenShare}
                className={`${ctaClass('chip')} text-[11px]`}
                disabled={!encodedPath}
              >
                Preview share link
              </button>
              <button
                type="button"
                onClick={handleCopyShare}
                className={`${ctaClass('primary')} text-[11px]`}
                disabled={!encodedFullUrl}
              >
                Share this version
              </button>
              {hasShared ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                  Shared
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              {commitStatus === 'error' && <span className="text-rose-200">Commit failed. Try again.</span>}
              {commitStatus === 'done' && <span className="text-emerald-200">Committed.</span>}
              {shareStatus === 'copied' && <span className="text-emerald-200">Link copied.</span>}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Drafts stay here until you commit. Only committed plans show up in Your Waypoints.
          </p>
          <p className="text-xs text-slate-400">
            Shared links are read-only snapshots for coordination - come back anytime to edit and re-share.
          </p>
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <label className={`${ctaClass('chip')} gap-2 text-sm text-slate-200`}>
              <input
                type="checkbox"
                checked={isSaved}
                disabled={!isCommitted}
                onChange={(e) => {
                  const next = e.target.checked;
                  const ok = setSavedById(plan.id, next);
                  if (ok) setIsSaved(next);
                  void syncIfCommitted(plan);
                }}
              />
              Saved
            </label>
            {!isCommitted && (
              <span className="text-[11px] text-slate-400">Commit first to save to Waypoints.</span>
            )}
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs space-y-1">
            {validation.issues.length === 0 ? (
              <div className="text-emerald-200 font-semibold">Ready to share</div>
            ) : (
              <>
                <div className="text-amber-200 font-semibold">
                  {validation.issues.length} thing{validation.issues.length === 1 ? '' : 's'} to
                  consider
                </div>
                <ul className="space-y-1 text-slate-200">
                  {validation.issues.slice(0, 2).map((issue) => (
                    <li key={issue.code}>
                      • {issue.message}
                      {issue.path ? ` (${issue.path})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}


