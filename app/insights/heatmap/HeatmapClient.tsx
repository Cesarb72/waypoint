'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HeatmapSummaryRow } from '@/app/lib/heatmaps/heatmapQueries';
import { getHeatmapSummary } from '@/app/lib/heatmaps/heatmapQueries';

type HeatmapState = {
  rows: HeatmapSummaryRow[];
  isLoading: boolean;
  hasLoaded: boolean;
};

function sortRows(rows: HeatmapSummaryRow[]): HeatmapSummaryRow[] {
  return [...rows].sort((a, b) => {
    if (a.month !== b.month) {
      return b.month.localeCompare(a.month);
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.city.localeCompare(b.city);
  });
}

export function HeatmapClient() {
  const [state, setState] = useState<HeatmapState>({
    rows: [],
    isLoading: true,
    hasLoaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await getHeatmapSummary();
      if (cancelled) return;
      setState({
        rows: data ?? [],
        isLoading: false,
        hasLoaded: true,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedRows = useMemo(() => sortRows(state.rows), [state.rows]);

  if (!state.isLoading && state.hasLoaded && sortedRows.length === 0) {
    return <p className="text-sm text-slate-400">No completed plans yet.</p>;
  }

  if (sortedRows.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="space-y-1">
        <h1 className="text-base font-semibold text-slate-100">
          District heat map (v1)
        </h1>
        <p className="text-[11px] text-slate-400">
          Your completed plans, grouped by city and time.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] text-slate-300">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1.5 pr-3 font-semibold">City</th>
              <th className="py-1.5 pr-3 font-semibold">Day</th>
              <th className="py-1.5 pr-3 font-semibold">Time window</th>
              <th className="py-1.5 pr-3 font-semibold">Month</th>
              <th className="py-1.5 font-semibold">Completed plans</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedRows.map((row) => (
              <tr key={`${row.city}-${row.day_of_week}-${row.hour_bin}-${row.month}`}>
                <td className="py-2 pr-3 text-slate-100">{row.city}</td>
                <td className="py-2 pr-3">{row.day_of_week}</td>
                <td className="py-2 pr-3">{row.hour_bin}</td>
                <td className="py-2 pr-3">{row.month}</td>
                <td className="py-2">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500">
        v1 is based on completed plans with saved places.
      </p>
    </section>
  );
}
