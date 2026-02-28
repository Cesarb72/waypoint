import { getSupabaseBrowserClient } from './supabaseBrowserClient';
import { CLOUD_PLANS_TABLE } from './cloudTables';
import type { Plan } from '../plan-engine';

export type CloudPlanRow = {
  id: string;
  owner_id: string;
  share_token?: string | null;
  plan_json?: Plan;
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
type OkEmpty = { ok: true };

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

const CLOUD_PLAN_JSON_COLUMN = 'plan_json';
export const CLOUD_PLAN_SELECT_MIN =
  'id,owner_id,plan_json,share_token,created_at,updated_at';

function buildCloudRow(
  plan: Plan,
  userId: string
): Omit<CloudPlanRow, 'created_at' | 'updated_at'> {
  const payload: Omit<CloudPlanRow, 'created_at' | 'updated_at'> = {
    id: plan.id,
    owner_id: userId,
    share_token: plan.presentation?.shareToken ?? null,
  };
  (payload as Record<string, unknown>)[CLOUD_PLAN_JSON_COLUMN] = plan;
  return payload;
}

export async function upsertCloudPlan(
  plan: Plan,
  userId: string,
  _options?: { parentId?: string | null }
): Promise<OkEmpty | Err> {
  try {
    void _options;
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      return { ok: false, error: 'No active session.' };
    }
    const payload = buildCloudRow(plan, userId);
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
    void _userId;
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(CLOUD_PLANS_TABLE)
      .select(CLOUD_PLAN_SELECT_MIN)
      .eq('id', planId)
      .limit(1);
    if (error) return { ok: false, error: error.message };
    const row = (data?.[0] ?? null) as unknown as Record<string, unknown> | null;
    const planJson = row?.[CLOUD_PLAN_JSON_COLUMN] as Plan | undefined;
    if (!planJson) return { ok: false, error: 'Plan not found.' };
    const ownerId = typeof row?.owner_id === 'string' ? row.owner_id : undefined;
    const nextPlan: Plan = {
      ...planJson,
      owner: planJson.owner ?? (ownerId ? { type: 'user', id: ownerId } : undefined),
      presentation: {
        ...planJson.presentation,
        shareToken:
          planJson.presentation?.shareToken ??
          (row?.share_token as string | null) ??
          undefined,
      },
    };
    return { ok: true, plan: nextPlan, ownerId };
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
      .select('id,plan_json,updated_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) return { ok: false, error: error.message };
    const plans = (data ?? []).map((row) => ({
      id: row.id as string,
      title: ((row.plan_json as Plan | undefined)?.title as string) || 'Waypoint',
      updatedAt: Date.parse(row.updated_at as string) || 0,
    }));
    return { ok: true, plans };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
