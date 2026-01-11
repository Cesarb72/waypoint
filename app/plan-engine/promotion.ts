import { PLAN_VERSION, type Plan, type PlanState, type Stop } from './types';
import type { PlanStarter } from './starters';

function generatePlanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `plan_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneStops(stops: ReadonlyArray<Readonly<Stop>>): Stop[] {
  return stops.map((stop) => ({ ...stop }));
}

export function promoteStarterToPlan(starter: PlanStarter, ownerId: string): Plan {
  if (!ownerId) {
    throw new Error('ownerId is required to promote a starter');
  }

  const timestamp = new Date().toISOString();
  const seed = starter.seedPlan;

  const cloned: Plan = {
    id: generatePlanId(),
    version: PLAN_VERSION,
    title: seed.title,
    intent: seed.intent,
    audience: seed.audience,
    stops: cloneStops(seed.stops),
    constraints: seed.constraints ? { ...seed.constraints } : undefined,
    signals: seed.signals ? { ...seed.signals } : undefined,
    context: seed.context ? { ...seed.context } : undefined,
    presentation: seed.presentation
      ? {
          ...seed.presentation,
          shareModes: seed.presentation.shareModes ? [...seed.presentation.shareModes] : undefined,
        }
      : undefined,
    metadata: seed.metadata
      ? {
          ...seed.metadata,
          createdAt: seed.metadata.createdAt ?? timestamp,
          lastUpdated: seed.metadata.lastUpdated ?? timestamp,
        }
      : {
          createdAt: timestamp,
          lastUpdated: timestamp,
        },
    meta: seed.meta ? { ...seed.meta } : undefined,
    origin: seed.origin ? { ...seed.origin } : undefined,
    ownerId,
    originStarterId: starter.id,
    state: 'DRAFT' satisfies PlanState,
  };

  return cloned;
}
