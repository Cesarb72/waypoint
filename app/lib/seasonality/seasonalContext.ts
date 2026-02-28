import type { Plan } from '../../plan-engine';
import { extractCity } from '../geo/extractCity';
import { extractDistrict } from '../geo/extractDistrict';
import { getSupabaseBrowserClient } from '../supabaseBrowserClient';

type CompletedSignalRow = {
  plan_id: string | null;
  created_at: string | null;
};

type PlanRow = {
  id: string | null;
  plan_json: unknown;
};

type StopLike = {
  placeLite?: {
    formattedAddress?: string | null;
  } | null;
};

export type SeasonalContextSummary = {
  distinctPlans: number;
  currentMonthCount: number;
  previousMonthCount: number;
  last3MonthsTotal: number;
  monthOverMonthDelta: number;
  topDay: number | null;
  dayCounts: Record<number, number>;
  monthCounts: Record<string, number>;
};

type SeasonalContextArgs = {
  templateId: string;
  location: string;
  minDistinctPlans?: number;
  limitPlans?: number;
};

const DEFAULT_LIMIT_PLANS = 200;
const DEFAULT_MIN_DISTINCT_PLANS = 3;

function normalizeCity(value: string): string {
  return value.trim().toLowerCase();
}

function deriveLocationLabel(formattedAddress: string | null | undefined): string | null {
  const district = extractDistrict(formattedAddress);
  if (district) return district;
  return extractCity(formattedAddress);
}

function parsePlanJson(value: unknown): Plan | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Plan;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Plan) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function hasLocationMatch(plan: Plan | null, location: string): boolean {
  if (!plan || !Array.isArray(plan.stops)) return false;
  const target = normalizeCity(location);
  if (!target) return false;
  return plan.stops.some((stopRaw) => {
    const stop = stopRaw as unknown as StopLike;
    const formattedAddress = stop.placeLite?.formattedAddress;
    if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) return false;
    const derivedLocation = deriveLocationLabel(formattedAddress);
    if (!derivedLocation) return false;
    return normalizeCity(derivedLocation) === target;
  });
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function subtractMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - n, 1);
}

export async function getSeasonalContextSummary(
  args: SeasonalContextArgs
): Promise<{ data: SeasonalContextSummary | null; error: unknown }> {
  try {
    const templateId = args.templateId?.trim();
    const location = args.location?.trim();
    const minDistinctPlans = args.minDistinctPlans ?? DEFAULT_MIN_DISTINCT_PLANS;
    const limitPlans = args.limitPlans ?? DEFAULT_LIMIT_PLANS;
    if (!templateId || !location) {
      return { data: null, error: null };
    }

    const supabase = getSupabaseBrowserClient();
    const { data: signals, error: signalError } = await supabase
      .from('plan_signals')
      .select('plan_id, created_at')
      .eq('signal_type', 'plan_completed')
      .order('created_at', { ascending: false })
      .limit(limitPlans);

    if (signalError) {
      return { data: null, error: signalError };
    }
    if (!signals || signals.length === 0) {
      return { data: null, error: null };
    }

    const latestByPlanId = new Map<string, string>();
    (signals as CompletedSignalRow[]).forEach((row) => {
      if (!row.plan_id || !row.created_at) return;
      if (latestByPlanId.has(row.plan_id)) return;
      latestByPlanId.set(row.plan_id, row.created_at);
    });

    const planIds = Array.from(latestByPlanId.keys());
    if (planIds.length === 0) {
      return { data: null, error: null };
    }

    const { data: plans, error: planError } = await supabase
      .from('plans')
      .select('id, plan_json')
      .in('id', planIds)
      .eq('plan_json->>template_id', templateId);

    if (planError) {
      return { data: null, error: planError };
    }
    if (!plans || plans.length === 0) {
      return { data: null, error: null };
    }

    const completionDates: Date[] = [];
    (plans as PlanRow[]).forEach((row) => {
      const planId = typeof row?.id === 'string' ? row.id : null;
      if (!planId) return;
      const completedAtRaw = latestByPlanId.get(planId);
      if (!completedAtRaw) return;
      const planJson = parsePlanJson(row.plan_json);
      if (!hasLocationMatch(planJson, location)) return;
      const completedAt = new Date(completedAtRaw);
      if (Number.isNaN(completedAt.valueOf())) return;
      completionDates.push(completedAt);
    });

    const distinctPlans = completionDates.length;
    if (distinctPlans < minDistinctPlans) {
      return { data: null, error: null };
    }

    const monthCountsMap = new Map<string, number>();
    const dayCountsMap = new Map<number, number>();
    completionDates.forEach((completedAt) => {
      const key = monthKey(completedAt);
      monthCountsMap.set(key, (monthCountsMap.get(key) ?? 0) + 1);
      const day = completedAt.getDay();
      dayCountsMap.set(day, (dayCountsMap.get(day) ?? 0) + 1);
    });

    const now = new Date();
    const currentMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const previousMonthKey = monthKey(subtractMonths(now, 1));
    const last3Keys = [0, 1, 2].map((offset) => monthKey(subtractMonths(now, offset)));

    const currentMonthCount = monthCountsMap.get(currentMonthKey) ?? 0;
    const previousMonthCount = monthCountsMap.get(previousMonthKey) ?? 0;
    const last3MonthsTotal = last3Keys.reduce(
      (acc, key) => acc + (monthCountsMap.get(key) ?? 0),
      0
    );
    const monthOverMonthDelta = currentMonthCount - previousMonthCount;

    let topDay: number | null = null;
    let topDayCount = -1;
    for (let day = 0; day <= 6; day += 1) {
      const count = dayCountsMap.get(day) ?? 0;
      if (count > topDayCount) {
        topDayCount = count;
        topDay = day;
      }
    }

    const dayCounts: Record<number, number> = {
      0: dayCountsMap.get(0) ?? 0,
      1: dayCountsMap.get(1) ?? 0,
      2: dayCountsMap.get(2) ?? 0,
      3: dayCountsMap.get(3) ?? 0,
      4: dayCountsMap.get(4) ?? 0,
      5: dayCountsMap.get(5) ?? 0,
      6: dayCountsMap.get(6) ?? 0,
    };
    const monthCounts: Record<string, number> = {};
    monthCountsMap.forEach((count, key) => {
      monthCounts[key] = count;
    });

    return {
      data: {
        distinctPlans,
        currentMonthCount,
        previousMonthCount,
        last3MonthsTotal,
        monthOverMonthDelta,
        topDay,
        dayCounts,
        monthCounts,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}
