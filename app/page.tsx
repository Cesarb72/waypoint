'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchEntities } from '@/lib/entitySource';
import type { Entity } from '@/data/entities';
import { buildPlanFromEntity, type Plan } from '@/lib/planTypes';
import { buildGoogleCalendarLink } from '@/lib/calendarLinks';

export default function PlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityId = searchParams.get('entityId');

  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);

  // Form fields
  const [dateTime, setDateTime] = useState('');
  const [attendees, setAttendees] = useState('');
  const [notes, setNotes] = useState('');

  // Load the entity
  useEffect(() => {
    async function load() {
      if (!entityId) return;

      const items = await fetchEntities();
      const match = items.find((e) => e.id === entityId) || null;

      setEntity(match);
      setLoading(false);
    }

    load();
  }, [entityId]);

  if (!entityId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <p className="text-lg">No waypoint selected.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 text-sky-400 underline"
          >
            Go back
          </button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        Loading waypoint...
      </main>
    );
  }

  if (!entity) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <p className="text-lg">Waypoint not found.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 text-sky-400 underline"
          >
            Go back
          </button>
        </div>
      </main>
    );
  }

  // Once plan is built → show confirmation screen
  if (plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-200 px-4 py-10 flex justify-center">
        <div className="w-full max-w-lg space-y-6">
          <h1 className="text-2xl font-semibold">Plan Created</h1>

          <p className="text-slate-400">
            Your plan is ready. Add it to your calendar or share details.
          </p>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
            <p className="text-sm"><strong>{plan.title}</strong></p>
            <p className="text-sm text-slate-400">
              {new Date(plan.dateTime).toLocaleString()}
            </p>
            {plan.notes && (
              <p className="text-xs text-slate-500 mt-1">Notes: {plan.notes}</p>
            )}
            <p className="text-xs text-slate-500">
              Attendees: {plan.attendees}
            </p>
          </div>

          <a
            href={plan.calendarLink}
            target="_blank"
            className="block w-full text-center bg-sky-600 hover:bg-sky-500 rounded-lg py-2 font-medium"
          >
            Add to Google Calendar
          </a>

          <button
            onClick={() => setPlan(null)}
            className="block w-full text-center bg-slate-800 hover:bg-slate-700 rounded-lg py-2 text-sm"
          >
            Create another plan
          </button>

          <button
            onClick={() => router.push('/')}
            className="block w-full text-center text-sky-400 text-sm underline"
          >
            Back home
          </button>
        </div>
      </main>
    );
  }

  // Main planning form
  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 px-4 py-10 flex justify-center">
      <div className="w-full max-w-lg space-y-8">
        <section>
          <h1 className="text-3xl font-semibold">{entity.name}</h1>
          <p className="text-sm text-slate-400 mt-2">{entity.description}</p>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm text-slate-400">Date & Time</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-slate-400">Attendees</label>
            <input
              type="text"
              placeholder="Me + someone"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-slate-400">Notes</label>
            <textarea
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={() => {
              const planObj = buildPlanFromEntity(
                entity,
                { dateTime, attendees, notes },
                undefined
              );

              const calendarLink = buildGoogleCalendarLink(planObj);
              setPlan({ ...planObj, calendarLink });
            }}
            className="w-full bg-sky-600 hover:bg-sky-500 rounded-lg py-2 font-medium"
          >
            Create Plan
          </button>

          <button
            onClick={() => router.push('/')}
            className="block w-full text-center text-slate-400 text-sm underline"
          >
            Cancel
          </button>
        </section>
      </div>
    </main>
  );
}
