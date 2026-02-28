'use client';

import type { Plan } from '@/app/plan-engine/types';
import type { IdeaDateOverrides } from '@/lib/engine/idea-date/schemas';

type StopDetailsProps = {
  stop: Plan['stops'][number] | null;
  open: boolean;
  onClose: () => void;
  setOverrides: (stopId: string, partial: Partial<IdeaDateOverrides>) => Promise<void> | void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOverride(stop: Plan['stops'][number], key: keyof IdeaDateOverrides): number {
  const rawIdeaDate = isRecord(stop.ideaDate) ? stop.ideaDate : null;
  const rawOverrides = rawIdeaDate && isRecord(rawIdeaDate.overrides) ? rawIdeaDate.overrides : null;
  const value = rawOverrides?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function SliderRow(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
        <span>{props.label}</span>
        <span className="text-gray-400">{props.value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="w-full accent-sky-400"
      />
    </label>
  );
}

export default function StopDetails(props: StopDetailsProps) {
  if (!props.open || !props.stop) return null;
  const stop = props.stop;
  const chillLively = readOverride(stop, 'chillLively');
  const relaxedActive = readOverride(stop, 'relaxedActive');
  const quickLingering = readOverride(stop, 'quickLingering');

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.45)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{stop.name}</div>
          <div className="text-xs text-gray-400">Tune stop feel (instant recompute)</div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-gray-200"
        >
          Close
        </button>
      </div>
      <div className="space-y-3">
        <SliderRow
          label="Chill <-> Lively"
          value={chillLively}
          onChange={(value) => props.setOverrides(stop.id, { chillLively: value })}
        />
        <SliderRow
          label="Relaxed <-> Active"
          value={relaxedActive}
          onChange={(value) => props.setOverrides(stop.id, { relaxedActive: value })}
        />
        <SliderRow
          label="Quick <-> Lingering"
          value={quickLingering}
          onChange={(value) => props.setOverrides(stop.id, { quickLingering: value })}
        />
      </div>
    </div>
  );
}
