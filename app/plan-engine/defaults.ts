import { PLAN_VERSION, type Plan, type ShareMode } from './types';

const DEFAULT_SHARE_MODES: ShareMode[] = ['link', 'qr', 'embed'];

export const defaultPlan: Plan = {
  id: '',
  version: PLAN_VERSION,
  title: '',
  intent: '',
  audience: '',
  stops: [],
  presentation: {
    shareModes: [...DEFAULT_SHARE_MODES],
  },
};

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `plan_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyPlan(
  input?: Partial<Pick<Plan, 'title' | 'intent' | 'audience'>>
): Plan {
  return {
    id: generateId(),
    version: PLAN_VERSION,
    title: input?.title ?? '',
    intent: input?.intent ?? '',
    audience: input?.audience ?? '',
    stops: [],
    presentation: {
      shareModes: [...DEFAULT_SHARE_MODES],
    },
  };
}

export function createPlanFromTemplate(templatePlan: Partial<Plan>): Plan {
  const timestamp = nowIso();

  const prefills: Plan = {
    id: generateId(),
    version: PLAN_VERSION,
    title: templatePlan.title ?? '',
    intent: templatePlan.intent ?? '',
    audience: templatePlan.audience ?? '',
    stops: templatePlan.stops ? [...templatePlan.stops] : [],
    presentation: templatePlan.presentation
      ? {
          ...templatePlan.presentation,
          shareModes: templatePlan.presentation.shareModes
            ? [...templatePlan.presentation.shareModes]
            : [...DEFAULT_SHARE_MODES],
        }
      : { shareModes: [...DEFAULT_SHARE_MODES] },
    metadata: {
      ...templatePlan.metadata,
      createdAt: timestamp,
      lastUpdated: timestamp,
    },
    meta: templatePlan.meta ? { ...templatePlan.meta } : undefined,
    origin: templatePlan.origin ? { ...templatePlan.origin } : undefined,
    constraints: templatePlan.constraints,
    signals: templatePlan.signals,
    context: templatePlan.context,
  };

  return prefills;
}
