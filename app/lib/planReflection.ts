import { getSupabaseBrowserClient } from './supabaseBrowserClient';

type ChosenNotCompletedPlan = {
  plan_id: string;
  chosen_at: string;
  title: string | null;
  sentiment: string | null;
};

type MostRevisitedPlan = {
  plan_id: string;
  view_count: number;
  last_viewed_at: string;
  title: string | null;
};

export async function getChosenNotCompletedPlans(limit = 5): Promise<{
  data: ChosenNotCompletedPlan[] | null;
  error: unknown;
}> {
  const supabase = getSupabaseBrowserClient();
  const { data: chosenSignals, error } = await supabase
    .from('plan_signals')
    .select('plan_id, created_at')
    .eq('signal_type', 'plan_chosen')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 6, 20));

  if (error || !chosenSignals || chosenSignals.length === 0) {
    return { data: [], error };
  }

  const planIds = Array.from(
    new Set(chosenSignals.map((row) => row.plan_id).filter(Boolean))
  );

  const { data: outcomeSignals } = await supabase
    .from('plan_signals')
    .select('plan_id, signal_type, created_at')
    .in('plan_id', planIds)
    .in('signal_type', ['plan_completed', 'plan_skipped']);

  const { data: sentimentSignals } = await supabase
    .from('plan_signals')
    .select('plan_id, signal_value, created_at')
    .in('plan_id', planIds)
    .eq('signal_type', 'plan_sentiment')
    .order('created_at', { ascending: false });

  const { data: planRows } =
    planIds.length > 0
      ? await supabase.from('plans').select('id, title').in('id', planIds)
      : { data: [] };

  const titleByPlan = new Map<string, string>();
  planRows?.forEach((row) => {
    if (row?.id) {
      titleByPlan.set(row.id, row.title ?? 'Untitled plan');
    }
  });

  const sentimentByPlan = new Map<string, string>();
  sentimentSignals?.forEach((signal) => {
    if (!signal.plan_id) return;
    if (sentimentByPlan.has(signal.plan_id)) return;
    if (typeof signal.signal_value === 'string') {
      sentimentByPlan.set(signal.plan_id, signal.signal_value);
    }
  });

  const latestChosenByPlan = new Map<string, string>();
  const filtered: ChosenNotCompletedPlan[] = [];

  chosenSignals.forEach((signal) => {
    if (!signal.plan_id) return;
    if (latestChosenByPlan.has(signal.plan_id)) return;
    latestChosenByPlan.set(signal.plan_id, signal.created_at);
    const chosenAt = signal.created_at;
    const hasOutcomeAfter = outcomeSignals?.some(
      (outcome) =>
        outcome.plan_id === signal.plan_id &&
        typeof outcome.created_at === 'string' &&
        outcome.created_at > chosenAt
    );
    if (hasOutcomeAfter) return;
    filtered.push({
      plan_id: signal.plan_id,
      chosen_at: chosenAt,
      title: titleByPlan.get(signal.plan_id) ?? null,
      sentiment: sentimentByPlan.get(signal.plan_id) ?? null,
    });
  });

  return { data: filtered.slice(0, limit), error };
}

export async function getMostRevisitedPlans(limit = 5): Promise<{
  data: MostRevisitedPlan[] | null;
  error: unknown;
}> {
  const supabase = getSupabaseBrowserClient();
  const { data: events, error } = await supabase
    .from('plan_events')
    .select('plan_id, created_at')
    .eq('event_type', 'plan_viewed')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error || !events || events.length === 0) {
    return { data: [], error };
  }

  const counts = new Map<string, { count: number; last: string }>();
  events.forEach((event) => {
    if (!event.plan_id || !event.created_at) return;
    const existing = counts.get(event.plan_id);
    if (!existing) {
      counts.set(event.plan_id, { count: 1, last: event.created_at });
      return;
    }
    existing.count += 1;
    if (event.created_at > existing.last) {
      existing.last = event.created_at;
    }
  });

  const planIds = Array.from(counts.keys());
  const { data: planRows } =
    planIds.length > 0
      ? await supabase.from('plans').select('id, title').in('id', planIds)
      : { data: [] };
  const titleByPlan = new Map<string, string>();
  planRows?.forEach((row) => {
    if (row?.id) {
      titleByPlan.set(row.id, row.title ?? 'Untitled plan');
    }
  });

  const data: MostRevisitedPlan[] = planIds
    .map((planId) => {
      const meta = counts.get(planId);
      if (!meta) return null;
      return {
        plan_id: planId,
        view_count: meta.count,
        last_viewed_at: meta.last,
        title: titleByPlan.get(planId) ?? null,
      };
    })
    .filter((row): row is MostRevisitedPlan => Boolean(row))
    .sort((a, b) => {
      if (b.view_count !== a.view_count) return b.view_count - a.view_count;
      return b.last_viewed_at.localeCompare(a.last_viewed_at);
    })
    .slice(0, limit);

  return { data, error };
}
