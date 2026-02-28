import { getSupabaseBrowserClient } from './supabaseBrowserClient';

type RecentCompletedPlan = {
  plan_id: string;
  completed_at: string;
  sentiment: string | null;
  title: string | null;
};

export async function getRecentCompletedPlans(): Promise<{
  data: RecentCompletedPlan[] | null;
  error: unknown;
}> {
  const supabase = getSupabaseBrowserClient();
  const { data: completedSignals, error } = await supabase
    .from('plan_signals')
    .select('plan_id, created_at')
    .eq('signal_type', 'plan_completed')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !completedSignals || completedSignals.length === 0) {
    return { data: null, error };
  }

  const planIds = Array.from(
    new Set(completedSignals.map((row) => row.plan_id).filter(Boolean))
  );
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
  const { data: sentimentSignals } = await supabase
    .from('plan_signals')
    .select('plan_id, signal_value, created_at')
    .eq('signal_type', 'plan_sentiment')
    .in('plan_id', planIds)
    .order('created_at', { ascending: false });

  const sentimentByPlan = new Map<string, string>();
  sentimentSignals?.forEach((signal) => {
    if (!signal.plan_id) return;
    if (sentimentByPlan.has(signal.plan_id)) return;
    if (typeof signal.signal_value === 'string') {
      sentimentByPlan.set(signal.plan_id, signal.signal_value);
    }
  });

  const data: RecentCompletedPlan[] = completedSignals.map((row) => ({
    plan_id: row.plan_id,
    completed_at: row.created_at,
    sentiment: sentimentByPlan.get(row.plan_id) ?? null,
    title: titleByPlan.get(row.plan_id) ?? null,
  }));

  return { data, error };
}
