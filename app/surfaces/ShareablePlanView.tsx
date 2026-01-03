'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { serializePlan, type Plan, type Stop } from '../plan-engine';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import {
  getAnchorWeight,
  getFallbackCoverage,
  getFlexibilityProfile,
  getChangeDistance,
} from '../utils/discoverySignals';

type VariationEntry = {
  id: string;
  title: string;
  plan: Plan;
  encoded: string | null;
  updatedAt?: string;
  isCurrent: boolean;
  isOriginal: boolean;
};

type Props = {
  plan: Plan;
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
      <h2 className="text-sm font-semibold text-slate-200">Signals</h2>
      <ul className="space-y-1 text-sm text-slate-300">
        {signals.vibe ? <li>Vibe: {signals.vibe}</li> : null}
        {signals.flexibility ? <li>Flexibility: {signals.flexibility}</li> : null}
        {signals.commitment ? <li>Commitment: {signals.commitment}</li> : null}
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

function DiscoveryStrip({ plan }: { plan: Plan }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [variations, setVariations] = useState<VariationEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [parentPlan, setParentPlan] = useState<Plan | null>(null);
  const [baseParentId, setBaseParentId] = useState<string | null>(null);

  const loadVariations = useCallback(() => {
    let cancelled = false;
    async function run() {
      setIsLoading(true);
      try {
        const { data: currentRows, error: currentError } = await supabase
          .from('waypoints')
          .select('id,title,plan,parent_id,updated_at')
          .eq('id', plan.id)
          .limit(1);
        if (cancelled) return;
        if (currentError) {
          setVariations([
            { id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: true },
          ]);
          setParentPlan(null);
          setBaseParentId(null);
          setIsLoading(false);
          return;
        }

        const currentRow = currentRows?.[0];
        if (!currentRow) {
          setVariations([
            { id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: true },
          ]);
          setParentPlan(null);
          setBaseParentId(null);
          setIsLoading(false);
          return;
        }

        const baseParentId = currentRow.parent_id ?? currentRow.id ?? plan.id;
        setBaseParentId(baseParentId);

        if (currentRow.parent_id) {
          const { data: parentRows } = await supabase
            .from('waypoints')
            .select('plan')
            .eq('id', currentRow.parent_id)
            .limit(1);
          if (!cancelled) {
            setParentPlan(parentRows?.[0]?.plan ? (parentRows[0].plan as Plan) : null);
          }
        } else {
          setParentPlan(null);
        }

        const { data: siblingRows, error: siblingError } = await supabase
          .from('waypoints')
          .select('id,title,plan,parent_id,updated_at')
          .eq('parent_id', baseParentId)
          .order('updated_at', { ascending: false });

        if (cancelled) return;
        if (siblingError) {
          setVariations([
            { id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: plan.id === baseParentId },
          ]);
          setIsLoading(false);
          return;
        }

        const nextEntries: VariationEntry[] = [];

        siblingRows?.forEach((row) => {
          const rowPlan = row.plan as Plan | null;
          if (!rowPlan) return;
          nextEntries.push({
            id: row.id,
            title: row.title || rowPlan.title || 'Waypoint',
            plan: rowPlan,
            encoded: safeEncode(rowPlan),
            updatedAt: row.updated_at,
            isCurrent: row.id === plan.id,
            isOriginal: row.id === baseParentId,
          });
        });

        const hasCurrent = nextEntries.some((entry) => entry.id === plan.id);
        if (!hasCurrent) {
          nextEntries.unshift({
            id: plan.id,
            title: plan.title || 'Waypoint',
            plan,
            encoded: safeEncode(plan),
            updatedAt: currentRow?.updated_at,
            isCurrent: true,
            isOriginal: plan.id === baseParentId,
          });
        }

        setVariations(nextEntries);
      } catch {
        if (!cancelled) {
          setVariations([{ id: plan.id, title: plan.title, plan, encoded: safeEncode(plan), isCurrent: true, isOriginal: true }]);
          setParentPlan(null);
          setBaseParentId(null);
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
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Discovery</p>
          <p className="text-sm text-slate-200">
            {isLoading
              ? 'Loading variations...'
              : variationCount <= 1
                ? 'No variations yet.'
                : `${variationCount} variation${variationCount === 1 ? '' : 's'} exist for this plan`}
          </p>
          {variationCount <= 1 && !isLoading ? (
            <p className="text-[11px] text-slate-400">
              Edit this plan to create your own version for comparison.
            </p>
          ) : null}
        </div>
        {canToggle ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className={`${ctaClass('chip')} text-xs`}
            >
              {isOpen ? 'Hide variations' : 'Show variations'}
            </button>
          </div>
        ) : null}
      </div>

      {isOpen && canToggle ? (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-xs text-slate-400">Loading variations...</p>
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
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className={`${ctaClass('primary')} text-[11px]`}
                    >
                      Continue with this version
                    </button>
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
                <p className="text-xs text-slate-400">No variations yet.</p>
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
                        <a
                          href={entry.encoded ? `/plan?p=${encodeURIComponent(entry.encoded)}` : undefined}
                          className={`${ctaClass('chip')} text-[11px] ${entry.encoded ? '' : 'pointer-events-none opacity-60'}`}
                        >
                          Open this version
                        </a>
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
              {siblingEntries.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  Edit this plan to create your own version for comparison.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function ShareablePlanView({ plan }: Props) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <DiscoveryStrip plan={plan} />

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">Shared plan</p>
        <h1 className="text-3xl font-semibold text-slate-50">{plan.title || 'Untitled plan'}</h1>
        {plan.intent ? (
          <p className="text-base text-slate-200">{plan.intent}</p>
        ) : null}
        <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100">
          <div className="flex flex-col gap-1">
            <span>Viewing a shared Waypoint</span>
            <span className="text-xs text-slate-400">Edit to create your copy.</span>
          </div>
        </div>
        {plan.audience ? (
          <span className="inline-block mt-2 text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-200">
            {plan.audience}
          </span>
        ) : null}
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Stops</h2>
        <ol className="space-y-3 list-decimal list-inside">
          {plan.stops.map((stop) => (
            <li key={stop.id} className="space-y-1">
              <div className="flex flex-col gap-1">
                <span className="text-base font-medium text-slate-50">{stop.name}</span>
                <StopBadges stop={stop} />
                {stop.notes ? (
                  <p className="text-sm text-slate-300 whitespace-pre-line">{stop.notes}</p>
                ) : null}
                {stop.location?.trim() ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.location.trim())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${ctaClass('chip')} text-xs`}
                  >
                    Open in Maps
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ConstraintsSection plan={plan} />
      <SignalsSection plan={plan} />
      <FooterSection plan={plan} />
    </div>
  );
}
