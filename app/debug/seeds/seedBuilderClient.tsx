'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TEMPLATE_SEEDS } from '@/lib/templateSeeds';
import type { Template, TemplateStop } from '@/types/templates';

type PlaceLite = {
  placeId: string;
  name?: string;
  formattedAddress?: string;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  photoUrl?: string;
};

type SeedRow = {
  templateId: string;
  templateTitle: string;
  stopId: string;
  label: string;
  role: TemplateStop['role'];
  isPlaceholder: boolean;
  resolveQuery?: string;
  resolveNear?: string;
  placeId?: string;
  provider?: string;
  placeLabel?: string;
};

const priceLabel = (value?: number) => {
  if (!value && value !== 0) return '';
  if (value <= 0) return 'Free';
  return '$'.repeat(Math.min(4, Math.max(1, Math.round(value))));
};

function buildRow(template: Template, stop: TemplateStop): SeedRow {
  return {
    templateId: template.id,
    templateTitle: template.title,
    stopId: stop.id,
    label: stop.label,
    role: stop.role,
    isPlaceholder: Boolean(stop.isPlaceholder),
    resolveQuery: stop.resolveQuery,
    resolveNear: stop.resolveNear,
    placeId: stop.placeRef?.placeId,
    provider: stop.placeRef?.provider,
    placeLabel: stop.placeRef?.label,
  };
}

export default function SeedBuilderClient() {
  const searchParams = useSearchParams();
  const debugParam = searchParams.get('debug') === '1';
  const isDebugAllowed = process.env.NODE_ENV !== 'production' || debugParam;

  const rows = useMemo(
    () =>
      TEMPLATE_SEEDS.flatMap((template) =>
        template.stops.map((stop) => buildRow(template, stop))
      ),
    []
  );

  const [resolvedMap, setResolvedMap] = useState<Record<string, string>>({});
  const [detailsMap, setDetailsMap] = useState<Record<string, PlaceLite>>({});
  const [resolving, setResolving] = useState(false);
  const [hydrating, setHydrating] = useState(false);

  const getKey = (row: SeedRow) => `${row.templateId}:${row.stopId}`;
  const getPlaceId = (row: SeedRow) => resolvedMap[getKey(row)] || row.placeId || '';
  const getStatus = (row: SeedRow) => {
    if (row.isPlaceholder) return 'skipped';
    if (getPlaceId(row)) return 'baked';
    if (row.resolveQuery) return 'resolvable';
    return 'needs_placeId';
  };

  const resolveAll = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const updates: Record<string, string> = {};
      const targets = rows.filter(
        (row) => getStatus(row) === 'resolvable' && !getPlaceId(row)
      );
      await Promise.all(
        targets.map(async (row) => {
          const res = await fetch('/api/places/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              q: row.resolveQuery,
              near: row.resolveNear,
            }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { place?: { placeId?: string } | null };
          if (!data?.place?.placeId) return;
          updates[getKey(row)] = data.place.placeId;
        })
      );
      if (Object.keys(updates).length > 0) {
        setResolvedMap((prev) => ({ ...prev, ...updates }));
      }
    } finally {
      setResolving(false);
    }
  };

  const hydrateDetails = async () => {
    if (hydrating) return;
    setHydrating(true);
    try {
      const placeIds = Array.from(
        new Set(rows.map((row) => getPlaceId(row)).filter(Boolean))
      );
      const updates: Record<string, PlaceLite> = {};
      await Promise.all(
        placeIds.map(async (placeId) => {
          if (detailsMap[placeId]) return;
          const params = new URLSearchParams({ placeId });
          const res = await fetch(`/api/places/details?${params.toString()}`);
          if (!res.ok) return;
          const data = (await res.json()) as { place?: PlaceLite | null };
          if (!data?.place) return;
          updates[placeId] = data.place;
        })
      );
      if (Object.keys(updates).length > 0) {
        setDetailsMap((prev) => ({ ...prev, ...updates }));
      }
    } finally {
      setHydrating(false);
    }
  };

  const copyPatchJson = async () => {
    const payload: Record<string, Record<string, { placeId: string; provider: 'google' }>> =
      {};
    for (const row of rows) {
      if (row.isPlaceholder) continue;
      const placeId = getPlaceId(row);
      if (!placeId) continue;
      if (!payload[row.templateId]) payload[row.templateId] = {};
      const stopKey = row.stopId || `${row.role}:${row.label}`;
      payload[row.templateId][stopKey] = {
        provider: 'google',
        placeId,
      };
    }
    const json = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(json);
  };

  const copyTemplateSnippet = async (templateId: string) => {
    const template = TEMPLATE_SEEDS.find((item) => item.id === templateId);
    if (!template) return;
    const lines = template.stops
      .map((stop) => {
        const row = rows.find(
          (candidate) =>
            candidate.templateId === templateId && candidate.stopId === stop.id
        );
        if (!row) return null;
        const placeId = getPlaceId(row);
        if (!placeId) return null;
        const placeLabel = row.placeLabel || row.label;
        return (
          `    {\n` +
          `      id: ${JSON.stringify(stop.id)},\n` +
          `      label: ${JSON.stringify(stop.label)},\n` +
          `      role: ${JSON.stringify(stop.role)},\n` +
          `      placeRef: {\n` +
          `        provider: "google",\n` +
          `        placeId: ${JSON.stringify(placeId)},\n` +
          `        label: ${JSON.stringify(placeLabel)},\n` +
          `      },\n` +
          `    }`
        );
      })
      .filter(Boolean)
      .join(',\n');

    const snippet =
      `{\n` +
      `  id: ${JSON.stringify(template.id)},\n` +
      `  stops: [\n` +
      `${lines}\n` +
      `  ],\n` +
      `}`;
    await navigator.clipboard.writeText(snippet);
  };

  if (!isDebugAllowed) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10 text-slate-200">
        <h1 className="text-xl font-semibold">Template Seed Builder</h1>
        <p className="text-sm text-slate-400">
          Add ?debug=1 to access this page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Template Seed Builder</h1>
          <p className="text-sm text-slate-400">
            Resolve missing placeIds and copy a patch for templateSeeds.ts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resolveAll}
            disabled={resolving}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {resolving ? 'Resolving…' : 'Resolve all'}
          </button>
          <button
            type="button"
            onClick={hydrateDetails}
            disabled={hydrating}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {hydrating ? 'Hydrating…' : 'Hydrate details'}
          </button>
          <button
            type="button"
            onClick={copyPatchJson}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Copy patch JSON
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-3 py-2">Template</th>
              <th className="px-3 py-2">Stop</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">PlaceId</th>
              <th className="px-3 py-2">Preview</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => {
              const status = getStatus(row);
              const placeId = getPlaceId(row);
              const preview = placeId ? detailsMap[placeId] : undefined;
              return (
                <tr key={`${row.templateId}:${row.stopId}`} className="text-slate-200">
                  <td className="px-3 py-2">
                    <div className="text-slate-100">{row.templateTitle}</div>
                    <div className="text-[10px] text-slate-500">{row.templateId}</div>
                    <button
                      type="button"
                      onClick={() => copyTemplateSnippet(row.templateId)}
                      className="mt-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                    >
                      Copy template snippet
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-100">{row.label}</div>
                    <div className="text-[10px] text-slate-500">{row.stopId}</div>
                  </td>
                  <td className="px-3 py-2">{row.role}</td>
                  <td className="px-3 py-2">
                    <div>{row.isPlaceholder ? 'placeholder' : 'real'}</div>
                    {row.resolveQuery ? (
                      <div className="text-[10px] text-slate-500">
                        resolve: {row.resolveQuery}
                      </div>
                    ) : null}
                    {row.resolveNear ? (
                      <div className="text-[10px] text-slate-500">
                        near: {row.resolveNear}
                      </div>
                    ) : null}
                    {row.placeId ? (
                      <div className="text-[10px] text-slate-500">baked</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{status}</td>
                  <td className="px-3 py-2">
                    <div className="break-all text-[10px] text-slate-400">
                      {placeId || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">
                    {preview ? (
                      <div className="space-y-1">
                        <div className="text-slate-100">{preview.name}</div>
                        <div>{preview.formattedAddress}</div>
                        <div>
                          {preview.rating ? preview.rating.toFixed(1) : '—'}{' '}
                          {preview.userRatingsTotal
                            ? `(${preview.userRatingsTotal})`
                            : ''}
                          {preview.priceLevel !== undefined
                            ? ` · ${priceLabel(preview.priceLevel)}`
                            : ''}
                        </div>
                        <div>{preview.photoUrl ? 'photo ✓' : 'photo —'}</div>
                      </div>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
