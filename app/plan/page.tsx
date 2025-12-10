'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  upsertPlan,
  type StoredStop,
  type StoredPlan,
  loadPlanById,
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
};

// Helper to create a new stop with a unique-ish id
function createStop(label: string = 'Main stop'): Stop {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
  const waypointLocationParam = params.get('location') ?? '';
  const derivedLocation = waypointLocationParam || waypointName || '';

  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 🧪 Validation state
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
          title: stored.title,
          date: stored.date,
          time: stored.time,
          attendees: stored.attendees ?? '',
          notes: stored.notes ?? '',
          stops:
            stored.stops && stored.stops.length > 0
              ? stored.stops.map((s) => ({
                  id: s.id ?? createStop().id,
                  label: s.label,
                  notes: s.notes,
                  time: s.time,
                }))
              : [createStop('Main stop')],
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
      stops: [createStop('Main stop')],
    });
    setInitialized(true);
  }, [initialized, urlPlanId, waypointName]);

  function updateField<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    if (!plan) return;
    setPlan((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateStop(stopId: string, partial: Partial<Stop>) {
    if (!plan) return;
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
    if (!plan) return;
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
    if (!plan) return;
    setPlan((prev) => {
      if (!prev) return prev;
      const remaining = prev.stops.filter((s) => s.id !== stopId);
      return {
        ...prev,
        stops: remaining.length > 0 ? remaining : [createStop('Main stop')],
      };
    });
  }

  function moveStop(stopId: string, direction: 'up' | 'down') {
    if (!plan) return;
    setPlan((prev) => {
      if (!prev) return prev;
      const index = prev.stops.findIndex((s) => s.id === stopId);
      if (index === -1) return prev;

      const newStops = [...prev.stops];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newStops.length) {
        return prev;
      }

      const temp = newStops[index];
      newStops[index] = newStops[targetIndex];
      newStops[targetIndex] = temp;

      return { ...prev, stops: newStops };
    });
  }

  if (!plan) {
    // Very brief loading state while we derive the plan
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

  // 🔧 Shared helper to turn PlanDraft into StoredPlan input
  function buildStoredInputFromDraft(draft: PlanDraft): {
    title: string;
    date: string;
    time: string;
    attendees?: string;
    notes?: string;
    stops: StoredStop[];
    location?: string;
    id?: string;
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
      location: derivedLocation || undefined,
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setHasTriedSubmit(true);

    if (!isCoreInfoValid) {
      // Let the inline validation + banner guide the user
      return;
    }

    setIsSaving(true);

    const storedInput = buildStoredInputFromDraft(plan);
    const saved: StoredPlan = upsertPlan(storedInput);
    setPlanId(saved.id);

    // Small delay just to feel responsive (optional)
    await new Promise((resolve) => setTimeout(resolve, 200));

    setIsSaving(false);

    // Redirect to home with a "saved" flag so home can show confirmation
    router.push('/?saved=1');
  }

  async function handleShareClick() {
    setHasTriedSubmit(true);

    if (!isCoreInfoValid) {
      window.alert('Please set a date and time before sharing this plan.');
      return;
    }

    setIsSaving(true);

    const storedInput = buildStoredInputFromDraft(plan);
    const saved: StoredPlan = upsertPlan(storedInput);
    setPlanId(saved.id);

    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const shareUrl = `${origin}/p/${saved.id}`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // If clipboard fails, we just skip it silently.
    }

    setIsSaving(false);

    // ✅ Take the user to the shared plan page so they can visually confirm it
    router.push(`/p/${saved.id}`);
  }

  const mapLocation = derivedLocation || plan.title || '';

  const mapHref =
    mapLocation.length > 0
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          mapLocation
        )}`
      : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Simple top nav back to home */}
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

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Create a plan</h1>
          <p className="text-sm text-slate-400">
            Set the basics, then define each stop of your night.
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
          {/* Core plan details */}
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
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  value={plan.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 ${
                    hasTriedSubmit && !isDateValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400 bg-slate-950'
                      : 'border-slate-700 bg-slate-950 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                  required
                />
                {hasTriedSubmit && !isDateValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a date for this plan.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="time">
                  Time
                </label>
                <input
                  id="time"
                  type="time"
                  value={plan.time}
                  onChange={(e) => updateField('time', e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 ${
                    hasTriedSubmit && !isTimeValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400 bg-slate-950'
                      : 'border-slate-700 bg-slate-950 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                  required
                />
                {hasTriedSubmit && !isTimeValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a time for this plan.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="attendees">
                Who&apos;s coming? (optional)
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

          {/* Map preview (lightweight, future-proof) */}
          {mapHref && (
            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Map preview</h2>
                  <p className="text-xs text-slate-400">
                    Quick link to see this plan&apos;s starting area in Google Maps.
                  </p>
                </div>
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-sky-500/70 bg-sky-600/20 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-600/30"
                >
                  Open in Maps
                </a>
              </div>

              <div className="mt-2 h-32 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center px-4 text-[11px] text-slate-500 text-center">
                A small map embed will live here in a future version. For now, use the
                button above to open Google Maps for{' '}
                <span className="text-slate-300 font-medium">{mapLocation}</span>.
              </div>
            </section>
          )}

          {/* Multi-stop section */}
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
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
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
              disabled={isSaving || !isCoreInfoValid}
              className="rounded-lg border border-violet-400/70 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-50 hover:bg-violet-500/40 disabled:opacity-60"
            >
              {isSaving ? 'Sharing…' : 'Share plan'}
            </button>
            <button
              type="submit"
              disabled={isSaving || !isCoreInfoValid}
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
