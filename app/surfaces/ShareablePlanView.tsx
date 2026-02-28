'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback, useRef, type CSSProperties } from 'react';
import { serializePlan, type Plan, type Stop } from '../plan-engine';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import { CLOUD_PLANS_TABLE } from '../lib/cloudTables';
import { logEvent } from '../lib/planEvents';
import { getAttribution } from '../utils/attribution';
import { getBrandingLite } from '../utils/branding';
import {
  getAnchorWeight,
  getFallbackCoverage,
  getFlexibilityProfile,
  getChangeDistance,
} from '../utils/discoverySignals';
import {
  getStopAddress,
  getStopMapTarget,
  getStopMapHref,
  getStopWebsiteHref,
  hasStopMapTarget,
  normalizeStop,
} from '@/lib/stopLocation';

type VariationEntry = {
  id: string;
  title: string;
  plan: Plan;
  encoded: string | null;
  updatedAt?: string;
  isCurrent: boolean;
  isOriginal: boolean;
};

type ActionProps = {
  createCopyHref: string | null;
  shareFullUrl: string | null;
  onCopyShare: () => void;
  embedFullUrl?: string | null;
  onCopyEmbed?: () => void;
  isShared: boolean;
  shareStatus: 'idle' | 'copied';
};

type ShareConfig = {
  logoUrl?: string | null;
  accentColor?: string | null;
  description?: string | null;
};

type Props = {
  plan: Plan;
  isShared?: boolean;
  actions?: ActionProps;
  mode?: 'view' | 'edit';
  allowNavigation?: boolean;
  readOnly?: boolean;
  embed?: boolean;
  shareConfig?: ShareConfig;
  debug?: boolean;
};

function StopBadges({ stop }: { stop: Stop }) {
  return (
    <div className="flex gap-2 text-xs text-slate-300">
      <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
        {stop.role}
      </span>
      <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
        {stop.optionality}
      </span>
      {stop.duration ? (
        <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
          {stop.duration}
        </span>
      ) : null}
    </div>
  );
}

function ConstraintsSection({ plan }: { plan: Plan }) {
  const { constraints } = plan;
  if (
    !constraints ||
    (!constraints.timeWindow &&
      !constraints.budgetRange &&
      !constraints.mobility &&
      !constraints.energyLevel &&
      !constraints.accessibility)
  ) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-200">Constraints</h2>
      <ul className="space-y-1 text-sm text-slate-300">
        {constraints.timeWindow ? <li>Time window: {constraints.timeWindow}</li> : null}
        {constraints.budgetRange ? <li>Budget: {constraints.budgetRange}</li> : null}
        {constraints.mobility ? <li>Mobility: {constraints.mobility}</li> : null}
        {constraints.energyLevel ? <li>Energy: {constraints.energyLevel}</li> : null}
        {constraints.accessibility ? <li>Accessibility: {constraints.accessibility}</li> : null}
      </ul>
    </section>
  );
}

function SignalsSection({ plan }: { plan: Plan }) {
  const { signals } = plan;
  if (
    !signals ||
    (!signals.vibe && !signals.flexibility && !signals.commitment)
  ) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-200">Plan cues</h2>
      <ul className="space-y-1 text-sm text-slate-300">
        {signals.vibe ? <li>Vibe: {signals.vibe} mood</li> : null}
        {signals.flexibility ? <li>Flexibility: {signals.flexibility} timing</li> : null}
        {signals.commitment ? <li>Effort: {signals.commitment} commitment</li> : null}
      </ul>
    </section>
  );
}

function FooterSection({ plan }: { plan: Plan }) {
  const { metadata } = plan;
  if (
    !metadata ||
    (!metadata.createdBy && !metadata.createdFor && !metadata.lastUpdated)
  ) {
    return null;
  }

  return (
    <footer className="pt-4 border-t border-slate-800 text-sm text-slate-400 space-y-1">
      {metadata.createdBy ? <div>Created by: {metadata.createdBy}</div> : null}
      {metadata.createdFor ? <div>Created for: {metadata.createdFor}</div> : null}
      {metadata.lastUpdated ? <div>Last updated: {metadata.lastUpdated}</div> : null}
    </footer>
  );
}

function safeEncode(plan: Plan): string | null {
  try {
    return serializePlan(plan);
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

function sanitizeDescription(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, 160);
}

function shortenAddress(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed.split(',')[0]?.trim();
  return first || trimmed;
}

function formatRating(placeLite?: Stop['placeLite'] | null): string | null {
  const rating = placeLite?.rating;
  if (rating === undefined) return null;
  const count = placeLite?.userRatingsTotal;
  return `Rating ${rating.toFixed(1)}${count ? ` (${count.toLocaleString()})` : ''}`;
}

function DiscoveryStrip({
  plan,
  isShared,
  allowNavigation = true,
  readOnly = false,
}: {
  plan: Plan;
  isShared?: boolean;
  allowNavigation?: boolean;
  readOnly?: boolean;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [variations, setVariations] = useState<VariationEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [parentPlan, setParentPlan] = useState<Plan | null>(null);
  const [baseParentId, setBaseParentId] = useState<string | null>(null);
  void baseParentId;

  const loadVariations = useCallback(() => {
    let cancelled = false;
    async function run() {
      setIsLoading(true);
      try {
        const { data: currentRows, error: currentError } = await supabase
          .from(CLOUD_PLANS_TABLE)
          .select('id,plan_json,updated_at')
          .eq('id', plan.id)
          .limit(1);
        if (cancelled) return;
        if (currentError || !currentRows?.[0]?.plan_json) {
          setVariations([
            { id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: true },
          ]);
          setParentPlan(null);
          setBaseParentId(plan.id);
          setIsLoading(false);
          return;
        }

        const currentRow = currentRows[0];
        const rowPlan = currentRow.plan_json as Plan;
        setParentPlan(null);
        setBaseParentId(currentRow.id ?? plan.id);
        setVariations([
          {
            id: currentRow.id ?? plan.id,
            title: rowPlan.title || plan.title || 'Waypoint',
            plan: rowPlan,
            encoded: safeEncode(rowPlan),
            updatedAt: currentRow.updated_at,
            isCurrent: true,
            isOriginal: true,
          },
        ]);
      } catch {
        if (!cancelled) {
          setVariations([{ id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: true }]);
          setParentPlan(null);
          setBaseParentId(plan.id);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [plan, supabase]);

  useEffect(() => loadVariations(), [loadVariations]);

  const siblingEntries = useMemo(
    () => variations.filter((entry) => !entry.isCurrent),
    [variations]
  );

  const currentEntry = useMemo(
    () => variations.find((entry) => entry.isCurrent),
    [variations]
  );

  const variationCount = variations.length;
  const canToggle = variationCount > 1;

  const labelForEntry = (entry: VariationEntry): string => {
    if (entry.isOriginal) return 'Original';
    if (entry.title?.trim()) return entry.title;
    return 'Variation';
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {isShared ? 'Shared plan' : 'Plan context'}
          </p>
          <p className="text-sm text-slate-200">
            {isLoading
              ? 'Loading plan context...'
              : isShared
              ? 'This guide was shared with you.'
              : 'Track variations of this plan.'}
          </p>
        </div>
        {canToggle ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className={`${ctaClass('chip')} text-xs`}
            >
              {isOpen ? 'Hide other versions' : 'Show other versions'}
            </button>
          </div>
        ) : null}
      </div>

      {isOpen && canToggle ? (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-xs text-slate-400">Loading versions...</p>
          ) : (
            <>
              {currentEntry ? (
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-slate-50">
                          {labelForEntry(currentEntry)}
                        </p>
                        <p className="text-[11px] text-slate-400">Current plan</p>
                      </div>
                    </div>
                    {readOnly ? null : (
                      <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className={`${ctaClass('primary')} text-[11px]`}
                      >
                        Continue with this version
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-200">
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                      {getAnchorWeight(currentEntry.plan)}
                    </span>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                      {getFlexibilityProfile(currentEntry.plan)}
                    </span>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                      {getFallbackCoverage(currentEntry.plan)}
                    </span>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                      {getChangeDistance(currentEntry.plan, parentPlan)}
                    </span>
                  </div>
                </div>
              ) : null}

              {siblingEntries.length === 0 ? (
                <p className="text-xs text-slate-400">No additional versions to show.</p>
              ) : (
                siblingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-slate-50">
                          {labelForEntry(entry)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Updated {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'recently'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {allowNavigation && entry.encoded ? (
                          <a
                            href={`/plan?p=${encodeURIComponent(entry.encoded)}`}
                            className={`${ctaClass('chip')} text-[11px]`}
                          >
                            View this version
                          </a>
                        ) : (
                          <span
                            className={`${ctaClass('chip')} text-[11px] pointer-events-none opacity-60`}
                          >
                            View this version
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-200">
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                        {getAnchorWeight(entry.plan)}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                        {getFlexibilityProfile(entry.plan)}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                        {getFallbackCoverage(entry.plan)}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                        {getChangeDistance(entry.plan, parentPlan)}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {siblingEntries.length === 0 && !readOnly ? (
                <p className="text-[11px] text-slate-500">
                  Make your own copy to compare versions.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function ShareablePlanView({
  plan,
  isShared = false,
  actions,
  mode = 'view',
  allowNavigation = true,
  readOnly = false,
  embed = false,
  shareConfig,
  debug = false,
}: Props) {
  const loggedShareRef = useRef<string | null>(null);
  const normalizedStops = useMemo(
    () => plan.stops.map((stop) => normalizeStop(stop).stop),
    [plan]
  );

  useEffect(() => {
    if (!isShared || !plan?.id) return;
    if (loggedShareRef.current === plan.id) return;
    loggedShareRef.current = plan.id;
    void logEvent('share_viewed', { planId: plan.id, templateId: plan.template_id ?? null });
  }, [isShared, plan?.id]);
  const hasMissingMapTarget = useMemo(
    () => normalizedStops.some((stop) => !hasStopMapTarget(stop)),
    [normalizedStops]
  );
  const attribution = useMemo(
    () => getAttribution(plan, { surface: 'share', mode }),
    [plan, mode]
  );
  const branding = useMemo(() => getBrandingLite(plan), [plan]);
  const brandingLogoUrl = branding?.logoUrl ?? null;
  const effectiveLogoUrl = sanitizeLogoUrl(shareConfig?.logoUrl) ?? brandingLogoUrl;
  const accentHex = sanitizeAccentColor(shareConfig?.accentColor);
  const descriptionFromPlan = sanitizeDescription(plan.context?.localNote);
  const effectiveDescription =
    sanitizeDescription(shareConfig?.description) ?? descriptionFromPlan;
  const templateBadge = plan.isTemplate
    ? 'Template'
    : plan.createdFrom?.kind === 'template'
      ? 'From template'
      : null;
  const districtContext = plan.context?.district;
  const districtLabel = districtContext?.label?.trim();
  const districtName = districtContext?.name?.trim();
  const districtCity = districtContext?.cityName?.trim() ?? districtContext?.citySlug?.trim();
  const districtLine =
    districtLabel ?? (districtName && districtCity ? `${districtName} · ${districtCity}` : districtName ?? districtCity ?? null);
  const templateHelper = plan.isTemplate
    ? readOnly
      ? 'Template view · Read-only.'
      : "You're viewing a template. Use it to start a new plan."
    : plan.createdFrom?.kind === 'template'
      ? `Based on template: ${plan.createdFrom.templateTitle ?? 'Template'}`
      : null;
  const headerLabel = attribution.headline;
  const editLabel = 'Open in Waypoint';
  const shareLabel = mode === 'edit' ? 'Share this version' : 'Copy share link';
  const headerAccentStyle: CSSProperties | undefined = accentHex
    ? { borderTopColor: accentHex }
    : undefined;
  const sharedBadgeStyle: CSSProperties | undefined = accentHex
    ? { borderColor: accentHex, color: accentHex }
    : undefined;
  const containerClass = embed
    ? 'max-w-3xl mx-auto px-4 py-6 space-y-6'
    : 'max-w-3xl mx-auto px-4 py-10 space-y-8';

  return (
    <div className={containerClass}>
      <header
        className="space-y-3 border-t-2 border-slate-800 pt-3"
        style={headerAccentStyle}
      >
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">{headerLabel}</p>
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
          {!embed ? (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">
                {attribution.byline} · {attribution.provenance}
              </p>
              <p className="text-[11px] text-slate-500">{attribution.modeHint}</p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-semibold text-slate-50">{plan.title || 'Untitled plan'}</h1>
            {isShared ? (
              <span
                className="rounded-full border border-slate-600 bg-slate-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
                style={sharedBadgeStyle}
              >
                Shared
              </span>
            ) : null}
            {templateBadge ? (
              <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
                {templateBadge}
              </span>
            ) : null}
          </div>
          {!embed && isShared ? (
            <p className="text-[11px] text-slate-400">
              A read-only plan you can copy and reuse.
            </p>
          ) : null}
          {effectiveDescription ? (
            <p className="text-sm text-slate-300">{effectiveDescription}</p>
          ) : null}
          {districtLine ? (
            <p className="text-xs text-slate-400">District: {districtLine}</p>
          ) : null}
          {!embed && templateHelper ? <p className="text-xs text-slate-400">{templateHelper}</p> : null}
          {plan.createdFrom?.kind === 'experience' ? (
            <p className="text-xs text-slate-400">Forked from a curated venue experience.</p>
          ) : null}
          {plan.intent ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-400">Intent</p>
              <p className="text-base text-slate-200">{plan.intent}</p>
            </div>
          ) : null}
          {plan.audience ? (
            <div className="inline-flex items-center gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1">
                For: {plan.audience}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {!embed ? (
        <DiscoveryStrip
          plan={plan}
          isShared={isShared}
          allowNavigation={allowNavigation}
          readOnly={readOnly}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Stops</h2>
        {hasMissingMapTarget ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            Some stops are missing location data. Open in Waypoint to finish.
          </div>
        ) : null}
        <ol className="space-y-3 list-decimal list-inside">
          {normalizedStops.map((stop) => {
            const address = shortenAddress(getStopAddress(stop));
            const mapHref = getStopMapHref(stop);
            const websiteHref = getStopWebsiteHref(stop);
            const ratingLabel = formatRating(stop.placeLite);
            const showMeta = Boolean(address || mapHref || websiteHref || ratingLabel);
            return (
              <li key={stop.id} className="space-y-1">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    {stop.placeLite?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small preview
                      <img
                        src={stop.placeLite.photoUrl}
                        alt=""
                        className="h-10 w-10 rounded-lg border border-slate-800 object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="text-base font-medium text-slate-50">{stop.name}</span>
                  </div>
                  <StopBadges stop={stop} />
                  {stop.notes ? (
                    <p className="text-sm text-slate-300 whitespace-pre-line">{stop.notes}</p>
                  ) : null}
                  {showMeta ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {mapHref ? (
                        <a
                          href={mapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-200 hover:text-teal-100"
                        >
                          Map
                        </a>
                      ) : null}
                      {websiteHref ? (
                        <a
                          href={websiteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-200 hover:text-teal-100"
                        >
                          Website
                        </a>
                      ) : null}
                      {ratingLabel ? <span>{ratingLabel}</span> : null}
                      {address ? <span className="truncate">{address}</span> : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {!embed ? <ConstraintsSection plan={plan} /> : null}
      {!embed ? <SignalsSection plan={plan} /> : null}
      {!embed ? <FooterSection plan={plan} /> : null}
      {debug ? (
        <details className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
          <summary className="cursor-pointer">
            Debug: stop location contract
          </summary>
          <div className="mt-2 space-y-1">
            {normalizedStops.map((stop, index) => {
              const placeRef = stop.placeRef ?? {};
              const hasPlaceId = Boolean(placeRef.placeId);
              const mapTarget = getStopMapTarget(stop);
              const mapTargetKind =
                mapTarget?.kind === 'mapsUrl' ? 'url' : mapTarget?.kind ?? 'none';
              const hasPlaceLite = Boolean(stop.placeLite);
              return (
                <div key={stop.id}>
                  stop {index + 1} ({stop.role}): placeId {hasPlaceId ? 'yes' : 'no'},
                  mapTarget {mapTargetKind}, placeLite{' '}
                  {hasPlaceLite ? 'yes' : 'no'} placeRef[
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

      {!embed && actions && (actions.shareFullUrl || actions.createCopyHref) ? (
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && actions.createCopyHref ? (
              <Link
                href={actions.createCopyHref}
                className={ctaClass(mode === 'edit' ? 'primary' : 'chip')}
              >
                {editLabel}
              </Link>
            ) : null}
            {actions.shareFullUrl ? (
              <button
                type="button"
                onClick={actions.onCopyShare}
                disabled={!actions.shareFullUrl}
                className={`${ctaClass(mode === 'edit' ? 'primary' : 'chip')} text-[11px]`}
              >
                {shareLabel}
              </button>
            ) : null}
            {actions.onCopyEmbed ? (
              <button
                type="button"
                onClick={actions.onCopyEmbed}
                disabled={!actions.embedFullUrl}
                className={`${ctaClass('chip')} text-[11px]`}
              >
                Copy embed link
              </button>
            ) : null}
            {actions.isShared ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                Shared
              </span>
            ) : null}
            {actions.shareStatus === 'copied' ? (
              <span className="text-[11px] text-emerald-200">Link copied.</span>
            ) : null}
          </div>
          {!readOnly ? (
            <p className="text-[11px] text-slate-400">
              Editing creates your own version. The original won’t change.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}




