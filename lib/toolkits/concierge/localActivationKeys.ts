import type {
  ActivationRefinement,
  FocusType,
  GroupType,
} from '@/lib/session/localActivationSession';
import { buildVerticalCacheKey, buildVerticalPlanId } from '@/lib/toolkits/concierge/verticalKeys';

type LocalActivationKeyArgs = {
  groupType: GroupType;
  focus: FocusType;
  refinement: ActivationRefinement;
};

export function buildLocalActivationPlanId(args: LocalActivationKeyArgs): string {
  return buildVerticalPlanId({
    verticalKey: 'local-activation',
    parts: [args.groupType, args.focus],
    refinement: args.refinement,
  });
}

export function buildLocalActivationCacheKey(args: LocalActivationKeyArgs): string {
  return buildVerticalCacheKey({
    parts: [args.groupType, args.focus],
    refinement: args.refinement,
  });
}
