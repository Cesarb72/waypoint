import type { GroupType } from '@/lib/session/localActivationSession';

export interface GroupPolicy {
  frictionTolerance: number;
  safetyFloor: number;
  budgetFlexibility: number;
  logisticsWeight: number;
  uniquenessTolerance: number;
  ticketFrictionTolerance: number;
  arcSoftBias: 'gentle' | 'balanced' | 'dynamic';
}

export function getGroupPolicy(groupType: GroupType): GroupPolicy {
  switch (groupType) {
    case 'solo':
      return {
        frictionTolerance: 0.5,
        safetyFloor: 0.8,
        budgetFlexibility: 0.6,
        logisticsWeight: 0.5,
        uniquenessTolerance: 0.7,
        ticketFrictionTolerance: 0.5,
        arcSoftBias: 'balanced',
      };
    case 'friends':
      return {
        frictionTolerance: 0.75,
        safetyFloor: 0.65,
        budgetFlexibility: 0.8,
        logisticsWeight: 0.45,
        uniquenessTolerance: 0.85,
        ticketFrictionTolerance: 0.75,
        arcSoftBias: 'dynamic',
      };
    case 'family':
      return {
        frictionTolerance: 0.3,
        safetyFloor: 0.95,
        budgetFlexibility: 0.55,
        logisticsWeight: 0.8,
        uniquenessTolerance: 0.4,
        ticketFrictionTolerance: 0.3,
        arcSoftBias: 'gentle',
      };
    case 'community':
      return {
        frictionTolerance: 0.55,
        safetyFloor: 0.85,
        budgetFlexibility: 0.7,
        logisticsWeight: 0.75,
        uniquenessTolerance: 0.65,
        ticketFrictionTolerance: 0.55,
        arcSoftBias: 'balanced',
      };
    case 'networking':
      return {
        frictionTolerance: 0.6,
        safetyFloor: 0.8,
        budgetFlexibility: 0.75,
        logisticsWeight: 0.65,
        uniquenessTolerance: 0.7,
        ticketFrictionTolerance: 0.6,
        arcSoftBias: 'dynamic',
      };
  }
}
