export const IDEA_DATE_INTENT_KEYS = [
  'intimacy',
  'energy',
  'novelty',
  'discovery',
  'pretense',
  'pressure',
] as const;

export type IdeaDateIntentKey = (typeof IDEA_DATE_INTENT_KEYS)[number];

export type IdeaDateIntentVector = Record<IdeaDateIntentKey, number>;

export type IdeaDateVibeId = 'first_date_low_pressure' | 'anniversary_intimate';

export type IdeaDateRole = 'start' | 'main' | 'windDown' | 'flex';

export type IdeaDateTravelMode = 'walk' | 'drive';

export type IdeaDateCompositeWeights = {
  intent: number;
  fatigue: number;
  friction: number;
};

export type IdeaDateVibeProfile = {
  id: IdeaDateVibeId;
  label: string;
  target: IdeaDateIntentVector;
  importance: IdeaDateIntentVector;
};

export const IDEA_DATE_DEFAULT_TRAVEL_MODE: IdeaDateTravelMode = 'walk';

export const IDEA_DATE_COMPOSITE_WEIGHTS: IdeaDateCompositeWeights = {
  intent: 0.58,
  fatigue: 0.22,
  friction: 0.2,
};

export const IDEA_DATE_REORDER_DELTA_THRESHOLD = 0.08;

export const IDEA_DATE_REPLACEMENT_DELTA_THRESHOLD = 0.15;

export const IDEA_DATE_REPLACEMENT_RESCUE_DELTA_THRESHOLD = 0.1;

export const IDEA_DATE_VIOLATION_THRESHOLDS = {
  intentWarn: 0.55,
  intentCritical: 0.42,
  fatigueWarn: 0.45,
  fatigueCritical: 0.65,
  frictionWarn: 0.35,
  frictionCritical: 0.55,
} as const;

export const IDEA_DATE_CONCIERGE_PHRASE_MAP: Record<string, string> = {
  intent_low: 'Mood fit is slipping; tune sequence or place fit.',
  fatigue_high: 'Energy arc feels choppy; smooth the peak and taper.',
  friction_high: 'Transit drag is high; tighten spacing between stops.',
  travel_edge_high: 'One handoff is adding too much friction.',
  no_taper: 'The close is still intense; add a softer finish.',
};

export function createZeroIntentVector(): IdeaDateIntentVector {
  return {
    intimacy: 0,
    energy: 0,
    novelty: 0,
    discovery: 0,
    pretense: 0,
    pressure: 0,
  };
}

export function createIntentVector(partial?: Partial<IdeaDateIntentVector>): IdeaDateIntentVector {
  const base = createZeroIntentVector();
  if (!partial) return base;
  return {
    intimacy: partial.intimacy ?? base.intimacy,
    energy: partial.energy ?? base.energy,
    novelty: partial.novelty ?? base.novelty,
    discovery: partial.discovery ?? base.discovery,
    pretense: partial.pretense ?? base.pretense,
    pressure: partial.pressure ?? base.pressure,
  };
}

export const IDEA_DATE_VIBE_PROFILES: Record<IdeaDateVibeId, IdeaDateVibeProfile> = {
  first_date_low_pressure: {
    id: 'first_date_low_pressure',
    label: 'First Date: Low Pressure',
    target: createIntentVector({
      intimacy: 0.72,
      energy: 0.44,
      novelty: 0.58,
      discovery: 0.62,
      pretense: 0.2,
      pressure: 0.15,
    }),
    importance: createIntentVector({
      intimacy: 0.9,
      energy: 0.65,
      novelty: 0.6,
      discovery: 0.55,
      pretense: 0.5,
      pressure: 0.95,
    }),
  },
  anniversary_intimate: {
    id: 'anniversary_intimate',
    label: 'Anniversary: Intimate',
    target: createIntentVector({
      intimacy: 0.88,
      energy: 0.38,
      novelty: 0.46,
      discovery: 0.42,
      pretense: 0.4,
      pressure: 0.12,
    }),
    importance: createIntentVector({
      intimacy: 1,
      energy: 0.58,
      novelty: 0.45,
      discovery: 0.45,
      pretense: 0.42,
      pressure: 0.9,
    }),
  },
};

export function getIdeaDateVibeProfile(vibeId: IdeaDateVibeId): IdeaDateVibeProfile {
  return IDEA_DATE_VIBE_PROFILES[vibeId];
}
