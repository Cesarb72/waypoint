import type {
  Plan,
  Stop,
  Constraints,
  Signals,
  Context,
  Presentation,
  Metadata,
  ShareMode,
} from './types';

export const PLAN_STARTER_VERSION = '6.0';

export type PlanStarterType = 'TEMPLATE' | 'GENERATED' | 'IMPORTED';

export type PlanStarterSource = {
  templateId?: string;
  originPlanId?: string;
  importUri?: string;
};

export type ImmutablePlan = Readonly<
  Plan & {
    stops: ReadonlyArray<Readonly<Stop>>;
    constraints?: Readonly<Constraints>;
    signals?: Readonly<Signals>;
    context?: Readonly<Context>;
    presentation?: Readonly<
      Presentation & {
        shareModes?: ReadonlyArray<ShareMode>;
      }
    >;
    metadata?: Readonly<Metadata>;
  }
>;

export interface PlanStarter {
  readonly id: string;
  readonly version: typeof PLAN_STARTER_VERSION;
  readonly type: PlanStarterType;
  readonly title: string;
  readonly summary?: string;
  readonly seedPlan: ImmutablePlan;
  readonly source?: PlanStarterSource;
  readonly createdAt: string;
}

/**
 * Build an immutable PlanStarter from a provided seed plan.
 * This helper performs shallow freezes to discourage mutation at runtime.
 */
export function createPlanStarter(input: {
  id: string;
  type: PlanStarterType;
  title: string;
  summary?: string;
  seedPlan: Plan;
  source?: PlanStarterSource;
  createdAt?: string;
}): PlanStarter {
  const createdAt = input.createdAt ?? new Date().toISOString();

  const frozenStops = (input.seedPlan.stops ?? []).map((stop) => Object.freeze({ ...stop }));

  const frozenPlan: Plan = {
    ...input.seedPlan,
    stops: frozenStops,
    constraints: input.seedPlan.constraints ? { ...input.seedPlan.constraints } : undefined,
    signals: input.seedPlan.signals ? { ...input.seedPlan.signals } : undefined,
    context: input.seedPlan.context ? { ...input.seedPlan.context } : undefined,
    presentation: input.seedPlan.presentation
      ? {
          ...input.seedPlan.presentation,
          shareModes: input.seedPlan.presentation.shareModes
            ? [...input.seedPlan.presentation.shareModes]
            : undefined,
        }
      : undefined,
    metadata: input.seedPlan.metadata ? { ...input.seedPlan.metadata } : undefined,
  };

  return Object.freeze({
    id: input.id,
    version: PLAN_STARTER_VERSION,
    type: input.type,
    title: input.title,
    summary: input.summary,
    seedPlan: Object.freeze(frozenPlan) as ImmutablePlan,
    source: input.source ? Object.freeze({ ...input.source }) : undefined,
    createdAt,
  });
}
