import { getSupabaseBrowserClient } from '../supabaseBrowserClient';
import type { Plan } from '../../plan-engine';

const MIN_COMPLETED_SAMPLE = 5;
const MIN_SECOND_STOP_RATIO = 0.6;
const MAX_COMPLETED_SAMPLE = 200;

function matchesTemplate(plan: Plan, templateId: string): boolean {
  if (!templateId) return false;
  if (plan.createdFrom?.kind === 'template') {
    return plan.createdFrom.templateId === templateId;
  }
  if (plan.template_id) {
    return plan.template_id === templateId;
  }
  return false;
}

export async function getSecondStopRecommendation(
  planId: string,
  templateId: string,
  stopCount: number
): Promise<{ shouldRecommend: boolean; explanation: string } | null> {
  if (!planId || !templateId) return null;
  if (stopCount >= 2) return null;

  const supabase = getSupabaseBrowserClient();
  const { data: completedSignals, error } = await supabase
    .from('plan_signals')
    .select('plan_id, created_at')
    .eq('signal_type', 'plan_completed')
    .order('created_at', { ascending: false })
    .limit(MAX_COMPLETED_SAMPLE);

  if (error || !completedSignals || completedSignals.length === 0) {
    return null;
  }

  const planIds = Array.from(
    new Set(
      completedSignals
        .map((row) => row.plan_id)
        .filter((id): id is string => Boolean(id))
        .filter((id) => id !== planId)
    )
  );

  if (planIds.length === 0) return null;

  const { data: planRows, error: planError } = await supabase
    .from('plans')
    .select('id, plan_json')
    .in('id', planIds);

  if (planError || !planRows || planRows.length === 0) {
    return null;
  }

  const matchingPlans = planRows
    .map((row) => row?.plan_json as Plan | undefined)
    .filter((row): row is Plan => Boolean(row))
    .filter((plan) => matchesTemplate(plan, templateId))
    .filter((plan) => Array.isArray(plan.stops));

  const total = matchingPlans.length;
  if (total < MIN_COMPLETED_SAMPLE) return null;

  const withSecondStop = matchingPlans.filter((plan) => {
    const count = Array.isArray(plan.stops) ? plan.stops.length : 0;
    return count >= 2;
  }).length;

  const ratio = total > 0 ? withSecondStop / total : 0;
  const shouldRecommend = ratio >= MIN_SECOND_STOP_RATIO;
  const explanation = `Based on ${total} completed plans using this template, ${withSecondStop} included at least two stops.`;

  return { shouldRecommend, explanation };
}
