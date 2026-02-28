import type { Plan, Stop } from '@/app/plan-engine/types';
import type { IdeaDateRole } from './ideaDateConfig';
import { buildArcModel, type IdeaDateArcModel } from './arcModel';
import { computeArcContributionByStop } from './arcContribution';
import {
  evaluateConstraints,
  type ConstraintViolation,
} from './constraints';
import {
  hydrateIdeaDateStopProfile,
  type IdeaDatePlaceLike,
} from './ideaDateBaselineResolver';
import {
  IDEA_DATE_VIOLATION_THRESHOLDS,
  type IdeaDateTravelMode,
} from './ideaDateConfig';
import { applyOverridesToProfile } from './ideaDateOverrides';
import { rehydrateForRoleChange } from './ideaDateRoleRehydrate';
import { computeFatiguePenalty, computeFrictionPenalty, computeJourneyIntentScore, computeJourneyScore, toScore100 } from './scoring';
import { getEdge, type IdeaDateTravelEdge } from './travelCache';
import {
  parseIdeaDatePlanProfile,
  IdeaDateStopProfileSchema,
  type IdeaDatePlanProfile,
  type IdeaDateStopProfile,
} from './schemas';

export type IdeaDateSeverity = 'info' | 'warn' | 'critical';

export type IdeaDateViolation = {
  type: string;
  severity: IdeaDateSeverity;
  details: string;
};

export type IdeaDateTravelSummary = {
  mode: IdeaDateTravelMode;
  edges: IdeaDateTravelEdge[];
  totalDistanceM: number;
  totalMinutes: number;
};

export type IdeaDateComputedMetrics = {
  intentScore: number;
  fatiguePenalty: number;
  frictionPenalty: number;
  journeyScore: number;
  journeyScore100: number;
  arcContributionByIndex: number[];
  arcContributionTotal: number;
  arcNarrativesByIndex: string[];
  constraintViolations: ConstraintViolation[];
  constraintHardCount: number;
  constraintSoftCount: number;
  constraintNarratives: string[];
  violations: IdeaDateViolation[];
  components: {
    fatigue: ReturnType<typeof computeFatiguePenalty>;
    friction: ReturnType<typeof computeFrictionPenalty>;
  };
};

export type IdeaDateLiveResult = {
  plan: Plan;
  computed: IdeaDateComputedMetrics;
  travel: IdeaDateTravelSummary;
  arcModel: IdeaDateArcModel;
};

type IdeaDateStop = Stop & { ideaDate?: IdeaDateStopProfile };
type IdeaDatePlan = Plan & {
  meta?: (Plan['meta'] & { ideaDate?: IdeaDatePlanProfile }) | undefined;
  stops: IdeaDateStop[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRoleFromStop(stop: Stop, index: number): IdeaDateRole {
  const roleValue = stop.role;
  if (roleValue === 'anchor') return 'start';
  if (roleValue === 'support') return 'main';
  if (roleValue === 'optional') return 'flex';
  if (index === 0) return 'start';
  if (index === 1) return 'main';
  if (index === 2) return 'windDown';
  return 'flex';
}

function defaultRoleForIndex(index: number): IdeaDateRole {
  if (index === 0) return 'start';
  if (index === 1) return 'main';
  if (index === 2) return 'windDown';
  return 'flex';
}

function resolveRole(stop: Stop, index: number): IdeaDateRole {
  const raw = isRecord(stop.ideaDate) ? stop.ideaDate : null;
  const rawRole = raw?.role;
  if (
    rawRole === 'start' ||
    rawRole === 'main' ||
    rawRole === 'windDown' ||
    rawRole === 'flex'
  ) {
    return rawRole;
  }
  const fromCoreRole = readRoleFromStop(stop, index);
  return fromCoreRole ?? defaultRoleForIndex(index);
}

function getPlanProfile(plan: Plan): IdeaDatePlanProfile {
  const rawMeta = isRecord(plan.meta) ? plan.meta : {};
  return parseIdeaDatePlanProfile(rawMeta.ideaDate);
}

function getStopIdeaDateProfile(stop: Stop): IdeaDateStopProfile | null {
  const parsed = IdeaDateStopProfileSchema.safeParse(stop.ideaDate);
  if (!parsed.success) return null;
  return parsed.data;
}

function buildViolations(input: {
  intentScore: number;
  fatigue: ReturnType<typeof computeFatiguePenalty>;
  friction: ReturnType<typeof computeFrictionPenalty>;
  arc: IdeaDateArcModel;
  travelEdges: IdeaDateTravelEdge[];
}): IdeaDateViolation[] {
  const violations: IdeaDateViolation[] = [];
  if (input.intentScore < IDEA_DATE_VIOLATION_THRESHOLDS.intentCritical) {
    violations.push({
      type: 'intent_low',
      severity: 'critical',
      details: 'Overall stop intent does not align with the selected vibe.',
    });
  } else if (input.intentScore < IDEA_DATE_VIOLATION_THRESHOLDS.intentWarn) {
    violations.push({
      type: 'intent_low',
      severity: 'warn',
      details: 'Intent alignment is below target and may feel inconsistent.',
    });
  }

  if (input.fatigue.penalty >= IDEA_DATE_VIOLATION_THRESHOLDS.fatigueCritical) {
    violations.push({
      type: 'fatigue_high',
      severity: 'critical',
      details: 'Energy arc is likely to fatigue participants.',
    });
  } else if (input.fatigue.penalty >= IDEA_DATE_VIOLATION_THRESHOLDS.fatigueWarn) {
    violations.push({
      type: 'fatigue_high',
      severity: 'warn',
      details: 'Energy arc may be uneven; consider smoothing the journey.',
    });
  }

  if (input.friction.penalty >= IDEA_DATE_VIOLATION_THRESHOLDS.frictionCritical) {
    violations.push({
      type: 'friction_high',
      severity: 'critical',
      details: 'Travel burden is likely too high for this sequence.',
    });
  } else if (input.friction.penalty >= IDEA_DATE_VIOLATION_THRESHOLDS.frictionWarn) {
    violations.push({
      type: 'friction_high',
      severity: 'warn',
      details: 'Travel burden is elevated and may reduce flow.',
    });
  }

  if (input.arc.flags.doublePeak) {
    violations.push({
      type: 'double_peak',
      severity: 'warn',
      details: 'Multiple energy peaks reduce narrative flow.',
    });
  }
  if (input.arc.flags.noTaper) {
    violations.push({
      type: 'no_taper',
      severity: 'warn',
      details: 'Final stop does not taper energy.',
    });
  }
  const longEdge = input.travelEdges.find((edge) => edge.minutes > 18);
  if (longEdge) {
    violations.push({
      type: 'travel_edge_high',
      severity: 'warn',
      details: `At least one transition exceeds 18 minutes (${longEdge.minutes} min).`,
    });
  }
  return violations;
}

function toPlace(stop: Stop): IdeaDatePlaceLike {
  return {
    placeLite: stop.placeLite,
    placeRef: stop.placeRef,
    name: stop.name,
  };
}

export function ensureIdeaDateProfiles(plan: Plan): IdeaDatePlan {
  const planProfile = getPlanProfile(plan);
  const rawMeta = isRecord(plan.meta) ? plan.meta : {};
  const rawIdeaDate = isRecord(rawMeta.ideaDate) ? rawMeta.ideaDate : {};
  const stops = (plan.stops ?? []) as Stop[];

  const nextStops: IdeaDateStop[] = stops.map((stop, index) => {
    const desiredRole = resolveRole(stop, index);
    const existing = getStopIdeaDateProfile(stop);
    const blend = planProfile.vibeTarget;
    let nextProfile: IdeaDateStopProfile;

    if (!existing) {
      nextProfile = hydrateIdeaDateStopProfile({
        place: toPlace(stop),
        role: desiredRole,
        blend,
      });
    } else if (existing.role !== desiredRole) {
      nextProfile = rehydrateForRoleChange({
        place: toPlace(stop),
        prevProfile: existing,
        newRole: desiredRole,
        blend,
      });
    } else {
      nextProfile = applyOverridesToProfile(existing, existing.overrides);
    }

    return {
      ...stop,
      ideaDate: nextProfile,
    };
  });

  return {
    ...plan,
    meta: {
      ...rawMeta,
      ideaDate: {
        ...rawIdeaDate,
        ...planProfile,
      },
    },
    stops: nextStops,
  };
}

function computeTravelSummary(
  stops: Stop[],
  mode: IdeaDateTravelMode
): IdeaDateTravelSummary {
  const edges: IdeaDateTravelEdge[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    edges.push(
      getEdge(
        { id: from.id, placeLite: from.placeLite, placeRef: from.placeRef },
        { id: to.id, placeLite: to.placeLite, placeRef: to.placeRef },
        mode
      )
    );
  }

  return {
    mode,
    edges,
    totalDistanceM: edges.reduce((sum, edge) => sum + edge.distanceM, 0),
    totalMinutes: edges.reduce((sum, edge) => sum + edge.minutes, 0),
  };
}

async function resolvePlanInput(
  planOrId: Plan | string,
  options?: {
    resolvePlanById?: (planId: string) => Plan | null | Promise<Plan | null>;
  }
): Promise<Plan> {
  if (typeof planOrId !== 'string') return planOrId;
  const resolver = options?.resolvePlanById;
  if (!resolver) {
    throw new Error('recomputeIdeaDateLive(planId) requires options.resolvePlanById.');
  }
  const resolved = await resolver(planOrId);
  if (!resolved) {
    throw new Error(`Unable to resolve plan for id ${planOrId}.`);
  }
  return resolved;
}

export async function recomputeIdeaDateLive(
  planOrId: Plan | string,
  options?: {
    resolvePlanById?: (planId: string) => Plan | null | Promise<Plan | null>;
  }
): Promise<IdeaDateLiveResult> {
  const resolvedPlan = await resolvePlanInput(planOrId, options);
  const ensuredPlan = ensureIdeaDateProfiles(resolvedPlan);
  const planProfile = getPlanProfile(ensuredPlan);
  const stops = ensuredPlan.stops ?? [];
  const stopProfiles = stops.map((stop, index) => {
    const existingProfile = getStopIdeaDateProfile(stop);
    if (existingProfile) return existingProfile;
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `Idea-Date recompute invariant failed: stop at index ${index} is missing ideaDate profile.`
      );
    }
    return hydrateIdeaDateStopProfile({
      place: toPlace(stop),
      role: resolveRole(stop, index),
      blend: planProfile.vibeTarget,
    });
  });

  const intentScore = computeJourneyIntentScore(
    stopProfiles.map((profile) => ({
      intentVector: profile.intentVector,
      vibeTarget: planProfile.vibeTarget,
      vibeImportance: planProfile.vibeImportance,
    }))
  );

  const energySeries = stopProfiles.map((profile) => profile.energyLevel);
  const fatigue = computeFatiguePenalty(energySeries);
  const travel = computeTravelSummary(stops, planProfile.travelMode);
  const totalStopMinutes = stopProfiles.reduce((sum, profile) => sum + profile.durationMin, 0);
  const friction = computeFrictionPenalty(
    travel.edges.map((edge) => ({
      minutes: edge.minutes,
      distanceM: edge.distanceM,
      fromKey: edge.fromKey,
      toKey: edge.toKey,
    })),
    { totalStopMinutes }
  );

  const journeyScore = computeJourneyScore(intentScore, fatigue.penalty, friction.penalty);
  const arcModel = buildArcModel(energySeries);
  const arcContribution = computeArcContributionByStop({
    energySeries,
    fatigue,
    friction,
    transitionMinutes: travel.edges.map((edge) => edge.minutes),
  });
  if (process.env.NODE_ENV !== 'production') {
    if (arcContribution.byIndex.length !== stops.length) {
      throw new Error(
        `Idea-Date recompute invariant failed: arcContributionByIndex length=${arcContribution.byIndex.length}, stops=${stops.length}.`
      );
    }
    if (arcContribution.narrativesByIndex.length !== stops.length) {
      throw new Error(
        `Idea-Date recompute invariant failed: arcNarrativesByIndex length=${arcContribution.narrativesByIndex.length}, stops=${stops.length}.`
      );
    }
  }
  const violations = buildViolations({
    intentScore,
    fatigue,
    friction,
    arc: arcModel,
    travelEdges: travel.edges,
  });
  const constraints = evaluateConstraints({
    stops: stops.map((stop, index) => ({
      id: stop.id,
      role: stopProfiles[index]?.role ?? resolveRole(stop, index),
      types: stop.placeLite?.types,
    })),
    travelEdges: travel.edges.map((edge) => ({ minutes: edge.minutes })),
    arc: { noTaper: arcModel.flags.noTaper },
  });

  return {
    plan: ensuredPlan,
    computed: {
      intentScore,
      fatiguePenalty: fatigue.penalty,
      frictionPenalty: friction.penalty,
      journeyScore,
      journeyScore100: toScore100(journeyScore),
      arcContributionByIndex: arcContribution.byIndex,
      arcContributionTotal: arcContribution.total,
      arcNarrativesByIndex: arcContribution.narrativesByIndex,
      constraintViolations: constraints.violations,
      constraintHardCount: constraints.hardCount,
      constraintSoftCount: constraints.softCount,
      constraintNarratives: constraints.narratives,
      violations,
      components: { fatigue, friction },
    },
    travel,
    arcModel,
  };
}
