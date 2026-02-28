import {
  hydrateIdeaDateStopProfile,
  type IdeaDatePlaceLike,
} from './ideaDateBaselineResolver';
import { applyOverridesToProfile } from './ideaDateOverrides';
import type { IdeaDateIntentVector, IdeaDateRole } from './ideaDateConfig';
import type { IdeaDateStopProfile } from './schemas';

export function rehydrateForRoleChange(input: {
  place?: IdeaDatePlaceLike | null;
  prevProfile: IdeaDateStopProfile;
  newRole: IdeaDateRole;
  blend?: Partial<IdeaDateIntentVector>;
}): IdeaDateStopProfile {
  const baseline = hydrateIdeaDateStopProfile({
    place: input.place,
    role: input.newRole,
    blend: input.blend,
  });
  return applyOverridesToProfile(baseline, input.prevProfile.overrides);
}
