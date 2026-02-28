import { getSupabaseBrowserClient } from '../supabaseBrowserClient';
import type { Plan } from '../../plan-engine';
import { extractCity } from '../geo/extractCity';
import { extractDistrict } from '../geo/extractDistrict';

export type HeatmapHourBin =
  | '0-6'
  | '6-9'
  | '9-12'
  | '12-15'
  | '15-18'
  | '18-21'
  | '21-24';

export type HeatmapDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HeatmapSummaryRow = {
  city: string;
  day_of_week: HeatmapDayOfWeek;
  hour_bin: HeatmapHourBin;
  month: string;
  count: number;
};

type CompletedSignalRow = {
  plan_id: string | null;
  created_at: string | null;
  actor_id?: string | null;
};

type StopLike = {
  placeLite?: {
    formattedAddress?: string | null;
  } | null;
};

const HOUR_BINS: Array<{ start: number; end: number; label: HeatmapHourBin }> = [
  { start: 0, end: 6, label: '0-6' },
  { start: 6, end: 9, label: '6-9' },
  { start: 9, end: 12, label: '9-12' },
  { start: 12, end: 15, label: '12-15' },
  { start: 15, end: 18, label: '15-18' },
  { start: 18, end: 21, label: '18-21' },
  { start: 21, end: 24, label: '21-24' },
];

function getHourBin(date: Date): HeatmapHourBin {
  const hour = date.getHours();
  if (Number.isNaN(hour)) return '0-6';
  for (const bin of HOUR_BINS) {
    if (hour >= bin.start && hour < bin.end) return bin.label;
  }
  return '0-6';
}

function getMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function getHeatmapSummary(): Promise<{
  data: HeatmapSummaryRow[];
  error: unknown;
}> {
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user) {
    return { data: [], error: null };
  }
  const { data: signals, error } = await supabase
    .from('plan_signals')
    .select('plan_id, created_at, actor_id')
    .eq('signal_type', 'plan_completed')
    .order('created_at', { ascending: false });

  if (error || !signals || signals.length === 0) {
    return { data: [], error: null };
  }

  const latestByPlanId = new Map<string, string>();
  (signals as CompletedSignalRow[]).forEach((signal) => {
    if (!signal.plan_id || !signal.created_at) return;
    if (latestByPlanId.has(signal.plan_id)) return;
    latestByPlanId.set(signal.plan_id, signal.created_at);
  });

  const planIds = Array.from(latestByPlanId.keys());
  if (planIds.length === 0) {
    return { data: [], error: null };
  }

  const { data: planRows, error: planError } = await supabase
    .from('plans')
    .select('id, plan_json')
    .in('id', planIds);

  if (planError || !planRows || planRows.length === 0) {
    return { data: [], error: null };
  }

  const plansById = new Map<string, Plan>();
  planRows.forEach((row) => {
    const id = row?.id as string | undefined;
    const planJson = row?.plan_json as Plan | undefined;
    if (id && planJson) {
      plansById.set(id, planJson);
    }
  });

  const buckets = new Map<string, HeatmapSummaryRow>();

  latestByPlanId.forEach((completedAtRaw, planId) => {
    const planJson = plansById.get(planId);
    const stops = planJson?.stops ?? [];
    const completedAt = new Date(completedAtRaw);
    if (Number.isNaN(completedAt.valueOf())) return;
    const day_of_week = completedAt.getDay() as HeatmapDayOfWeek;
    const hour_bin = getHourBin(completedAt);
    const month = getMonthKey(completedAt);

    stops.forEach((stop) => {
      const stopLike = stop as StopLike;
      if (!stopLike.placeLite) return;
      const formattedAddress = stopLike.placeLite.formattedAddress ?? '';
      const district = extractDistrict(formattedAddress);
      const city = extractCity(formattedAddress);
      const locationLabel = district ?? city ?? 'Unknown';
      const key = `${locationLabel}|${day_of_week}|${hour_bin}|${month}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      buckets.set(key, {
        city: locationLabel,
        day_of_week,
        hour_bin,
        month,
        count: 1,
      });
    });
  });

  const data = Array.from(buckets.values()).sort((a, b) => {
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    if (a.count !== b.count) return b.count - a.count;
    return a.city.localeCompare(b.city);
  });

  return { data, error: null };
}
