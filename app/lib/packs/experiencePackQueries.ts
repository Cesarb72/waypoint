import { getSupabaseBrowserClient } from '../supabaseBrowserClient';
import type { Plan } from '../../plan-engine';
import type { HeatmapHourBin } from '../heatmaps/heatmapQueries';
import { extractCity } from '../geo/extractCity';
import { extractDistrict } from '../geo/extractDistrict';

type ExperiencePackSummaryArgs = {
  templateId: string;
  location: string;
  dayOfWeek?: number | null;
  hourBin?: string | null;
  limitPlans?: number;
  minDistinctPlans?: number;
};

export type ExperiencePackSummary = {
  recommended_stop_count: number;
  common_stop_sequence: string[];
  common_hour_bin: string | null;
  evidence: { vertical: string; city: string; count: number };
};

type CompletedSignalRow = {
  plan_id: string | null;
  created_at: string | null;
};

type PlanRow = {
  id: string | null;
  plan_json: unknown;
};

type StopLike = {
  stop_type_id?: string | null;
  placeLite?: {
    formattedAddress?: string | null;
  } | null;
};

const DEFAULT_LIMIT_PLANS = 50;
const DEFAULT_MIN_DISTINCT_PLANS = 3;

const HOUR_BINS: Array<{ start: number; end: number; label: HeatmapHourBin }> = [
  { start: 0, end: 6, label: '0-6' },
  { start: 6, end: 9, label: '6-9' },
  { start: 9, end: 12, label: '9-12' },
  { start: 12, end: 15, label: '12-15' },
  { start: 15, end: 18, label: '15-18' },
  { start: 18, end: 21, label: '18-21' },
  { start: 21, end: 24, label: '21-24' },
];

const HOUR_BIN_ORDER = new Map<string, number>(HOUR_BINS.map((bin, index) => [bin.label, index]));

function getHourBin(date: Date): HeatmapHourBin {
  const hour = date.getHours();
  if (Number.isNaN(hour)) return '0-6';
  for (const bin of HOUR_BINS) {
    if (hour >= bin.start && hour < bin.end) return bin.label;
  }
  return '0-6';
}

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
  if (typeof value === 'object') {
    return value as Plan;
  }
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

function readStops(plan: Plan | null): unknown[] {
  if (!plan || !Array.isArray(plan.stops)) return [];
  return plan.stops;
}

function hasLocationMatch(stops: unknown[], location: string): boolean {
  const normalizedTargetLocation = normalizeCity(location);
  if (!normalizedTargetLocation) return false;
  return stops.some((stopRaw) => {
    const stop = stopRaw as StopLike;
    const formattedAddress = stop?.placeLite?.formattedAddress;
    if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) return false;
    const derivedLocation = deriveLocationLabel(formattedAddress);
    if (!derivedLocation) return false;
    return normalizeCity(derivedLocation) === normalizedTargetLocation;
  });
}

function getStopTypeSequence(stops: unknown[]): string[] {
  const sequence: string[] = [];
  stops.forEach((stopRaw) => {
    const stop = stopRaw as StopLike;
    if (typeof stop?.stop_type_id !== 'string') return;
    const stopTypeId = stop.stop_type_id.trim();
    if (!stopTypeId) return;
    sequence.push(stopTypeId);
  });
  return sequence;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const left = sorted[mid - 1] ?? 0;
  const right = sorted[mid] ?? 0;
  return (left + right) / 2;
}

function pickMostFrequentHourBin(freq: Map<string, number>): string | null {
  if (freq.size === 0) return null;
  let bestBin: string | null = null;
  let bestCount = -1;
  let bestOrder = Number.POSITIVE_INFINITY;

  freq.forEach((count, bin) => {
    const order = HOUR_BIN_ORDER.get(bin) ?? Number.POSITIVE_INFINITY;
    if (count > bestCount) {
      bestBin = bin;
      bestCount = count;
      bestOrder = order;
      return;
    }
    if (count === bestCount && order < bestOrder) {
      bestBin = bin;
      bestOrder = order;
    }
  });

  return bestBin;
}

function pickMostFrequentSequence(
  freq: Map<string, { count: number; length: number }>
): string[] {
  if (freq.size === 0) return [];
  let bestKey: string | null = null;
  let bestCount = -1;
  let bestLength = Number.POSITIVE_INFINITY;

  freq.forEach((entry, key) => {
    if (entry.count > bestCount) {
      bestKey = key;
      bestCount = entry.count;
      bestLength = entry.length;
      return;
    }
    if (entry.count < bestCount) return;
    if (entry.length < bestLength) {
      bestKey = key;
      bestLength = entry.length;
      return;
    }
    if (entry.length === bestLength && bestKey !== null && key < bestKey) {
      bestKey = key;
    }
  });

  if (!bestKey) return [];
  try {
    const parsed = JSON.parse(bestKey) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function shouldIncludeByTime(
  completedAtRaw: string,
  dayOfWeek?: number | null,
  hourBin?: string | null
): { include: boolean; hourBin: HeatmapHourBin | null } {
  const completedAt = new Date(completedAtRaw);
  if (Number.isNaN(completedAt.valueOf())) return { include: false, hourBin: null };
  const resolvedHourBin = getHourBin(completedAt);
  if (typeof dayOfWeek === 'number' && completedAt.getDay() !== dayOfWeek) {
    return { include: false, hourBin: resolvedHourBin };
  }
  if (hourBin && resolvedHourBin !== hourBin) {
    return { include: false, hourBin: resolvedHourBin };
  }
  return { include: true, hourBin: resolvedHourBin };
}

export async function getExperiencePackSummary(
  args: ExperiencePackSummaryArgs
): Promise<{ data: ExperiencePackSummary | null; error: unknown }> {
  try {
    const templateId = args.templateId?.trim();
    const location = args.location?.trim();
    const limitPlans = args.limitPlans ?? DEFAULT_LIMIT_PLANS;
    const minDistinctPlans = args.minDistinctPlans ?? DEFAULT_MIN_DISTINCT_PLANS;

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

    const latestByPlanId = new Map<string, { createdAt: string; hourBin: HeatmapHourBin }>();
    (signals as CompletedSignalRow[]).forEach((row) => {
      if (!row.plan_id || !row.created_at) return;
      if (latestByPlanId.has(row.plan_id)) return;
      const timeCheck = shouldIncludeByTime(row.created_at, args.dayOfWeek, args.hourBin);
      if (!timeCheck.include || !timeCheck.hourBin) return;
      latestByPlanId.set(row.plan_id, { createdAt: row.created_at, hourBin: timeCheck.hourBin });
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

    const stopCounts: number[] = [];
    const sequenceFreq = new Map<string, { count: number; length: number }>();
    const hourBinFreq = new Map<string, number>();
    const usedPlanIds = new Set<string>();

    (plans as PlanRow[]).forEach((row) => {
      const planId = typeof row?.id === 'string' ? row.id : null;
      if (!planId) return;
      if (!latestByPlanId.has(planId)) return;

      const plan = parsePlanJson(row.plan_json);
      const stops = readStops(plan);
      if (!hasLocationMatch(stops, location)) return;

      usedPlanIds.add(planId);
      stopCounts.push(stops.length);

      const completedMeta = latestByPlanId.get(planId);
      if (completedMeta) {
        hourBinFreq.set(
          completedMeta.hourBin,
          (hourBinFreq.get(completedMeta.hourBin) ?? 0) + 1
        );
      }

      const sequence = getStopTypeSequence(stops);
      if (sequence.length === 0) return;
      const key = JSON.stringify(sequence);
      const existing = sequenceFreq.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      sequenceFreq.set(key, { count: 1, length: sequence.length });
    });

    const eligibleDistinctPlanCount = usedPlanIds.size;
    if (eligibleDistinctPlanCount < minDistinctPlans) {
      return { data: null, error: null };
    }

    const summary: ExperiencePackSummary = {
      recommended_stop_count: median(stopCounts),
      common_stop_sequence: pickMostFrequentSequence(sequenceFreq),
      common_hour_bin: args.hourBin ?? pickMostFrequentHourBin(hourBinFreq),
      evidence: {
        vertical: templateId,
        city: location,
        count: eligibleDistinctPlanCount,
      },
    };

    return { data: summary, error: null };
  } catch (error) {
    return { data: null, error };
  }
}
