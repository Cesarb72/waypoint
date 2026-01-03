export type StarterType = 'template' | 'generated' | 'imported';

export type StarterState = 'draft' | 'ready';

export type TimeWindow = {
  start?: string;
  end?: string;
  timezone?: string;
};

export type LocationHint = {
  area?: string;
  venueType?: string;
  mobility?: string;
};

export type CostRange = {
  min?: number;
  max?: number;
  currency?: string;
};

export type Intent = {
  primary: string;
  context?: string;
};

export type Anchor = {
  id: string;
  label: string;
  description?: string;
  timing?: TimeWindow;
};

export type FlexProfile = {
  pacing?: 'slow' | 'steady' | 'fast';
  structure?: 'loose' | 'guided' | 'tight';
  openness?: 'low' | 'medium' | 'high';
};

export type FallbackProfile = {
  ideas: string[];
  notes?: string;
};

export interface PlanStarter {
  id: string;
  source: { type: StarterType; sourceId?: string };
  intent: Intent;
  structure: { anchors: Anchor[]; flexibility: FlexProfile; fallback?: FallbackProfile };
  constraints?: {
    time?: TimeWindow;
    location?: LocationHint;
    cost?: CostRange;
    attributes?: string[];
  };
  metadata?: {
    confidence: 'low' | 'medium' | 'high';
    generatedBy?: 'human' | 'system' | 'ai';
  };
  state: StarterState;
}

type StarterBuilderInput = {
  id?: string;
  sourceId?: string;
  intent: Intent;
  anchors?: Anchor[];
  flexibility?: FlexProfile;
  fallback?: FallbackProfile;
  constraints?: PlanStarter['constraints'];
  metadata?: PlanStarter['metadata'];
};

const DEFAULT_ANCHOR: Anchor = {
  id: 'anchor-1',
  label: 'Main anchor',
  description: 'Primary activity for this starter',
};

const DEFAULT_FLEX_PROFILE: FlexProfile = {
  pacing: 'steady',
  structure: 'guided',
  openness: 'medium',
};

function generateStarterId(prefix: StarterType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}_starter_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureAnchors(anchors?: Anchor[]): Anchor[] {
  const list = anchors ?? [];
  if (list.length === 0) {
    return [{ ...DEFAULT_ANCHOR }];
  }
  return list.map((anchor, index) => ({
    id: anchor.id || `anchor-${index + 1}`,
    label: anchor.label || DEFAULT_ANCHOR.label,
    description: anchor.description,
    timing: anchor.timing ? { ...anchor.timing } : undefined,
  }));
}

function normalizeConstraints(
  constraints?: PlanStarter['constraints']
): PlanStarter['constraints'] | undefined {
  if (!constraints) return undefined;
  return {
    time: constraints.time ? { ...constraints.time } : undefined,
    location: constraints.location ? { ...constraints.location } : undefined,
    cost: constraints.cost ? { ...constraints.cost } : undefined,
    attributes: constraints.attributes ? [...constraints.attributes] : undefined,
  };
}

function buildStarter(input: StarterBuilderInput & { type: StarterType }): PlanStarter {
  const anchors = ensureAnchors(input.anchors);
  const flexibility = input.flexibility ? { ...input.flexibility } : { ...DEFAULT_FLEX_PROFILE };
  const fallback =
    input.fallback && input.fallback.ideas && input.fallback.ideas.length > 0
      ? { ...input.fallback, ideas: [...input.fallback.ideas] }
      : undefined;

  return {
    id: input.id ?? generateStarterId(input.type),
    source: {
      type: input.type,
      sourceId: input.sourceId ?? input.id,
    },
    intent: { ...input.intent },
    structure: {
      anchors,
      flexibility,
      fallback,
    },
    constraints: normalizeConstraints(input.constraints),
    metadata: input.metadata ? { ...input.metadata } : undefined,
    state: 'ready',
  };
}

export function createTemplateStarter(input: StarterBuilderInput): PlanStarter {
  return buildStarter({ ...input, type: 'template' });
}

export function createGeneratedStarter(input: StarterBuilderInput): PlanStarter {
  return buildStarter({ ...input, type: 'generated' });
}

export function createImportedStarter(input: StarterBuilderInput): PlanStarter {
  return buildStarter({ ...input, type: 'imported' });
}

export const V6_TEMPLATE_STARTERS: PlanStarter[] = [
  createTemplateStarter({
    id: 'tpl-dinner',
    sourceId: 'tpl-dinner',
    intent: { primary: 'Dinner plan', context: 'Casual weeknight meet-up' },
    anchors: [{ id: 'anchor-dinner', label: 'Meal spot' }],
    constraints: { time: { start: '18:00' }, cost: { max: 50, currency: 'USD' } },
  }),
  createTemplateStarter({
    id: 'tpl-quick-hang',
    sourceId: 'tpl-quick-hang',
    intent: { primary: 'Quick hang', context: 'Light catch-up with friends' },
    anchors: [{ id: 'anchor-hang', label: 'Meetup spot' }],
    constraints: { time: { start: '17:30' }, attributes: ['short'] },
  }),
  createTemplateStarter({
    id: 'tpl-workout',
    sourceId: 'tpl-workout',
    intent: { primary: 'Workout session', context: '60-minute movement block' },
    anchors: [{ id: 'anchor-workout', label: 'Main workout' }],
    constraints: { time: { start: '07:00' }, location: { venueType: 'gym' } },
  }),
  createTemplateStarter({
    id: 'tpl-day-trip',
    sourceId: 'tpl-day-trip',
    intent: { primary: 'Day trip outline', context: 'Flexible nearby adventure' },
    anchors: [{ id: 'anchor-daytrip', label: 'Main activity' }],
    flexibility: { structure: 'loose', openness: 'high', pacing: 'steady' },
    constraints: { attributes: ['outdoors'] },
  }),
];

export const IDEA_DATE_IMPORTED_STARTERS: PlanStarter[] = [
  createImportedStarter({
    id: 'idea-date-coffee',
    sourceId: 'idea-date',
    intent: { primary: 'Coffee date', context: 'Low-key café catch-up' },
    anchors: [{ id: 'anchor-coffee', label: 'Coffee shop' }],
    constraints: { attributes: ['low-key', 'indoor', 'budget'] },
  }),
  createImportedStarter({
    id: 'idea-date-walk-talk',
    sourceId: 'idea-date',
    intent: { primary: 'Walk + talk', context: 'Easy stroll for conversation' },
    anchors: [{ id: 'anchor-walk', label: 'Scenic walk' }],
    constraints: { attributes: ['outdoor', 'budget', 'daytime'] },
  }),
  createImportedStarter({
    id: 'idea-date-museum-hour',
    sourceId: 'idea-date',
    intent: { primary: 'Museum hour', context: 'Light art stop together' },
    anchors: [{ id: 'anchor-museum', label: 'Gallery or museum' }],
    constraints: { attributes: ['indoor', 'cultural', 'low-key'] },
  }),
  createImportedStarter({
    id: 'idea-date-dessert-crawl',
    sourceId: 'idea-date',
    intent: { primary: 'Dessert crawl', context: 'Sweet stop hopping' },
    anchors: [{ id: 'anchor-dessert', label: 'Dessert spot' }],
    constraints: { attributes: ['casual', 'evening', 'budget'] },
  }),
  createImportedStarter({
    id: 'idea-date-bookstore-tea',
    sourceId: 'idea-date',
    intent: { primary: 'Bookstore + tea', context: 'Browse then sip' },
    anchors: [{ id: 'anchor-bookstore', label: 'Bookstore' }, { id: 'anchor-tea', label: 'Tea spot' }],
    flexibility: { structure: 'guided', pacing: 'slow', openness: 'medium' },
    constraints: { attributes: ['indoor', 'cozy', 'low-key'] },
  }),
  createImportedStarter({
    id: 'idea-date-sunset-lookout',
    sourceId: 'idea-date',
    intent: { primary: 'Sunset lookout', context: 'Simple views together' },
    anchors: [{ id: 'anchor-view', label: 'Viewpoint' }],
    constraints: { attributes: ['outdoor', 'romantic', 'evening'] },
  }),
  createImportedStarter({
    id: 'idea-date-game-night',
    sourceId: 'idea-date',
    intent: { primary: 'Game night', context: 'Light competition' },
    anchors: [{ id: 'anchor-games', label: 'Games spot' }],
    constraints: { attributes: ['indoor', 'social', 'budget'] },
  }),
  createImportedStarter({
    id: 'idea-date-street-market',
    sourceId: 'idea-date',
    intent: { primary: 'Street market stroll', context: 'Casual vendor hop' },
    anchors: [{ id: 'anchor-market', label: 'Market or fair' }],
    constraints: { attributes: ['outdoor', 'casual', 'daytime'] },
  }),
];
