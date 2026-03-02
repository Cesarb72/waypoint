export type GroupType = 'solo' | 'friends' | 'family' | 'community' | 'networking';

export type FocusType =
  | 'art-walk'
  | 'live-music'
  | 'food-makers'
  | 'retail-spotlight'
  | 'night-market'
  | 'seasonal-festival';

export type ActivationRefinement =
  | 'more_unique'
  | 'more_energy'
  | 'closer_together'
  | 'more_curated'
  | 'more_affordable'
  | null;

export interface LocalActivationSession {
  groupType: GroupType | null;
  focus: FocusType | null;
  refinement: ActivationRefinement;
  surprise: true;
  lockedGroupType: GroupType | null;
}

export function createEmptyLocalActivationSession(): LocalActivationSession {
  return {
    groupType: null,
    focus: null,
    refinement: null,
    surprise: true,
    lockedGroupType: null,
  };
}
