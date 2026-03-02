import type { Plan } from '@/lib/core/planTypes';
import { getFocusPolicy } from '@/lib/local-activation/focusPolicy';
import { getGroupPolicy } from '@/lib/local-activation/groupPolicy';
import type {
  ActivationRefinement,
  FocusType,
  GroupType,
} from '@/lib/session/localActivationSession';
import { buildLocalActivationCacheKey, buildLocalActivationPlanId } from '@/lib/toolkits/concierge/localActivationKeys';
import { setLocalActivationMeta } from '@/lib/toolkits/concierge/meta';
import { buildSeedPlan } from '@/lib/toolkits/concierge/seeds';
import { enforceSurpriseContract, type SurpriseReport } from '@/lib/toolkits/concierge/surpriseEnforcer';

type GenerateLocalActivationInput = {
  groupType: GroupType;
  focus: FocusType;
  refinement: ActivationRefinement;
};

type GenerateLocalActivationOutput = {
  planId: string;
  cacheKey: string;
  plan: Plan;
  mirroredReport: SurpriseReport;
};

function clonePlan(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan);
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

export function generateLocalActivationPlan(
  input: GenerateLocalActivationInput
): GenerateLocalActivationOutput {
  const planId = buildLocalActivationPlanId(input);
  const cacheKey = buildLocalActivationCacheKey(input);
  const groupPolicy = getGroupPolicy(input.groupType);
  const focusPolicy = getFocusPolicy(input.focus);

  const seeded = buildSeedPlan({ id: planId, title: 'Local Activation: Surprise Me' });
  const withLocalMeta = setLocalActivationMeta(seeded, {
    groupPolicy,
    focusPolicy,
    refinement: input.refinement,
    surprise: true,
  });

  const { plan: enforcedPlan, report } = enforceSurpriseContract({
    plan: clonePlan(withLocalMeta),
    crewPolicy: groupPolicy,
    anchorPolicy: focusPolicy,
  });
  const plan = setLocalActivationMeta(enforcedPlan, {
    surpriseReport: report,
  });

  return {
    planId,
    cacheKey,
    plan,
    mirroredReport: report,
  };
}

