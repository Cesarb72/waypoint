'use client';

import { useCallback, useMemo, useState } from 'react';
import { loadSavedPlan } from '@/app/utils/planStorage';
import { getStopCanonicalPlaceId, normalizeStops } from '@/lib/stopLocation';

const ACTIVE_PLAN_STORAGE_KEY = 'waypoint.activePlanId';

type Report = {
  planId: string | null;
  stops: Array<{
    label: string | null;
    role: string | null;
    canonicalPlaceId: string | null;
    placeRef: Record<string, unknown> | null;
    hasPlaceLite: boolean;
    placeLiteKeys: string[];
  }>;
  candidates: string[];
  notes: string[];
};

export default function PlanReportPage() {
  const [copied, setCopied] = useState(false);

  const report = useMemo<Report>(() => {
    if (typeof window === 'undefined') {
      return {
        planId: null,
        stops: [],
        candidates: [],
        notes: ['normalizedStops: false', 'persistedMigration: false'],
      };
    }
    const activePlanId = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
    const plan = activePlanId ? loadSavedPlan(activePlanId) : null;
    const normalizedStops = plan ? normalizeStops(plan.stops ?? []) : [];
    const didNormalize =
      plan && JSON.stringify(plan.stops ?? []) !== JSON.stringify(normalizedStops);
    const candidates = Array.from(
      new Set(
        normalizedStops
          .map((stop) => getStopCanonicalPlaceId(stop))
          .filter((pid): pid is string => Boolean(pid))
          .filter((pid) => {
            const st = normalizedStops.find(
              (s) => getStopCanonicalPlaceId(s) === pid
            );
            if (!st) return false;
            const lite = st.placeLite;
            if (!lite) return true;
            const hasPhoto = Boolean(lite.photoUrl);
            const hasAddress = Boolean(lite.formattedAddress);
            const hasRating = typeof lite.rating === 'number';
            return !(hasPhoto && hasAddress && hasRating);
          })
      )
    );
    const stops = normalizedStops.map((stop) => ({
      label: stop.name ?? null,
      role: stop.role ?? null,
      canonicalPlaceId: getStopCanonicalPlaceId(stop),
      placeRef: stop.placeRef ? { ...stop.placeRef } : null,
      hasPlaceLite: Boolean(stop.placeLite),
      placeLiteKeys: stop.placeLite ? Object.keys(stop.placeLite) : [],
    }));
    return {
      planId: plan?.id ?? null,
      stops,
      candidates,
      notes: [
        `normalizedStops: ${didNormalize ? 'true' : 'false'}`,
        'persistedMigration: false',
      ],
    };
  }, []);

  const reportJson = useMemo(() => JSON.stringify(report, null, 2), [report]);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(reportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [reportJson]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
          >
            Copy report
          </button>
          {copied ? <span className="text-xs text-emerald-200">Copied.</span> : null}
        </div>
        <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-[11px] text-slate-300">
          {reportJson}
        </pre>
      </div>
    </main>
  );
}
