export type CrewType =
  | 'romantic'
  | 'friends'
  | 'family';

export type AnchorType =
  | 'adventurous'
  | 'creative'
  | 'intellectual'
  | 'cultured'
  | 'high_energy'
  | 'playful_competitive'
  | 'purposeful'
  | 'culinary';

export type MagicRefinement =
  | 'more_unique'
  | 'more_energy'
  | 'closer_together'
  | 'more_curated'
  | 'more_affordable'
  | null;

export interface IdeaDateSession {
  crew: CrewType | null;
  anchor: AnchorType | null;
  surprise: true;
  magicRefinement: MagicRefinement;
}

export const createEmptySession = (): IdeaDateSession => ({
  crew: null,
  anchor: null,
  surprise: true,
  magicRefinement: null,
});
