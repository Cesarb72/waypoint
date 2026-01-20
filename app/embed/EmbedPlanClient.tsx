'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { deserializePlan, type Plan } from '../plan-engine';
import { getAttribution } from '../utils/attribution';
import { getBrandingLite } from '../utils/branding';
import { getPlansIndex } from '../utils/planStorage';

type ResolvedPlan = {
  plan: Plan | null;
  encoded: string | null;
  error: string | null;
};

function decodePlan(encoded: string): { plan: Plan | null; error: string | null } {
  try {
    return { plan: deserializePlan(encoded), error: null };
  } catch (err) {
    return { plan: null, error: (err as Error).message || 'Invalid plan data.' };
  }
}

function resolvePlan(encodedParam: string | null, planIdParam: string | null): ResolvedPlan {
  if (encodedParam) {
    const { plan, error } = decodePlan(encodedParam);
    return { plan, encoded: encodedParam, error };
  }

  if (planIdParam) {
    const match = getPlansIndex().find((item) => item.id === planIdParam);
    if (!match?.encoded) return { plan: null, encoded: null, error: null };
    const { plan, error } = decodePlan(match.encoded);
    return { plan, encoded: match.encoded, error };
  }

  return { plan: null, encoded: null, error: null };
}

export default function EmbedPlanClient() {
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const { plan, encoded, error } = useMemo(() => {
    const encodedParam = searchParams.get('p');
    const planIdParam = searchParams.get('planId');
    return resolvePlan(encodedParam, planIdParam);
  }, [searchKey, searchParams]);

  const openHref = useMemo(() => {
    if (!encoded) return '/';
    return `/create?from=${encodeURIComponent(encoded)}`;
  }, [encoded]);
  const attribution = useMemo(
    () => (plan ? getAttribution(plan, { surface: 'embed', mode: 'view' }) : null),
    [plan]
  );
  const branding = useMemo(() => (plan ? getBrandingLite(plan) : null), [plan]);

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-md px-4 py-10">
          <div className="space-y-3 text-center">
            <h1 className="text-lg font-semibold">This plan link looks invalid or incomplete.</h1>
            <p className="text-sm text-slate-400">Please check the embed link and try again.</p>
            <Link href={openHref} className="text-sm text-sky-300 hover:text-sky-200">
              Open in Waypoint
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-md px-4 py-10">
          <div className="space-y-3 text-center">
            <h1 className="text-lg font-semibold">No plan found.</h1>
            <p className="text-sm text-slate-400">
              This embed needs a valid plan link. Try opening the plan in Waypoint first.
            </p>
            <Link href={openHref} className="text-sm text-sky-300 hover:text-sky-200">
              Open in Waypoint
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-md px-4 py-6 space-y-6">
        <header className="space-y-2">
          {attribution ? (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                {attribution.headline}
              </p>
              {branding ? (
                <div
                  className={`flex flex-wrap items-center gap-2 text-xs text-slate-300 border-l-2 pl-3 ${branding.accentLineClass ?? 'border-l-slate-800'}`}
                >
                  {branding.logoUrl ? (
                    <img
                      src={branding.logoUrl}
                      alt={branding.presentedBy ?? 'Logo'}
                      className="h-6 w-auto max-w-[140px] rounded-sm border border-slate-800 bg-slate-900/60 px-1"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                  <span className="truncate">
                    Presented by{branding.presentedBy ? ` ${branding.presentedBy}` : ''}
                  </span>
                  {branding.accent && branding.accentClass ? (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${branding.accentClass}`}
                    >
                      {branding.accent}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <p className="text-xs text-slate-400">
                {attribution.byline} · {attribution.provenance}
              </p>
              <p className="text-[11px] text-slate-500">{attribution.modeHint}</p>
            </div>
          ) : null}
          <p className="text-[11px] text-slate-400">Read-only preview</p>
          <h1 className="text-xl font-semibold text-slate-50">{plan.title || 'Untitled plan'}</h1>
          {plan.intent ? <p className="text-sm text-slate-300">{plan.intent}</p> : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stops</h2>
          {plan.stops.length === 0 ? (
            <p className="text-sm text-slate-400">No stops yet.</p>
          ) : (
            <ol className="space-y-3">
              {plan.stops.map((stop, index) => (
                <li
                  key={stop.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-100">
                        {stop.name || `Stop ${index + 1}`}
                      </p>
                      {stop.location ? (
                        <p className="text-xs text-slate-400">{stop.location}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px] text-slate-300">
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5">
                        {stop.role}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5">
                        {stop.optionality}
                      </span>
                      {stop.duration ? (
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5">
                          {stop.duration}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {stop.notes ? (
                    <p className="text-xs text-slate-300 whitespace-pre-line">{stop.notes}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="pt-3 border-t border-slate-800">
          <Link href={openHref} className="text-sm text-sky-300 hover:text-sky-200">
            Open in Waypoint
          </Link>
        </div>
      </div>
    </main>
  );
}
