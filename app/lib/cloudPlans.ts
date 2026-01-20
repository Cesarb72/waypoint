import { getSupabaseBrowserClient } from './supabaseBrowserClient';
import { CLOUD_PLANS_TABLE } from './cloudTables';
import type { Plan } from '../plan-engine';

export type CloudPlanRow = {
  id: string;
  owner_id: string;
  title: string;
  plan?: Plan;
  plan_json?: Plan;
  origin_json?: Plan['origin'] | Plan['meta'] | null;
  presentation_json?: Plan['presentation'] | null;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
};

type CloudPlanSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

const CLOUD_PLAN_JSON_COLUMN = CLOUD_PLANS_TABLE === 'waypoints' ? 'plan' : 'plan_json';

function buildCloudRow(
  plan: Plan,
  userId: string,
  parentId?: string | null
): Omit<CloudPlanRow, 'created_at' | 'updated_at'> {
  const payload: Omit<CloudPlanRow, 'created_at' | 'updated_at'> = {
    id: plan.id,
    owner_id: userId,
    title: plan.title || 'Waypoint',
  };
  (payload as Record<string, unknown>)[CLOUD_PLAN_JSON_COLUMN] = plan;
  if (CLOUD_PLANS_TABLE === 'plans') {
    payload.origin_json = plan.meta?.origin ?? plan.origin ?? null;
    payload.presentation_json = plan.presentation ?? null;
  }
  if (CLOUD_PLANS_TABLE === 'waypoints' && parentId !== undefined) {
    payload.parent_id = parentId;
  }
  return payload;
}

export async function upsertCloudPlan(
  plan: Plan,
  userId: string,
  options?: { parentId?: string | null }
): Promise<Ok<{}> | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      return { ok: false, error: 'No active session.' };
    }
    const payload = buildCloudRow(plan, userId, options?.parentId);
    const { error } = await supabase.from(CLOUD_PLANS_TABLE).upsert(payload, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function fetchCloudPlan(
  planId: string,
  _userId: string
): Promise<Ok<{ plan: Plan; ownerId?: string }> | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const selectColumns = `id,owner_id,${CLOUD_PLAN_JSON_COLUMN}`;
    const { data, error } = await supabase
      .from(CLOUD_PLANS_TABLE)
      .select(selectColumns)
      .eq('id', planId)
      .limit(1);
    if (error) return { ok: false, error: error.message };
    const row = (data?.[0] ?? null) as unknown as Record<string, unknown> | null;
    const planJson = row?.[CLOUD_PLAN_JSON_COLUMN] as Plan | undefined;
    if (!planJson) return { ok: false, error: 'Plan not found.' };
    const ownerId = typeof row?.owner_id === 'string' ? row.owner_id : undefined;
    return { ok: true, plan: planJson, ownerId };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function listCloudPlans(
  userId: string
): Promise<Ok<{ plans: CloudPlanSummary[] }> | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(CLOUD_PLANS_TABLE)
      .select('id,title,updated_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) return { ok: false, error: error.message };
    const plans = (data ?? []).map((row) => ({
      id: row.id as string,
      title: (row.title as string) || 'Waypoint',
      updatedAt: Date.parse(row.updated_at as string) || 0,
    }));
    return { ok: true, plans };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
