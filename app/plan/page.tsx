'use client';

import { useState } from 'react';

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

type StoredPlan = {
  id: string;
  title: string;
  date: string;
  time: string;
  attendees: string;
  notes: string;
  stops: Stop[];
  createdAt: string;
};

// Helper to create a new stop with a unique-ish id
function createStop(label: string = 'Stop') {
  return {
    id: crypto.randomUUID(),
    label,
    notes: '',
    time: '',
  } as Stop;
}

// Helper to save a plan into localStorage "waypoint:plans"
function savePlanToLocalStorage(draft: PlanDraft): string {
  if (typeof window === 'undefined') return '';

  const id = crypto.randomUUID();
  const storedPlan: StoredPlan = {
    id,
    title: draft.title || 'Untitled plan',
    date: draft.date,
    time: draft.time,
    attendees: draft.attendees,
    notes: draft.notes,
    stops: draft.stops,
    createdAt: new Date().toISOString(),
  };

  const raw = window.localStorage.getItem('waypoint:plans');
  const existing: StoredPlan[] = raw ? JSON.parse(raw) : [];

  // Newest first
  const updated = [storedPlan, ...existing];

  window.localStorage.setItem('waypoint:plans', JSON.stringify(updated));
  window.localStorage.setItem('waypoint:lastSavedPlanId', id);

  return id;
}

export default function PlanPage() {
  const [plan, setPlan] = useState<PlanDraft>({
    title: '',
    date: '',
    time: '',
    attendees: '',
    notes: '',
    stops: [createStop('Main stop')],
  });

  const [isSaving, setIsSaving] = useState(false);

  function updateField<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setPlan((prev) => ({ ...prev, [key]: value }));
  }

  function updateStop(stopId: string, partial: Partial<Stop>) {
    setPlan((prev) => ({
      ...prev,
      stops: prev.stops.map((stop) =>
        stop.id === stopId ? { ...stop, ...partial } : stop
      ),
    }));
  }

  function addStop() {
    setPlan((prev) => ({
      ...prev,
      stops: [...prev.stops, createStop(`Stop ${prev.stops.length + 1}`)],
    }));
  }

  function removeStop(stopId: string) {
    setPlan((prev) => {
      const remaining = prev.stops.filter((s) => s.id !== stopId);
      // Always keep at least one stop
      return {
        ...prev,
        stops: remaining.length > 0 ? remaining : [createStop('Main stop')],
      };
    });
  }

  function moveStop(stopId: string, direction: 'up' | 'down') {
    setPlan((prev) => {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    try {
      const id = savePlanToLocalStorage(plan);
      console.log('Saved plan with id:', id, 'data:', plan);

      // For now we stay on this page and just show a confirmation.
      // Next step: hook this into the home "Recent plans" view.
      alert('Plan saved locally. We’ll wire this into Recent plans next.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Create a plan</h1>
          <p className="text-sm text-slate-400">
            Set the basics, then define each stop of your night.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                  required
                />
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                  required
                />
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

          {/* Multi-stop section */}
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Stops</h2>
                <p className="text-xs text-slate-400">
                  Break the night into simple stops: drinks, dinner, dessert,
                  scenic walk…
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
              onClick={() => history.back()}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
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
