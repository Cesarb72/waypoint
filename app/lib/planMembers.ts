import { getSupabaseBrowserClient } from './supabaseBrowserClient';

export type PlanMemberRole = 'owner' | 'editor' | 'viewer';

export type PlanMemberRow = {
  id: string;
  plan_id: string;
  user_id: string;
  role: PlanMemberRole;
  created_at: string;
};

export type RoleLookupResult = {
  role: PlanMemberRole | null;
  error?: string;
};

const roleLookupCache = new Map<string, Promise<RoleLookupResult>>();
const roleLookupCooldown = new Map<string, number>();
const ROLE_LOOKUP_COOLDOWN_MS = 30000;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type OkEmpty = { ok: true };

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export async function listMembers(planId: string): Promise<Ok<{ members: PlanMemberRow[] }> | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('plan_members')
      .select('id,plan_id,user_id,role,created_at')
      .eq('plan_id', planId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, members: (data ?? []) as PlanMemberRow[] };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function getMyRole(
  planId: string,
  userId: string
): Promise<RoleLookupResult> {
  const cacheKey = `${planId}:${userId}`;
  const lastFailedAt = roleLookupCooldown.get(cacheKey);
  if (lastFailedAt && Date.now() - lastFailedAt < ROLE_LOOKUP_COOLDOWN_MS) {
    return { role: null, error: 'Role check temporarily unavailable.' };
  }
  if (lastFailedAt && Date.now() - lastFailedAt >= ROLE_LOOKUP_COOLDOWN_MS) {
    roleLookupCooldown.delete(cacheKey);
    roleLookupCache.delete(cacheKey);
  }
  if (!roleLookupCache.has(cacheKey)) {
    roleLookupCache.set(
      cacheKey,
      (async () => {
        try {
          const supabase = getSupabaseBrowserClient();
          const { data, error } = await supabase
            .from('plan_members')
            .select('role')
            .eq('plan_id', planId)
            .eq('user_id', userId)
            .limit(1);
          if (error) {
            roleLookupCooldown.set(cacheKey, Date.now());
            return { role: null, error: error.message };
          }
          return { role: (data?.[0]?.role as PlanMemberRole | undefined) ?? null };
        } catch (lookupError) {
          roleLookupCooldown.set(cacheKey, Date.now());
          return { role: null, error: normalizeError(lookupError) };
        }
      })()
    );
  }
  return (await roleLookupCache.get(cacheKey)) ?? { role: null };
}

export async function addMember(
  planId: string,
  userId: string,
  role: PlanMemberRole
): Promise<OkEmpty | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('plan_members').insert({
      plan_id: planId,
      user_id: userId,
      role,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function removeMember(
  planId: string,
  userId: string
): Promise<OkEmpty | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase
      .from('plan_members')
      .delete()
      .eq('plan_id', planId)
      .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
