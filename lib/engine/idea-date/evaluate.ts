import type { Plan, Stop } from '@/app/plan-engine/types';
import { computeFatiguePenalty, computeFrictionPenalty, computeJourneyIntentScore, computeJourneyScore } from './scoring';
import { getEdge, type IdeaDateTravelEdge } from './travelCache';
import { parseIdeaDatePlanProfile, IdeaDateStopProfileSchema, type IdeaDateStopProfile } from './schemas';

export type IdeaDateJourneyEvaluation = {
  intentScore: number;
  fatiguePenalty: number;
  frictionPenalty: number;
  journeyScore: number;
  fatigue: ReturnType<typeof computeFatiguePenalty>;
  friction: ReturnType<typeof computeFrictionPenalty>;
  travelEdges: IdeaDateTravelEdge[];
};

function readStopProfiles(stops: Stop[]): IdeaDateStopProfile[] {
  return stops
    .map((stop) => IdeaDateStopProfileSchema.safeParse(stop.ideaDate))
    .filter((parsed): parsed is { success: true; data: IdeaDateStopProfile } => parsed.success)
    .map((parsed) => parsed.data);
}

function computeTravelEdges(stops: Stop[], mode: 'walk' | 'drive'): IdeaDateTravelEdge[] {
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
  return edges;
}

export function evaluateIdeaDateJourney(plan: Plan): IdeaDateJourneyEvaluation {
  const planProfile = parseIdeaDatePlanProfile(plan.meta?.ideaDate);
  const stops = (plan.stops ?? []) as Stop[];
  const stopProfiles = readStopProfiles(stops);
  const intentScore = computeJourneyIntentScore(
    stopProfiles.map((profile) => ({
      intentVector: profile.intentVector,
      vibeTarget: planProfile.vibeTarget,
      vibeImportance: planProfile.vibeImportance,
    }))
  );

  const fatigue = computeFatiguePenalty(stopProfiles.map((profile) => profile.energyLevel));
  const travelEdges = computeTravelEdges(stops, planProfile.travelMode);
  const friction = computeFrictionPenalty(
    travelEdges.map((edge) => ({
      minutes: edge.minutes,
      distanceM: edge.distanceM,
      fromKey: edge.fromKey,
      toKey: edge.toKey,
    })),
    {
      totalStopMinutes: stopProfiles.reduce((sum, profile) => sum + profile.durationMin, 0),
    }
  );
  const journeyScore = computeJourneyScore(intentScore, fatigue.penalty, friction.penalty);

  return {
    intentScore,
    fatiguePenalty: fatigue.penalty,
    frictionPenalty: friction.penalty,
    journeyScore,
    fatigue,
    friction,
    travelEdges,
  };
}
