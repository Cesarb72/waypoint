import type { Plan } from '@/lib/core/planTypes';
import { getAnchorPolicy } from '@/lib/idea-date/anchorPolicy';
import { getCrewPolicy } from '@/lib/idea-date/crewPolicy';
import { buildSurpriseMePlan } from '@/lib/idea-date/seeds';
import { enforceSurpriseContract } from '@/lib/idea-date/surpriseEnforcer';
import type { AnchorType, CrewType, MagicRefinement } from '@/lib/session/ideaDateSession';
import { buildIdeaDateCacheKey, buildIdeaDatePlanId } from '@/lib/toolkits/concierge/keys';
import { setIdeaDateMeta } from '@/lib/toolkits/concierge/meta';
import type { SurpriseReport } from '@/lib/toolkits/concierge/surpriseEnforcer';

type GenerateIdeaDateInput = {
  crew: CrewType;
  anchor: AnchorType;
  magicRefinement: MagicRefinement;
};

type GenerateIdeaDateOutput = {
  planId: string;
  cacheKey: string;
  plan: Plan;
  report: SurpriseReport;
};

function clonePlan(plan: Plan): Plan {
  if (typeof structuredClone === 'function') {
    return structuredClone(plan);
  }
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

export function generateIdeaDatePlan(input: GenerateIdeaDateInput): GenerateIdeaDateOutput {
  const planId = buildIdeaDatePlanId(input);
  const cacheKey = buildIdeaDateCacheKey(input);
  const crewPolicy = getCrewPolicy(input.crew);
  const anchorPolicy = getAnchorPolicy(input.anchor);

  const seeded = buildSurpriseMePlan({ id: planId, title: 'Idea-Date: Surprise Me' });
  const withPolicies = setIdeaDateMeta(seeded, {
    crewPolicy,
    anchorPolicy,
    magicRefinement: input.magicRefinement,
  });

  const { plan, report } = enforceSurpriseContract({
    plan: clonePlan(withPolicies),
    crewPolicy,
    anchorPolicy,
  });

  return { planId, cacheKey, plan, report };
}

