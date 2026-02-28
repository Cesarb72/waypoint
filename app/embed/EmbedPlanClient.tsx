'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { deserializePlan, type Plan } from '../plan-engine';
import { getAttribution } from '../utils/attribution';
import { getBrandingLite } from '../utils/branding';
import { getPlansIndex } from '../utils/planStorage';
import {
  getStopAddress,
  getStopMapHref,
  getStopWebsiteHref,
  normalizeStop,
} from '@/lib/stopLocation';

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

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeLogoUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeAccentColor(value: string | null): string | null {
  if (!value) return null;
  const decoded = safeDecode(value) ?? '';
  let trimmed = decoded.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) {
    trimmed = trimmed.slice(1);
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    trimmed = trimmed
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

function sanitizeDescription(value: string | null): string | null {
  if (!value) return null;
  const decoded = safeDecode(value) ?? '';
  const trimmed = decoded.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 160) : null;
}

function formatRating(placeLite?: Plan['stops'][number]['placeLite'] | null): string | null {
  const rating = placeLite?.rating;
  if (rating === undefined) return null;
  const count = placeLite?.userRatingsTotal;
  return `Rating ${rating.toFixed(1)}${count ? ` (${count.toLocaleString()})` : ''}`;
}

export default function EmbedPlanClient() {
  const searchParams = useSearchParams();

  const { plan, encoded, error } = useMemo(() => {
    const encodedParam = searchParams.get('p');
    const planIdParam = searchParams.get('planId');
    return resolvePlan(encodedParam, planIdParam);
  }, [searchParams]);
  const logoOverride = useMemo(
    () => sanitizeLogoUrl(safeDecode(searchParams.get('logo'))),
    [searchParams]
  );
  const accentOverride = useMemo(
    () => sanitizeAccentColor(searchParams.get('accent')),
    [searchParams]
  );
  const descOverride = useMemo(
    () => sanitizeDescription(searchParams.get('desc')),
    [searchParams]
  );

  const openHref = useMemo(() => {
    if (!encoded) return '/';
    return `/create?from=${encodeURIComponent(encoded)}`;
  }, [encoded]);
  const attribution = useMemo(
    () => (plan ? getAttribution(plan, { surface: 'embed', mode: 'view' }) : null),
    [plan]
  );
  const branding = useMemo(() => (plan ? getBrandingLite(plan) : null), [plan]);
  const headerAccentStyle = accentOverride ? { borderTopColor: accentOverride } : undefined;
  const effectiveLogoUrl = logoOverride ?? branding?.logoUrl ?? null;
  const effectiveDescription = descOverride ?? plan?.context?.localNote ?? null;
  const normalizedStops = useMemo(
    () => (plan ? plan.stops.map((stop) => normalizeStop(stop).stop) : []),
    [plan]
  );

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
        <header className="space-y-2 border-t-2 border-slate-800 pt-3" style={headerAccentStyle}>
          {attribution ? (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                {attribution.headline}
              </p>
              {branding || effectiveLogoUrl ? (
                <div
                  className={`flex flex-wrap items-center gap-2 text-xs text-slate-300 border-l-2 pl-3 ${branding?.accentLineClass ?? 'border-l-slate-800'}`}
                >
                  {effectiveLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- branding logo is dynamic
                    <img
                      src={effectiveLogoUrl}
                      alt={branding?.presentedBy ?? 'Logo'}
                      className="h-6 w-auto max-w-[140px] rounded-sm border border-slate-800 bg-slate-900/60 px-1"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                  {branding?.presentedBy ? (
                    <span className="truncate">
                      Presented by{branding.presentedBy ? ` ${branding.presentedBy}` : ''}
                    </span>
                  ) : null}
                  {branding?.accent && branding?.accentClass ? (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${branding?.accentClass}`}
                    >
                      {branding?.accent}
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
          <h1 className="text-xl font-semibold text-slate-50">{plan.title || 'Untitled plan'}</h1>
          {effectiveDescription ? (
            <p className="text-sm text-slate-300">{effectiveDescription}</p>
          ) : null}
          {plan.intent ? <p className="text-sm text-slate-300">{plan.intent}</p> : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stops</h2>
          {plan.stops.length === 0 ? (
            <p className="text-sm text-slate-400">No stops yet.</p>
          ) : (
            <ol className="space-y-3">
              {normalizedStops.map((stop, index) => {
                const address = getStopAddress(stop);
                const mapHref = getStopMapHref(stop);
                const websiteHref = getStopWebsiteHref(stop);
                const ratingLabel = formatRating(stop.placeLite);
                return (
                <li
                  key={stop.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {stop.placeLite?.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- small preview
                          <img
                            src={stop.placeLite.photoUrl}
                            alt=""
                            className="h-9 w-9 rounded-md border border-slate-800 object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <p className="text-sm font-semibold text-slate-100 truncate">
                          {stop.name || `Stop ${index + 1}`}
                        </p>
                      </div>
                      {address ? (
                        <p className="text-xs text-slate-400">{address}</p>
                      ) : null}
                      {(mapHref || websiteHref || ratingLabel) ? (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          {mapHref ? (
                            <a
                              href={mapHref}
                              target="_blank"
                              rel="noreferrer"
                              className="text-teal-200 hover:text-teal-100"
                            >
                              Map
                            </a>
                          ) : null}
                          {websiteHref ? (
                            <a
                              href={websiteHref}
                              target="_blank"
                              rel="noreferrer"
                              className="text-teal-200 hover:text-teal-100"
                            >
                              Website
                            </a>
                          ) : null}
                          {ratingLabel ? <span>{ratingLabel}</span> : null}
                        </div>
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
              );
              })}
            </ol>
          )}
        </section>

        <div className="pt-3 border-t border-slate-800" />
      </div>
    </main>
  );
}
