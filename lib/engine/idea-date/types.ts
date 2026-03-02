import type { PlaceLite, PlaceRef, Plan } from '@/lib/core/planTypes';
import type { IdeaDateStopProfile } from './schemas';
import type { IdeaDatePrefTilt } from './refineTilt';
import type { IdeaDateSuggestionConstraintDelta } from './constraintsNarrative';

export type IdeaDatePlanMeta = {
  ideaDate?: unknown;
  prefTilt?: IdeaDatePrefTilt;
} & NonNullable<Plan['meta']>;

export type IdeaDatePlan = Omit<Plan, 'meta'> & {
  meta?: IdeaDatePlanMeta;
};

export type IdeaDateSuggestionKind = 'reorder' | 'replacement';

export type IdeaDateMoveStopPatchOp = {
  op: 'moveStop';
  stopId: string;
  toIndex: number;
};

export type IdeaDateReplaceStopPatchOp = {
  op: 'replaceStop';
  stopId: string;
  newPlace: {
    name?: string;
    placeRef?: PlaceRef;
    placeLite?: PlaceLite;
  };
  newIdeaDateProfile: IdeaDateStopProfile;
};

export type IdeaDatePatchOp = IdeaDateMoveStopPatchOp | IdeaDateReplaceStopPatchOp;

export type IdeaDateSuggestion = {
  id: string;
  kind: IdeaDateSuggestionKind;
  reasonCode: string;
  patchOps: IdeaDatePatchOp[];
  newPlace?: {
    name?: string;
    placeRef?: PlaceRef;
    placeLite?: PlaceLite;
  };
  meta?: {
    originalPlaceName?: string;
    conciergeTiltNote?: string;
    constraintNarrativeNote?: string;
    structuralNarrative?: string;
    constraintDelta?: IdeaDateSuggestionConstraintDelta;
    debugRoleQuery?: {
      templateUsed: 'start' | 'main' | 'windDown' | 'generic';
      typesCount: number;
      keywordUsed: boolean;
      radiusMeters: number;
    };
    debugDiversity?: {
      candidateFamilyKey: string;
      planFamilyCounts: Record<string, number>;
      diversityPenalty: number;
      ranking: {
        deltaArc: number;
        adjustedArc: number;
        nearEqualArcDelta: number;
        weight: number;
      };
    };
  };
  impact: {
    before: number;
    after: number;
    delta: number;
    before100: number;
    after100: number;
  };
  arcImpact?: {
    beforeTotal: number;
    afterTotal: number;
    deltaTotal: number;
  };
  preview?: boolean;
  subjectStopId?: string;
};

