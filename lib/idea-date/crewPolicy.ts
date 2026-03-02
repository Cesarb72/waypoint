import type { CrewType } from '@/lib/session/ideaDateSession';

export interface CrewPolicy {
  frictionTolerance: number; // 0-1
  safetyFloor: number; // 0-1
  budgetFlexibility: number; // 0-1
  logisticsWeight: number; // 0-1
  uniquenessTolerance: number; // 0-1
  ticketFrictionTolerance: number; // 0-1
  arcSoftBias: 'gentle' | 'balanced' | 'dynamic';
}

export function getCrewPolicy(crew: CrewType): CrewPolicy {
  switch (crew) {
    case 'romantic':
      return {
        frictionTolerance: 0.3,
        safetyFloor: 0.9,
        budgetFlexibility: 0.6,
        logisticsWeight: 0.7,
        uniquenessTolerance: 0.5,
        ticketFrictionTolerance: 0.4,
        arcSoftBias: 'gentle',
      };
    case 'friends':
      return {
        frictionTolerance: 0.7,
        safetyFloor: 0.6,
        budgetFlexibility: 0.8,
        logisticsWeight: 0.5,
        uniquenessTolerance: 0.8,
        ticketFrictionTolerance: 0.7,
        arcSoftBias: 'dynamic',
      };
    case 'family':
      return {
        frictionTolerance: 0.2,
        safetyFloor: 1.0,
        budgetFlexibility: 0.5,
        logisticsWeight: 0.9,
        uniquenessTolerance: 0.3,
        ticketFrictionTolerance: 0.2,
        arcSoftBias: 'gentle',
      };
  }
}
