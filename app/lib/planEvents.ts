import { getSupabaseBrowserClient } from './supabaseBrowserClient';

type EventPayload = Record<string, unknown>;

const planExistenceCache = new Map<string, boolean>();

async function planExists(planId: string): Promise<boolean> {
  if (planExistenceCache.has(planId)) {
    return planExistenceCache.get(planId) as boolean;
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.from('plans').select('id').eq('id', planId).limit(1);
    if (error) {
      planExistenceCache.set(planId, false);
      return false;
    }
    const exists = Boolean(data?.[0]?.id);
    planExistenceCache.set(planId, exists);
    return exists;
  } catch {
    planExistenceCache.set(planId, false);
    return false;
  }
}

export async function logEvent(
  eventType: string,
  options?: {
    planId?: string | null;
    payload?: EventPayload;
    userId?: string | null;
    templateId?: string | null;
    stopTypeId?: string | null;
  }
): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const resolvedUserId = options?.userId ?? data.session?.user?.id ?? null;
    const payload = options?.payload ?? null;
    const planId = options?.planId ?? null;
    const templateId = options?.templateId ?? null;
    const stopTypeId = options?.stopTypeId ?? null;
    if (planId) {
      const exists = await planExists(planId);
      if (!exists) return;
    }
    await supabase.from('plan_events').insert({
      plan_id: planId,
      actor_id: resolvedUserId ?? null,
      event_type: eventType,
      event_payload: payload ?? null,
      template_id: templateId,
      stop_type_id: stopTypeId,
    });
  } catch {
    // swallow analytics errors
  }
}
