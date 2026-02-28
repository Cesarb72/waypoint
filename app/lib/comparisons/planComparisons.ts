import type { Plan } from '../../plan-engine';
import { extractCity } from '../geo/extractCity';
import { getSupabaseBrowserClient } from '../supabaseBrowserClient';

type CompletedSignalRow = {
  plan_id: string | null;
  created_at: string | null;
  actor_id?: string | null;
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

type PlanStopMetrics = {
  stopsCount: number;
  realPlacesCount: number;
  hasCityMatch: boolean;
};

export type PlanComparisonsData = {
  typicalStopsMedian: number | null;
  thisPlanStopsCount: number;
  thisPlanRealPlacesCount: number;
  lastTime: {
    planId: string;
    stopsCount: number;
    realPlacesCount: number;
  } | null;
  baseline: {
    cityMedianStops: number | null;
    globalMedianStops: number | null;
  };
  evidence: {
    distinctPlansCity: number;
    distinctPlansGlobal: number;
    mode: {
      typical: 'earned' | 'preview';
      lastTime: 'earned' | 'preview';
      cityBaseline: 'earned' | 'preview';
    };
  };
};

type PlanComparisonsArgs = {
  templateId: string;
  city?: string | null;
  userId?: string | null;
  currentPlanId?: string | null;
  thisPlanStops: Array<{ placeLite?: { formattedAddress?: string | null } | null }>;
  minDistinctPlans?: number;
  limitPlans?: number;
};

const DEFAULT_LIMIT_PLANS = 300;
const DEFAULT_MIN_DISTINCT_PLANS = 3;

function normalizeCity(value: string): string {
  return value.trim().toLowerCase();
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (typeof left !== 'number' || typeof right !== 'number') return null;
  return (left + right) / 2;
}

function readPlanStopMetrics(plan: Plan | null, city?: string | null): PlanStopMetrics {
  const stops = Array.isArray(plan?.stops) ? plan.stops : [];
  const normalizedCity = city?.trim() ? normalizeCity(city) : null;
  let hasCityMatch = false;
  let realPlacesCount = 0;

  stops.forEach((stopRaw) => {
    const stop = stopRaw as unknown as StopLike;
    const formattedAddress = stop.placeLite?.formattedAddress;
    if (typeof formattedAddress === 'string' && formattedAddress.trim()) {
      realPlacesCount += 1;
      if (normalizedCity) {
        const derivedCity = extractCity(formattedAddress);
        if (derivedCity && normalizeCity(derivedCity) === normalizedCity) {
          hasCityMatch = true;
        }
      }
    }
  });

  return {
    stopsCount: stops.length,
    realPlacesCount,
    hasCityMatch: normalizedCity ? hasCityMatch : false,
  };
}

export async function getPlanComparisons(
  args: PlanComparisonsArgs
): Promise<{ data: PlanComparisonsData | null; error: unknown }> {
  try {
    const templateId = args.templateId?.trim();
    if (!templateId) return { data: null, error: null };

    const city = args.city?.trim() || null;
    const cityKnown = Boolean(city && city.toLowerCase() !== 'unknown');
    const minDistinctPlans = args.minDistinctPlans ?? DEFAULT_MIN_DISTINCT_PLANS;
    const limitPlans = args.limitPlans ?? DEFAULT_LIMIT_PLANS;

    const thisPlanStopsCount = args.thisPlanStops.length;
    const thisPlanRealPlacesCount = args.thisPlanStops.filter((stop) =>
      Boolean(stop.placeLite?.formattedAddress?.trim())
    ).length;

    const supabase = getSupabaseBrowserClient();
    const { data: signals, error: signalError } = await supabase
      .from('plan_signals')
      .select('plan_id, created_at, actor_id')
      .eq('signal_type', 'plan_completed')
      .order('created_at', { ascending: false })
      .limit(limitPlans);

    if (signalError) return { data: null, error: signalError };
    if (!signals || signals.length === 0) {
      return {
        data: {
          typicalStopsMedian: null,
          thisPlanStopsCount,
          thisPlanRealPlacesCount,
          lastTime: null,
          baseline: { cityMedianStops: null, globalMedianStops: null },
          evidence: {
            distinctPlansCity: 0,
            distinctPlansGlobal: 0,
            mode: { typical: 'preview', lastTime: 'preview', cityBaseline: 'preview' },
          },
        },
        error: null,
      };
    }

    const latestByPlanId = new Map<string, { createdAt: string; actorId: string | null }>();
    (signals as CompletedSignalRow[]).forEach((row) => {
      if (!row.plan_id || !row.created_at) return;
      if (latestByPlanId.has(row.plan_id)) return;
      latestByPlanId.set(row.plan_id, {
        createdAt: row.created_at,
        actorId: row.actor_id ?? null,
      });
    });
    const planIds = Array.from(latestByPlanId.keys());
    if (planIds.length === 0) {
      return {
        data: {
          typicalStopsMedian: null,
          thisPlanStopsCount,
          thisPlanRealPlacesCount,
          lastTime: null,
          baseline: { cityMedianStops: null, globalMedianStops: null },
          evidence: {
            distinctPlansCity: 0,
            distinctPlansGlobal: 0,
            mode: { typical: 'preview', lastTime: 'preview', cityBaseline: 'preview' },
          },
        },
        error: null,
      };
    }

    const { data: plans, error: planError } = await supabase
      .from('plans')
      .select('id, plan_json')
      .in('id', planIds)
      .eq('plan_json->>template_id', templateId);
    if (planError) return { data: null, error: planError };
    if (!plans || plans.length === 0) {
      return {
        data: {
          typicalStopsMedian: null,
          thisPlanStopsCount,
          thisPlanRealPlacesCount,
          lastTime: null,
          baseline: { cityMedianStops: null, globalMedianStops: null },
          evidence: {
            distinctPlansCity: 0,
            distinctPlansGlobal: 0,
            mode: { typical: 'preview', lastTime: 'preview', cityBaseline: 'preview' },
          },
        },
        error: null,
      };
    }

    const planMap = new Map<string, { plan: Plan | null; metrics: PlanStopMetrics }>();
    (plans as PlanRow[]).forEach((row) => {
      const planId = typeof row?.id === 'string' ? row.id : null;
      if (!planId) return;
      const plan = parsePlanJson(row.plan_json);
      const metrics = readPlanStopMetrics(plan, city);
      planMap.set(planId, { plan, metrics });
    });

    const cityStops: number[] = [];
    const globalStops: number[] = [];
    let distinctPlansCity = 0;
    let distinctPlansGlobal = 0;

    latestByPlanId.forEach((_signalMeta, planId) => {
      const entry = planMap.get(planId);
      if (!entry) return;
      globalStops.push(entry.metrics.stopsCount);
      distinctPlansGlobal += 1;
      if (!cityKnown) return;
      if (entry.metrics.hasCityMatch) {
        cityStops.push(entry.metrics.stopsCount);
        distinctPlansCity += 1;
      }
    });

    if (!cityKnown) {
      distinctPlansCity = 0;
    }

    const cityMedianRaw = median(cityStops);
    const globalMedianRaw = median(globalStops);
    const cityMedianStops = cityMedianRaw === null ? null : Math.round(cityMedianRaw);
    const globalMedianStops = globalMedianRaw === null ? null : Math.round(globalMedianRaw);

    let lastTime: PlanComparisonsData['lastTime'] = null;
    if (args.userId) {
      for (const signal of signals as CompletedSignalRow[]) {
        if (!signal.plan_id || !signal.created_at) continue;
        if (signal.actor_id !== args.userId) continue;
        if (args.currentPlanId && signal.plan_id === args.currentPlanId) continue;
        const entry = planMap.get(signal.plan_id);
        if (!entry) continue;
        if (cityKnown && !entry.metrics.hasCityMatch) continue;
        lastTime = {
          planId: signal.plan_id,
          stopsCount: entry.metrics.stopsCount,
          realPlacesCount: entry.metrics.realPlacesCount,
        };
        break;
      }
    }

    const cityEnough = cityKnown && distinctPlansCity >= minDistinctPlans;
    const globalEnough = distinctPlansGlobal >= minDistinctPlans;
    const typicalMode: 'earned' | 'preview' = cityEnough ? 'earned' : 'preview';
    const cityBaselineMode: 'earned' | 'preview' =
      cityEnough && globalEnough ? 'earned' : 'preview';
    const lastTimeMode: 'earned' | 'preview' = lastTime ? 'earned' : 'preview';

    return {
      data: {
        typicalStopsMedian: cityEnough ? cityMedianStops : null,
        thisPlanStopsCount,
        thisPlanRealPlacesCount,
        lastTime,
        baseline: {
          cityMedianStops: cityEnough ? cityMedianStops : null,
          globalMedianStops: globalEnough ? globalMedianStops : null,
        },
        evidence: {
          distinctPlansCity,
          distinctPlansGlobal,
          mode: {
            typical: typicalMode,
            lastTime: lastTimeMode,
            cityBaseline: cityBaselineMode,
          },
        },
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}
