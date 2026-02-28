import type { Plan } from '@/app/plan-engine/types';
import { applyIdeaDatePatchOps } from '@/lib/engine/idea-date/patchOps';
import type { IdeaDatePatchOp } from '@/lib/engine/idea-date/types';

export function applyIdeaDateOps(plan: Plan, ops: IdeaDatePatchOp[]): Plan {
  return applyIdeaDatePatchOps(plan, ops);
}
