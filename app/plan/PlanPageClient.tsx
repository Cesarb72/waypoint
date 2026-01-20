'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  upsertPlan,
  type StoredStop,
  type StoredPlan,
  loadPlanById,
  updatePlanChosen,
  updatePlanOutcome,
  updatePlanSentiment,
  updatePlanFeedbackNotes,
} from '@/lib/planStorage';

type Stop = {
  id: string;
  label: string;
  notes?: string;
  time?: string;
};

type PlanDraft = {
  title: string;
  date: string;
  time: string;
  attendees: string;
  notes: string;
  stops: Stop[];
  chosen: boolean;
  chosenAt: string | null;
  completed: boolean | null;
  completedAt: string | null;
  sentiment: 'good' | 'meh' | 'bad' | null;
  feedbackNotes: string | null;
};

// Helper to create a new stop with a unique-ish id
function createStop(label: string = 'Main stop'): Stop {
  return {
    id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    label,
    notes: '',
    time: '',
  };
}

export default function PlanPage() {
  const router = useRouter();
  const params = useSearchParams();

  const urlPlanId = params.get('planId');
  const waypointName = params.get('name') ?? '';
  const waypointLocation = params.get('location') ?? '';

  // Prefer explicit location, fall back to name
  const inferredLocation = useMemo(() => {
    return waypointLocation?.trim() || waypointName?.trim() || '';
  }, [waypointLocation, waypointName]);

  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const loggedRouteRef = useRef(false);
  const loggedPlanRef = useRef<string | null>(null);
  const loggedOriginPlanRef = useRef<string | null>(null);
  const feedbackLimit = 280;
  const sentimentLabel =
    plan?.sentiment === 'good' ? 'Good' : plan?.sentiment === 'meh' ? 'Meh' : plan?.sentiment === 'bad' ? 'Bad' : null;

  // Validation state
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  // 🔄 Initialize from:
  // - existing plan (edit flow, via ?planId=...)
  // - or new plan with waypoint name as title
  useEffect(() => {
    if (initialized) return;

    if (urlPlanId) {
      const stored = loadPlanById(urlPlanId);
      if (stored) {
        setPlanId(stored.id);

        setPlan({
          title: stored.title ?? '',
          date: stored.date ?? '',
          time: stored.time ?? '',
          attendees: stored.attendees ?? '',
          notes: stored.notes ?? '',
          chosen: stored.chosen ?? false,
          chosenAt: stored.chosenAt ?? null,
          completed: stored.completed ?? null,
          completedAt: stored.completedAt ?? null,
          sentiment: stored.sentiment ?? null,
          feedbackNotes: stored.feedbackNotes ?? null,
          stops:
            stored.stops && stored.stops.length > 0
              ? stored.stops.map((s) => ({
                  id:
                    s.id ??
                    (typeof crypto !== 'undefined'
                      ? crypto.randomUUID()
                      : `${Date.now()}-${Math.random()}`),
                  label: s.label ?? '',
                  notes: s.notes ?? '',
                  time: s.time ?? '',
                }))
              : [createStop(stored.location || waypointName || 'Main stop')],
        });

        setInitialized(true);
        return;
      }
    }

    // New plan case
    setPlan({
      title: waypointName || '',
      date: '',
      time: '',
      attendees: '',
      notes: '',
      chosen: false,
      chosenAt: null,
      completed: null,
      completedAt: null,
      sentiment: null,
      feedbackNotes: null,
      // Auto-fill Stop #1 label with selected entity name (or fallback)
      stops: [createStop(waypointName || 'Main stop')],
    });

    setInitialized(true);
  }, [initialized, urlPlanId, waypointName]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (loggedRouteRef.current) return;
    loggedRouteRef.current = true;
    console.log('[origin2] plan route mounted', {
      pathname: typeof window !== 'undefined' ? window.location.pathname : '/plan',
      searchParams: params.toString(),
      planId: urlPlanId ?? null,
    });
  }, [params, urlPlanId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!plan) return;
    const logKey = planId ?? 'new';
    if (loggedPlanRef.current === logKey) return;
    loggedPlanRef.current = logKey;
    const planAny = plan as unknown as { meta?: { origin?: unknown }; origin?: unknown };
    console.log('[origin2] editor loaded plan', {
      planId: planId ?? null,
      origin: planAny.meta?.origin ?? planAny.origin ?? null,
    });
  }, [plan, planId]);

  useEffect(() => {
    if (!plan) return;
    const logKey = planId ?? 'new';
    if (loggedOriginPlanRef.current === logKey) return;
    loggedOriginPlanRef.current = logKey;
    const planAny = plan as unknown as {
      meta?: { origin?: unknown };
      origin?: unknown;
    };
    console.log('[origin2] editor loaded', {
      planId: planId ?? null,
      origin: planAny.meta?.origin ?? planAny.origin ?? null,
    });
  }, [plan, planId]);

  function updateField<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setPlan((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateStop(stopId: string, partial: Partial<Stop>) {
    setPlan((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            stops: prev.stops.map((stop) =>
              stop.id === stopId ? { ...stop, ...partial } : stop
            ),
          }
    );
  }

  function addStop() {
    setPlan((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            stops: [...prev.stops, createStop(`Stop ${prev.stops.length + 1}`)],
          }
    );
  }

  function removeStop(stopId: string) {
    setPlan((prev) => {
      if (!prev) return prev;
      const remaining = prev.stops.filter((s) => s.id !== stopId);
      return {
        ...prev,
        stops: remaining.length > 0 ? remaining : [createStop(waypointName || 'Main stop')],
      };
    });
  }

  function moveStop(stopId: string, direction: 'up' | 'down') {
    setPlan((prev) => {
      if (!prev) return prev;

      const index = prev.stops.findIndex((s) => s.id === stopId);
      if (index === -1) return prev;

      const newStops = [...prev.stops];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newStops.length) return prev;

      const temp = newStops[index];
      newStops[index] = newStops[targetIndex];
      newStops[targetIndex] = temp;

      return { ...prev, stops: newStops };
    });
  }

  if (!plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading plan…</p>
      </main>
    );
  }

  // ✅ Derived validation flags
  const isDateValid = plan.date.trim().length > 0;
  const isTimeValid = plan.time.trim().length > 0;
  const isCoreInfoValid = isDateValid && isTimeValid;

  // 🔧 Convert PlanDraft -> StoredPlan input
  function buildStoredInputFromDraft(draft: PlanDraft): {
    id?: string;
    title: string;
    date: string;
    time: string;
    attendees?: string;
    notes?: string;
    stops: StoredStop[];
    location?: string;
    chosen?: boolean;
    chosenAt?: string | null;
    completed?: boolean | null;
    completedAt?: string | null;
    sentiment?: 'good' | 'meh' | 'bad' | null;
    feedbackNotes?: string | null;
  } {
    const storedStops: StoredStop[] = draft.stops.map((s) => ({
      id: s.id,
      label: s.label,
      notes: s.notes,
      time: s.time,
    }));

    return {
      id: planId ?? undefined,
      title: draft.title || waypointName || 'Untitled plan',
      date: draft.date,
      time: draft.time,
      attendees: draft.attendees || '',
      notes: draft.notes || '',
      stops: storedStops,
      location: inferredLocation || undefined,
      chosen: draft.chosen,
      chosenAt: draft.chosenAt,
      completed: draft.completed,
      completedAt: draft.completedAt,
      sentiment: draft.sentiment,
      feedbackNotes: draft.feedbackNotes,
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setHasTriedSubmit(true);

    // ✅ Guard: prevents TS null errors AND runtime weirdness
    if (!plan) return;

    if (!isCoreInfoValid) return;

    setIsSaving(true);

    const storedInput = buildStoredInputFromDraft(plan);
    const saved: StoredPlan = upsertPlan(storedInput);
    setPlanId(saved.id);

    await new Promise((resolve) => setTimeout(resolve, 150));

    setIsSaving(false);
    router.push('/?saved=1');
  }

  async function handleShareClick() {
    setHasTriedSubmit(true);

    if (!plan) return;

    if (!isCoreInfoValid) {
      window.alert('Please set a date and time before sharing this plan.');
      return;
    }

    setIsSaving(true);

    const storedInput = buildStoredInputFromDraft(plan);
    const saved: StoredPlan = upsertPlan(storedInput);
    setPlanId(saved.id);

    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000';

    const shareUrl = `${origin}/p/${saved.id}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // ignore clipboard errors
    }

    setIsSaving(false);
    router.push(`/p/${saved.id}`);
  }

  // Map preview (no API key)
  const mapSrc = inferredLocation
    ? `https://www.google.com/maps?q=${encodeURIComponent(inferredLocation)}&output=embed`
    : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Top nav */}
        <header className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm text-slate-300 hover:text-teal-300"
          >
            ← Back to discovery
          </button>
          <span className="text-xs text-slate-500">Waypoint · Plan</span>
        </header>

        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Create a plan</h1>
            <button
              type="button"
              onClick={() => {
                const nextChosen = !plan.chosen;
                const nextChosenAt = nextChosen ? new Date().toISOString() : null;
                setPlan((prev) =>
                  prev
                    ? {
                        ...prev,
                        chosen: nextChosen,
                        chosenAt: nextChosenAt,
                      }
                    : prev
                );
                const activeId = planId ?? urlPlanId ?? null;
                if (activeId) {
                  updatePlanChosen(activeId, nextChosen, nextChosenAt);
                }
              }}
              aria-pressed={plan.chosen}
              className={`rounded-full border px-2 py-1 text-[11px] transition ${
                plan.chosen
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {plan.chosen ? 'Chosen' : 'Mark as chosen'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>Did this happen?</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const nextCompleted = true;
                  const nextCompletedAt = new Date().toISOString();
                  setPlan((prev) =>
                    prev
                      ? {
                          ...prev,
                          completed: nextCompleted,
                          completedAt: nextCompletedAt,
                        }
                      : prev
                  );
                  const activeId = planId ?? urlPlanId ?? null;
                  if (activeId) {
                    updatePlanOutcome(activeId, nextCompleted, nextCompletedAt);
                  }
                }}
                aria-pressed={plan.completed === true}
                className={`rounded-full border px-2 py-0.5 ${
                  plan.completed === true
                    ? 'border-slate-200 text-slate-100'
                    : 'border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextCompleted = false;
                  const nextCompletedAt = null;
                  setPlan((prev) =>
                    prev
                      ? {
                          ...prev,
                          completed: nextCompleted,
                          completedAt: nextCompletedAt,
                        }
                      : prev
                  );
                  const activeId = planId ?? urlPlanId ?? null;
                  if (activeId) {
                    updatePlanOutcome(activeId, nextCompleted, nextCompletedAt);
                  }
                }}
                aria-pressed={plan.completed === false}
                className={`rounded-full border px-2 py-0.5 ${
                  plan.completed === false
                    ? 'border-slate-200 text-slate-100'
                    : 'border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextCompleted = null;
                  const nextCompletedAt = null;
                  setPlan((prev) =>
                    prev
                      ? {
                          ...prev,
                          completed: nextCompleted,
                          completedAt: nextCompletedAt,
                        }
                      : prev
                  );
                  const activeId = planId ?? urlPlanId ?? null;
                  if (activeId) {
                    updatePlanOutcome(activeId, nextCompleted, nextCompletedAt);
                  }
                }}
                aria-pressed={plan.completed === null}
                className={`rounded-full border px-2 py-0.5 ${
                  plan.completed === null
                    ? 'border-slate-200 text-slate-100'
                    : 'border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Skip
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>How was it?</span>
            <div className="flex items-center gap-1">
              {(['good', 'meh', 'bad'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const nextSentiment = plan.sentiment === value ? null : value;
                    setPlan((prev) =>
                      prev
                        ? {
                            ...prev,
                            sentiment: nextSentiment,
                          }
                        : prev
                    );
                    const activeId = planId ?? urlPlanId ?? null;
                    if (activeId) {
                      updatePlanSentiment(activeId, nextSentiment);
                    }
                  }}
                  aria-pressed={plan.sentiment === value}
                  className={`rounded-full border px-2 py-0.5 capitalize ${
                    plan.sentiment === value
                      ? 'border-slate-200 text-slate-100'
                      : 'border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <label htmlFor="plan-feedback-notes">Notes (optional)</label>
              <span>
                {feedbackLimit - (plan.feedbackNotes?.length ?? 0)}
              </span>
            </div>
            <textarea
              id="plan-feedback-notes"
              value={plan.feedbackNotes ?? ''}
              onChange={(e) => {
                const raw = e.target.value.slice(0, feedbackLimit);
                const normalized = raw.trim() ? raw : null;
                const nextValue = normalized ?? '';
                setPlan((prev) =>
                  prev
                    ? {
                        ...prev,
                        feedbackNotes: nextValue,
                      }
                    : prev
                );
                const activeId = planId ?? urlPlanId ?? null;
                if (activeId) {
                  updatePlanFeedbackNotes(activeId, normalized);
                }
              }}
              maxLength={feedbackLimit}
              placeholder="Private notes for this plan..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600"
            />
          </div>
          {plan.chosen || plan.completed === true || sentimentLabel ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
              {plan.chosen ? (
                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                  Chosen
                </span>
              ) : null}
              {plan.completed === true ? (
                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                  Completed
                </span>
              ) : null}
              {sentimentLabel ? (
                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                  {sentimentLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          <p className="text-sm text-slate-400">
            Set the basics, then shape the night.
          </p>
        </header>

        {/* Validation banner */}
        {hasTriedSubmit && !isCoreInfoValid && (
          <div className="rounded-lg border border-amber-500/70 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            To save or share this plan, please add both a{' '}
            <span className="font-semibold">date</span> and{' '}
            <span className="font-semibold">time</span>.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Core details */}
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="title">
                Title (optional)
              </label>
              <input
                id="title"
                type="text"
                value={plan.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Date night, Birthday dinner, Anniversary..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="date">
                  Date <span className="text-xs text-slate-500">(required)</span>
                </label>
                <input
                  id="date"
                  type="date"
                  value={plan.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  required
                  style={{ colorScheme: 'dark' }} // ✅ makes picker icon visible
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 bg-slate-950 text-slate-100 ${
                    hasTriedSubmit && !isDateValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400'
                      : 'border-slate-700 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                />
                {hasTriedSubmit && !isDateValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a date for this plan.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="time">
                  Time <span className="text-xs text-slate-500">(required)</span>
                </label>
                <input
                  id="time"
                  type="time"
                  value={plan.time}
                  onChange={(e) => updateField('time', e.target.value)}
                  required
                  style={{ colorScheme: 'dark' }} // ✅ makes picker icon visible
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 bg-slate-950 text-slate-100 ${
                    hasTriedSubmit && !isTimeValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400'
                      : 'border-slate-700 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                />
                {hasTriedSubmit && !isTimeValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a time for this plan.
                  </p>
                )}
              </div>
            </div>

            {/* Map preview */}
            <div className="space-y-2 pt-1">
              <h2 className="text-sm font-semibold text-slate-100">Map Preview</h2>
              {mapSrc ? (
                <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950/40">
                  <iframe
                    title="Map preview"
                    src={mapSrc}
                    className="w-full h-[220px]"
                    loading="lazy"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No location available for map preview yet.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="attendees">
                Who’s coming? (optional)
              </label>
              <input
                id="attendees"
                type="text"
                value={plan.attendees}
                onChange={(e) => updateField('attendees', e.target.value)}
                placeholder="Alex, Sam, Taylor..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="notes">
                Notes (optional)
              </label>
              <textarea
                id="notes"
                value={plan.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="Parking tips, dress code, special occasion, etc."
                className="w-full min-h-[80px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </section>

          {/* Stops */}
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Stops</h2>
                <p className="text-xs text-slate-400">
                  Break the night into simple stops: drinks, dinner, dessert, scenic walk…
                </p>
              </div>
              <button
                type="button"
                onClick={addStop}
                className="inline-flex items-center rounded-lg border border-teal-500/70 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20"
              >
                + Add stop
              </button>
            </div>

            <div className="space-y-3">
              {plan.stops.map((stop, index) => (
                <div
                  key={stop.id}
                  className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-300">
                      Stop {index + 1}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 'up')}
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 'down')}
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                        disabled={index === plan.stops.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStop(stop.id)}
                        className="rounded-md border border-red-700/70 px-2 py-1 text-[10px] text-red-300 hover:bg-red-900/40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1.3fr,0.7fr] gap-3">
                    <div className="space-y-1.5">
                      <label
                        className="text-[11px] font-medium"
                        htmlFor={`stop-label-${stop.id}`}
                      >
                        Label
                      </label>
                      <input
                        id={`stop-label-${stop.id}`}
                        type="text"
                        value={stop.label}
                        onChange={(e) =>
                          updateStop(stop.id, { label: e.target.value })
                        }
                        placeholder="e.g. Drinks, Dinner, Dessert, Scenic viewpoint"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        className="text-[11px] font-medium"
                        htmlFor={`stop-time-${stop.id}`}
                      >
                        Time (optional)
                      </label>
                      <input
                        id={`stop-time-${stop.id}`}
                        type="time"
                        value={stop.time ?? ''}
                        onChange={(e) =>
                          updateStop(stop.id, { time: e.target.value })
                        }
                        style={{ colorScheme: 'dark' }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-[11px] font-medium"
                      htmlFor={`stop-notes-${stop.id}`}
                    >
                      Notes (optional)
                    </label>
                    <textarea
                      id={`stop-notes-${stop.id}`}
                      value={stop.notes ?? ''}
                      onChange={(e) =>
                        updateStop(stop.id, { notes: e.target.value })
                      }
                      placeholder="Parking, dress code, conversation idea, backup plan…"
                      className="w-full min-h-[60px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleShareClick}
              disabled={isSaving}
              className="rounded-lg border border-violet-400/70 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-50 hover:bg-violet-500/40 disabled:opacity-60"
            >
              {isSaving ? 'Sharing…' : 'Share this version'}
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
