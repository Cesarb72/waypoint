import type { AnchorType, CrewType, MagicRefinement } from '@/lib/session/ideaDateSession';
import { buildVerticalCacheKey, buildVerticalPlanId } from '@/lib/toolkits/concierge/verticalKeys';

type IdeaDateKeyArgs = {
  crew: CrewType;
  anchor: AnchorType;
  magicRefinement: MagicRefinement;
};

export function buildIdeaDatePlanId(args: IdeaDateKeyArgs): string {
  return buildVerticalPlanId({
    verticalKey: 'idea-date',
    parts: [args.crew, args.anchor],
    refinement: args.magicRefinement,
  });
}

export function buildIdeaDateCacheKey(args: IdeaDateKeyArgs): string {
  return buildVerticalCacheKey({
    parts: [args.crew, args.anchor],
    refinement: args.magicRefinement,
  });
}
