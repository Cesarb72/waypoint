'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Plan } from '@/lib/planTypes';
import { loadPlanById } from '@/lib/planStorage';
import { buildGoogleCalendarLink } from '@/lib/calendarLinks';

export default function SharedPlanPage() {
  const params = useParams();
  const router = useRouter();
  const planIdParam = params?.planId;

  const planId =
    typeof planIdParam === 'string'
      ? planIdParam
      : Array.isArray(planIdParam)
      ? planIdParam[0]
      : '';

  const [plan, setPlan] = useState<Plan | null>(null);
  const [calendarLink, setCalendarLink] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!planId) {
      setIsLoading(false);
      return;
    }

    const found = loadPlanById(planId);

    if (!found) {
      setPlan(null);
      setIsLoading(false);
      return;
    }

    setPlan(found);
    setCalendarLink(buildGoogleCalendarLink(found));
    setIsLoading(false);
  }, [planId]);

  const mapQuery = plan?.location || plan?.title || '';
  const hasMapQuery = mapQuery.trim().length > 0;

  const mapsUrl = hasMapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        mapQuery
      )}`
    : null;

  const mapsEmbedUrl = hasMapQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
    : null;

  function getReadableDateTime() {
    if (!plan?.dateTime) return 'No time set yet';

    const d = new Date(plan.dateTime);
    if (Number.isNaN(d.getTime())) return 'No time set yet';

    return d.toLocaleString();
  }

  function handleBackHome() {
    router.push('/');
  }

  function handleEditInWaypoint() {
    if (!plan) return;
    router.push(`/plan?planId=${encodeURIComponent(plan.id)}`);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8 flex flex-col items-center">
      <div className="w-full max-w-xl space-y-5">
        <button
          type="button"
          onClick={handleBackHome}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to Waypoint</span>
        </button>

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Shared plan</h1>
          <p className="text-sm text-slate-400">
            A read-only summary of this plan, with quick links to Calendar and Maps.
          </p>
          <p className="text-[11px] text-slate-500">
            For now this link only works on the device where the plan was created, until we add
            cloud sync.
          </p>
        </header>

        {isLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
            Loading plan…
          </div>
        )}

        {!isLoading && !plan && (
          <div className="space-y-3">
            <div className="rounded-xl border border-red-600/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              We couldn&apos;t find this plan on this device. It may have been created in a
              different browser or cleared from storage.
            </div>
            <button
              type="button"
              onClick={handleBackHome}
              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800"
            >
              Go to discovery
            </button>
          </div>
        )}

        {!isLoading && plan && (
          <>
            {/* Plan summary */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4 space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-50">{plan.title}</h2>
                <p className="text-xs text-slate-400">{plan.location}</p>
              </div>

              <div className="space-y-1 text-xs text-slate-300">
                <p>
                  <span className="font-semibold text-slate-100">When: </span>
                  {getReadableDateTime()}
                </p>
                {plan.attendees && (
                  <p>
                    <span className="font-semibold text-slate-100">Who: </span>
                    {plan.attendees}
                  </p>
                )}
                {plan.notes && (
                  <p className="mt-1">
                    <span className="font-semibold text-slate-100">Notes: </span>
                    <span className="whitespace-pre-line">{plan.notes}</span>
                  </p>
                )}
              </div>
            </section>

            {/* Map preview */}
            {mapsEmbedUrl && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-200">Map preview</p>
                    <p className="text-[11px] text-slate-500">
                      Approximate location based on this plan.
                    </p>
                  </div>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-sky-500/70 bg-sky-600/20 px-2 py-1 text-[10px] font-medium text-sky-50 hover:bg-sky-600/30"
                    >
                      Open in Maps
                    </a>
                  )}
                </div>
                <div className="h-56 w-full border-t border-slate-800">
                  <iframe
                    title={`Map preview for ${plan.title}`}
                    src={mapsEmbedUrl}
                    className="h-full w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </section>
            )}

            {/* Actions */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 space-y-2">
              <p className="text-[11px] text-slate-300">
                You can add this to your calendar, open it in Maps, or jump into edit mode inside
                Waypoint.
              </p>
              <div className="flex flex-wrap gap-2">
                {calendarLink && (
                  <a
                    href={calendarLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border border-emerald-400/70 bg-emerald-500/20 px-3 py-1 text-[11px] font-medium text-emerald-50 hover:bg-emerald-500/30"
                  >
                    Add to Google Calendar
                  </a>
                )}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border border-sky-400/70 bg-sky-500/20 px-3 py-1 text-[11px] font-medium text-sky-50 hover:bg-sky-500/30"
                  >
                    Open in Maps
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleEditInWaypoint}
                  className="inline-flex rounded-lg border border-slate-600/70 bg-slate-800/50 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-800"
                >
                  Edit in Waypoint
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
