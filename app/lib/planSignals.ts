import { getSupabaseBrowserClient } from './supabaseBrowserClient';

type LogPlanSignalInput = {
  planId: string;
  actorId?: string;
  signalType: string;
  signalValue?: string | null;
};

export async function logPlanSignal({
  planId,
  actorId,
  signalType,
  signalValue,
}: LogPlanSignalInput) {
  const supabase = getSupabaseBrowserClient();
  return supabase.from('plan_signals').insert({
    plan_id: planId,
    actor_id: actorId ?? null,
    signal_type: signalType,
    signal_value: signalValue ?? null,
  });
}
