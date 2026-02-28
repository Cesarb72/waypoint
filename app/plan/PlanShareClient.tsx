'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createPlanFromTemplatePlan,
  deserializePlan,
  type Plan,
  type Stop,
} from '../plan-engine';
import { ctaClass } from '../ui/cta';
import { isPlanShared, markPlanShared, upsertRecentPlan } from '../utils/planStorage';
import { withPreservedModeParam } from '../lib/entryMode';
import { useSession } from '../auth/SessionProvider';
import { createPlan } from '../lib/planRepository';
import { logEvent } from '../lib/planEvents';
import {
  getStopAddress,
  getStopMapTarget,
  getStopMapHref,
  getStopWebsiteHref,
  hasStopMapTarget,
  normalizeStop,
} from '@/lib/stopLocation';

type PlanBrand = {
  name?: string;
  accent?: string;
  logoUrl?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

function sanitizeOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    if (!raw.startsWith('/')) return null; // same-origin only
    const url = new URL(raw, 'http://example.com');
    url.searchParams.delete('origin'); // prevent nesting
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

function sanitizeReturnTo(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    if (!raw.startsWith('/')) return null;
    const url = new URL(raw, 'http://example.com');
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

function sanitizeLogoUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeAccentColor(value?: string | null): string | null {
  if (!value) return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  const token = trimmed.toLowerCase();
  const TOKEN_MAP: Record<string, string> = {
    slate: '#94a3b8',
    blue: '#38bdf8',
    emerald: '#34d399',
    violet: '#a78bfa',
    amber: '#fbbf24',
  };
  if (TOKEN_MAP[token]) return TOKEN_MAP[token];
  if (trimmed.startsWith('#')) trimmed = trimmed.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    trimmed = trimmed
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

function sanitizeCtaUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getNormalizedBrand(plan: Plan | null): PlanBrand | null {
  if (!plan) return null;
  if (plan.brand) return plan.brand;
  const presentedBy = plan.presentation?.presentedBy?.trim();
  const logoUrl = plan.presentation?.logoUrl?.trim();
  const accent = plan.presentation?.accent?.trim();
  const legacyBranding = plan.presentation?.branding;
  const legacyName = legacyBranding?.name?.trim();
  const legacyLogo = legacyBranding?.logoUrl?.trim();
  const legacyAccent = legacyBranding?.accentColor?.trim();
  if (!presentedBy && !logoUrl && !accent && !legacyName && !legacyLogo && !legacyAccent) {
    return null;
  }
  return {
    name: legacyName ?? presentedBy ?? undefined,
    byline: presentedBy ?? undefined,
    logoUrl: legacyLogo ?? logoUrl ?? undefined,
    accent: legacyAccent ?? accent ?? undefined,
  };
}

function shortenAddress(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed.split(',')[0]?.trim();
  return first || trimmed;
}

function formatStopRole(role?: Stop['role']): string {
  if (!role) return '';
  if (role === 'anchor') return 'Anchor';
  if (role === 'support') return 'Support';
  return 'Optional';
}

function formatRating(placeLite?: Stop['placeLite'] | null): string | null {
  const rating = placeLite?.rating;
  if (rating === undefined) return null;
  const count = placeLite?.userRatingsTotal;
  return `Rating ${rating.toFixed(1)}${count ? ` (${count.toLocaleString()})` : ''}`;
}

export default function PlanShareClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const encoded = searchParams.get('p');
  const debugEnabled = searchParams.get('debug') === '1';
  const origin = useMemo(() => sanitizeOrigin(searchParams.get('origin')), [searchParams]);
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('returnTo')),
    [searchParams]
  );
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [isSharedOverride, setIsSharedOverride] = useState(false);
  const [showMoreShare, setShowMoreShare] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const loggedShareRef = useRef<string | null>(null);

  const { plan, error } = useMemo(() => {
    if (!encoded) return { plan: null, error: null };
    try {
      return { plan: deserializePlan(encoded), error: null };
    } catch (err) {
      return { plan: null, error: (err as Error).message };
    }
  }, [encoded]);
  const planOwnerId = plan?.owner?.id ?? plan?.ownerId ?? null;
  const editPolicy = plan?.editPolicy ?? 'owner_only';
  const isOwner = !!userId && !!planOwnerId && planOwnerId === userId;
  const canEdit = isOwner && (editPolicy === 'owner_only' || editPolicy === 'fork_required');
  const backHref = useMemo(() => {
    let nextHref = '/';
    if (returnTo) {
      nextHref = returnTo;
    } else if (origin) {
      nextHref = origin;
    }
    return withPreservedModeParam(nextHref, searchParams);
  }, [origin, returnTo, searchParams]);
  const originKind = useMemo(() => {
    if (returnTo) return 'returnTo';
    if (origin) return 'origin';
    return 'default';
  }, [origin, returnTo]);

  const openInPlanHref = useMemo(() => {
    if (!plan?.id) return null;
    return withPreservedModeParam(`/plans/${plan.id}`, searchParams);
  }, [plan, searchParams]);

  const sharePath = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('p', encoded);
    return `/plan?${params.toString()}`;
  }, [encoded]);

  const shareFullUrl = useMemo(() => {
    if (!sharePath) return null;
    return typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath;
  }, [sharePath]);

  const embedPath = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('p', encoded);
    params.set('embed', '1');
    return `/embed?${params.toString()}`;
  }, [encoded]);

  const embedFullUrl = useMemo(() => {
    if (!embedPath) return null;
    return typeof window !== 'undefined' ? `${window.location.origin}${embedPath}` : embedPath;
  }, [embedPath]);
  const normalizedStops = useMemo(
    () => (plan?.stops ?? []).map((stop) => normalizeStop(stop).stop),
    [plan]
  );
  const hasMissingMapTarget = useMemo(
    () => normalizedStops.some((stop) => !hasStopMapTarget(stop)),
    [normalizedStops]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration gate
    setHasHydrated(true);
  }, []);
  useEffect(() => {
    if (!plan?.id) return;
    if (loggedShareRef.current === plan.id) return;
    loggedShareRef.current = plan.id;
    void logEvent('share_viewed', { planId: plan.id, templateId: plan.template_id ?? null });
  }, [plan?.id]);

  const isSharedClient =
    !!hasHydrated &&
    !!plan?.id &&
    (isSharedOverride || isPlanShared(plan.id));

  const handleCopyPlan = useCallback(async () => {
    if (!plan) return;
    const nextPlan = createPlanFromTemplatePlan(plan);
    const result = await createPlan(nextPlan, {
      userId,
      editPolicy: 'owner_only',
      originKind: plan.origin?.kind ?? plan.meta?.origin?.kind,
    });
    const finalPlan = result.ok ? result.plan : nextPlan;
    void logEvent('plan_forked', {
      planId: finalPlan.id,
      templateId: finalPlan.template_id ?? null,
      payload: { sourcePlanId: plan.id },
    });
    upsertRecentPlan(finalPlan);
    router.push(`/plans/${finalPlan.id}`);
  }, [plan, router, userId]);

  async function handleCopyShare() {
    if (!shareFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(shareFullUrl);
      if (plan?.id) {
        markPlanShared(plan.id);
        setIsSharedOverride(true);
      }
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 1500);
    } catch {
      // ignore
    }
  }

  async function handleCopyEmbed() {
    if (!embedFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(embedFullUrl);
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 1500);
    } catch {
      // ignore
    }
  }

  if (!encoded) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="px-4 pt-4">
          <Link href={withPreservedModeParam('/', searchParams)} className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-3 max-w-sm">
            <h1 className="text-lg font-semibold">No plan selected</h1>
            <p className="text-sm text-slate-400">This link is missing a plan.</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="px-4 pt-4">
          <Link href={withPreservedModeParam('/', searchParams)} className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-2 max-w-sm">
            <h1 className="text-lg font-semibold">This plan link looks invalid or incomplete.</h1>
            <p className="text-sm text-slate-400">Please check the shared link and try again.</p>
          </div>
        </div>
      </main>
    );
  }

  const title = plan?.title?.trim() || 'Untitled plan';
  const whenLabel = plan?.constraints?.timeWindow?.trim() || '';
  const intent = plan?.intent?.trim() || '';
  const audience = plan?.audience?.trim() || '';
  const brand = getNormalizedBrand(plan);
  const brandName = brand?.name?.trim() || '';
  const brandLogo = sanitizeLogoUrl(brand?.logoUrl);
  const brandAccent = sanitizeAccentColor(brand?.accent);
  const brandByline = brand?.byline?.trim() || '';
  const brandCtaLabel = brand?.ctaLabel?.trim() || '';
  const brandCtaUrl = sanitizeCtaUrl(brand?.ctaUrl);
  const brandBylineText =
    brandByline || (brandName ? `Presented by ${brandName}` : '');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="px-4 pt-4">
        <Link href={backHref} className={ctaClass('chip')}>
          Back
        </Link>
      </div>
      <div className="px-4 pb-16">
        <div className="mx-auto max-w-2xl space-y-8">
          <header className="pt-4 space-y-4">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span
                className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/60 px-2 py-1"
                style={brandAccent ? { borderColor: brandAccent } : undefined}
              >
                Shared plan
              </span>
              <span>Read-only. Copy to edit.</span>
            </div>
            <div
              className={`flex items-start gap-3 ${
                brandAccent ? 'border-l-2 pl-3' : ''
              }`}
              style={brandAccent ? { borderColor: brandAccent } : undefined}
            >
              {brandLogo ? (
                // eslint-disable-next-line @next/next/no-img-element -- small branding mark
                <img
                  src={brandLogo}
                  alt={brandName ? `${brandName} logo` : 'Brand logo'}
                  className="h-10 w-10 rounded-lg border border-slate-800 object-cover"
                />
              ) : null}
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                  {title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  {whenLabel ? (
                    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1">
                      {whenLabel}
                    </span>
                  ) : null}
                  {audience ? (
                    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1">
                      For: {audience}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {intent ? (
              <p className="text-base text-slate-200 leading-relaxed max-w-xl">
                {intent}
              </p>
            ) : null}
            {brandBylineText ? (
              <p className="text-sm text-slate-400 truncate">{brandBylineText}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && plan?.id ? (
                <Link
                  href={`/plans/${plan.id}`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:text-slate-50"
                >
                  Open in Waypoint
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleCopyPlan}
                  style={brandAccent ? { boxShadow: `0 0 0 1px ${brandAccent}` } : undefined}
                  className="inline-flex items-center justify-center rounded-full bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Copy to edit
                </button>
              )}
              {brandCtaLabel && brandCtaUrl ? (
                <a
                  href={brandCtaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-sm text-slate-300 hover:text-slate-100"
                >
                  {brandCtaLabel}
                </a>
              ) : null}
            </div>
          </header>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300">Stops</h2>
            {hasMissingMapTarget ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Some stops are missing location data. Open in Waypoint to finish.</span>
                  {openInPlanHref ? (
                    <Link
                      href={openInPlanHref}
                      className="inline-flex items-center rounded-full border border-amber-300/50 px-3 py-1 text-xs font-semibold text-amber-100 hover:text-amber-50"
                    >
                      Open in Waypoint
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
            <ol className="space-y-3">
              {normalizedStops.map((stop, index) => {
                const stopAny = stop as Stop & Record<string, unknown>;
                const addressLine = getStopAddress(stopAny);
                const addressShort = shortenAddress(addressLine);
                const mapHref = getStopMapHref(stopAny);
                const websiteHref = getStopWebsiteHref(stopAny);
                const ratingLabel = formatRating(stop.placeLite);
                const showMeta = Boolean(addressShort || mapHref || websiteHref || ratingLabel);
                return (
                  <li key={stop.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                        <span>Stop {index + 1}</span>
                        {stop.role ? <span>{formatStopRole(stop.role)}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {stop.placeLite?.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- small preview
                          <img
                            src={stop.placeLite.photoUrl}
                            alt=""
                            className="h-10 w-10 rounded-lg border border-slate-800 object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <div className="text-base font-semibold text-slate-50 truncate">
                          {stop.name}
                        </div>
                      </div>
                      {showMeta ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
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
                          {addressShort ? (
                            <span className="truncate">{addressShort}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {shareFullUrl ? (
                <button
                  type="button"
                  onClick={handleCopyShare}
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:text-slate-50"
                >
                  Copy share link
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowMoreShare((prev) => !prev)}
                className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                More
              </button>
              {hasHydrated && isSharedClient ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                  Shared
                </span>
              ) : null}
              {shareStatus === 'copied' ? (
                <span className="text-[11px] text-emerald-200">Link copied.</span>
              ) : null}
            </div>
            {showMoreShare && embedFullUrl ? (
              <div>
                <button
                  type="button"
                  onClick={handleCopyEmbed}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Copy embed link
                </button>
              </div>
            ) : null}
          </section>
          {debugEnabled ? (
            <details className="pt-2 text-[10px] text-slate-500">
              <summary className="cursor-pointer">
                Debug: origin.kind {originKind}, brand present? {brand ? 'yes' : 'no'},
                presentation present? {plan?.presentation ? 'yes' : 'no'}
              </summary>
              <div className="mt-2 space-y-1">
                <div>
                  brand keys:{' '}
                  {(brand ? Object.keys(brand) : []).join(', ') || 'none'}
                </div>
                <div>
                  presentation keys:{' '}
                  {(plan?.presentation ? Object.keys(plan.presentation) : []).join(', ') ||
                    'none'}
                </div>
                {normalizedStops.map((stop, idx) => {
                  const placeRef = stop.placeRef ?? {};
                  const hasPlaceId = Boolean(placeRef.placeId);
                  const mapTarget = getStopMapTarget(stop);
                  const mapTargetKind =
                    mapTarget?.kind === 'mapsUrl' ? 'url' : mapTarget?.kind ?? 'none';
                  const hasPlaceLite = Boolean(stop.placeLite);
                  const address = getStopAddress(stop);
                  return (
                    <div key={stop.id}>
                      stop {idx + 1} ({stop.role}): placeId {hasPlaceId ? 'yes' : 'no'},
                      mapTarget {mapTargetKind}, placeLite{' '}
                      {hasPlaceLite ? 'yes' : 'no'}, address {address ? 'yes' : 'no'}{' '}
                      placeRef[
                      id:{placeRef.placeId ? 'y' : 'n'}; latLng:
                      {placeRef.latLng ? 'y' : 'n'}; mapsUrl:{placeRef.mapsUrl ? 'y' : 'n'};
                      websiteUrl:{placeRef.websiteUrl ? 'y' : 'n'}; label:
                      {placeRef.label ? 'y' : 'n'}]
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </main>
  );
}
