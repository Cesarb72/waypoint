import type { FocusType } from '@/lib/session/localActivationSession';

export interface FocusPolicy {
  categoryWeights: Partial<Record<'events' | 'music' | 'arts' | 'food' | 'retail' | 'culture', number>>;
  uniquenessBoost: number;
  eventInjectionBoost: number;
  indoorBias: number;
  physicalIntensity: number;
  seasonalRelevance: number;
}

export function getFocusPolicy(focus: FocusType): FocusPolicy {
  switch (focus) {
    case 'art-walk':
      return {
        categoryWeights: { arts: 0.95, culture: 0.7, events: 0.6 },
        uniquenessBoost: 0.65,
        eventInjectionBoost: 0.8,
        indoorBias: 0.55,
        physicalIntensity: 0.45,
        seasonalRelevance: 0.6,
      };
    case 'live-music':
      return {
        categoryWeights: { music: 0.95, events: 0.8, food: 0.45 },
        uniquenessBoost: 0.6,
        eventInjectionBoost: 0.9,
        indoorBias: 0.65,
        physicalIntensity: 0.5,
        seasonalRelevance: 0.55,
      };
    case 'food-makers':
      return {
        categoryWeights: { food: 0.95, retail: 0.65, culture: 0.45 },
        uniquenessBoost: 0.55,
        eventInjectionBoost: 0.75,
        indoorBias: 0.55,
        physicalIntensity: 0.3,
        seasonalRelevance: 0.6,
      };
    case 'retail-spotlight':
      return {
        categoryWeights: { retail: 0.95, food: 0.5, events: 0.5 },
        uniquenessBoost: 0.5,
        eventInjectionBoost: 0.7,
        indoorBias: 0.7,
        physicalIntensity: 0.25,
        seasonalRelevance: 0.5,
      };
    case 'night-market':
      return {
        categoryWeights: { events: 0.85, food: 0.8, retail: 0.7, music: 0.55 },
        uniquenessBoost: 0.7,
        eventInjectionBoost: 0.9,
        indoorBias: 0.25,
        physicalIntensity: 0.55,
        seasonalRelevance: 0.75,
      };
    case 'seasonal-festival':
      return {
        categoryWeights: { events: 0.95, culture: 0.7, music: 0.6, food: 0.55 },
        uniquenessBoost: 0.75,
        eventInjectionBoost: 0.95,
        indoorBias: 0.35,
        physicalIntensity: 0.5,
        seasonalRelevance: 0.95,
      };
  }
}
