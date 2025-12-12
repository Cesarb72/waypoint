// Waypoint V1 – Shared Plan Summary
// Read-only view for a plan stored in localStorage, reached from Details/Share.
// Part of the “V1 locked” flow. Changing how plan IDs are handled will affect links.
'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadPlanById, type StoredPlan, type StoredStop } from '@/lib/planStorage';

function formatTime12h(time?: string): string | null {
  if (!time) return null;

  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return time;

  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minuteStr} ${period}`;
}


type RouteParams = {
  planId: string;
};

type SharedPlanPageProps = {
  params: Promise<RouteParams>;
};

export default function SharedPlanPage({ params }: SharedPlanPageProps) {
  const router = useRouter();
  const { planId } = use(params);

  const [plan, setPlan] = useState<StoredPlan | null | 'loading'>('loading');

  // Load the plan from the dynamic route param
  useEffect(() => {
    const stored = loadPlanById(planId);
    setPlan(stored ?? null);
  }, [planId]);

  if (plan === 'loading') {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading plan…</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold text-slate-50">
            This plan could not be found
          </h1>
          <p className="text-sm text-slate-400">
            The link may be wrong, expired, or this plan was removed on this device.
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            ← Back to Waypoint
          </button>
        </div>
      </main>
    );
  }

const dateLabel = plan.date
  ? new Date(`${plan.date}T${plan.time || '00:00'}`).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: plan.time ? 'numeric' : undefined,
      minute: plan.time ? '2-digit' : undefined,
      hour12: true,
    })
  : 'Date not set';


  const stops: StoredStop[] = plan.stops ?? [];
  const primaryLocation = plan.location || plan.title || '';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Top bar */}
        <header className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm text-slate-300 hover:text-teal-300"
          >
            ← Back to Waypoint
          </button>
          <span className="text-xs text-slate-500">Shared plan</span>
        </header>

        {/* Title + basic meta */}
<section className="space-y-2">
  <h1 className="text-2xl font-semibold">
    {plan.title || plan.location || 'Untitled plan'}
  </h1>

  <p className="text-sm text-slate-400">
    {dateLabel}
    {plan.attendees && (
      <>
        {' '}
        · <span className="text-slate-300">{plan.attendees}</span>
      </>
    )}
  </p>

  <p className="text-xs text-slate-500">
    Starting area:{' '}
    <span className="text-slate-300">
      {plan.location ? plan.location : 'Not set'}
    </span>
  </p>
</section>


        {/* Map preview (real tiles via Google Maps embed) */}
        {primaryLocation && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-slate-100">Map preview</h2>
            <p className="text-xs text-slate-400">
              Approximate area around{' '}
              <span className="text-slate-200">{primaryLocation}</span>.
            </p>
            <div className="mt-2 aspect-[16/9] rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
              <iframe
                title={`Map of ${primaryLocation}`}
                src={`https://www.google.com/maps?q=${encodeURIComponent(
                  primaryLocation
                )}&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full border-0"
              />
            </div>
          </section>
        )}

        {/* Notes */}
        {plan.notes && plan.notes.trim().length > 0 && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-slate-100">Notes</h2>
            <p className="text-sm text-slate-300 whitespace-pre-line">{plan.notes}</p>
          </section>
        )}

        {/* Stops */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Stops</h2>
<span className="text-[11px] text-slate-500">
  {stops.length} stop{stops.length === 1 ? '' : 's'} · Reorder in planner if needed.
</span>

          </div>

          {stops.length === 0 && (
            <p className="text-xs text-slate-500">
              No stops have been added to this plan yet.
            </p>
          )}

          <ol className="space-y-3">
            {stops.map((stop, index) => (
              <li
                key={stop.id ?? `${index}`}
                className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-100">
                    {index + 1}. {stop.label || 'Untitled stop'}
                  </p>
                  {stop.time && (
                    <span className="text-[11px] rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">
                      {formatTime12h(stop.time)}
                    </span>
                  )}
                </div>
                {stop.notes && stop.notes.trim().length > 0 && (
                  <p className="text-xs text-slate-400 whitespace-pre-line">
                    {stop.notes}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3 pt-2">
          <p className="text-[11px] text-slate-500">
            This plan is stored on your device. If it was created elsewhere, make sure
            you&apos;re opening the link on the same browser.
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() =>
                router.push(`/plan?planId=${encodeURIComponent(plan.id)}`)
              }
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
Edit in planner
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

