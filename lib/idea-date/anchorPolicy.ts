import type { AnchorType } from '@/lib/session/ideaDateSession';

export interface AnchorPolicy {
  categoryWeights: Partial<Record<
    | 'food'
    | 'culture'
    | 'arts'
    | 'outdoors'
    | 'games'
    | 'learning'
    | 'nightlife'
    | 'community'
    | 'wellness',
    number
  >>;
  uniquenessBoost: number; // 0-1
  eventInjectionBoost: number; // 0-1
  indoorBias: number; // 0-1
  physicalIntensity: number; // 0-1
  seasonalRelevance: number; // 0-1
}

export function getAnchorPolicy(anchor: AnchorType): AnchorPolicy {
  switch (anchor) {
    case 'adventurous':
      return {
        categoryWeights: { outdoors: 0.9, games: 0.6, culture: 0.4 },
        uniquenessBoost: 0.7,
        eventInjectionBoost: 0.6,
        indoorBias: 0.2,
        physicalIntensity: 0.7,
        seasonalRelevance: 0.6,
      };
    case 'creative':
      return {
        categoryWeights: { arts: 0.9, culture: 0.7, food: 0.4 },
        uniquenessBoost: 0.6,
        eventInjectionBoost: 0.7,
        indoorBias: 0.7,
        physicalIntensity: 0.3,
        seasonalRelevance: 0.6,
      };
    case 'intellectual':
      return {
        categoryWeights: { learning: 0.9, culture: 0.7, food: 0.3 },
        uniquenessBoost: 0.4,
        eventInjectionBoost: 0.4,
        indoorBias: 0.8,
        physicalIntensity: 0.2,
        seasonalRelevance: 0.5,
      };
    case 'cultured':
      return {
        categoryWeights: { culture: 0.9, arts: 0.7, food: 0.5 },
        uniquenessBoost: 0.4,
        eventInjectionBoost: 0.5,
        indoorBias: 0.7,
        physicalIntensity: 0.2,
        seasonalRelevance: 0.6,
      };
    case 'high_energy':
      return {
        categoryWeights: { nightlife: 0.8, games: 0.7, food: 0.5 },
        uniquenessBoost: 0.5,
        eventInjectionBoost: 0.6,
        indoorBias: 0.5,
        physicalIntensity: 0.7,
        seasonalRelevance: 0.5,
      };
    case 'playful_competitive':
      return {
        categoryWeights: { games: 0.95, food: 0.4, nightlife: 0.4 },
        uniquenessBoost: 0.6,
        eventInjectionBoost: 0.5,
        indoorBias: 0.5,
        physicalIntensity: 0.6,
        seasonalRelevance: 0.4,
      };
    case 'purposeful':
      return {
        categoryWeights: { community: 0.9, culture: 0.5, food: 0.4, wellness: 0.4 },
        uniquenessBoost: 0.5,
        eventInjectionBoost: 0.5,
        indoorBias: 0.6,
        physicalIntensity: 0.3,
        seasonalRelevance: 0.6,
      };
    case 'culinary':
      return {
        categoryWeights: { food: 0.95, culture: 0.4, nightlife: 0.3 },
        uniquenessBoost: 0.4,
        eventInjectionBoost: 0.4,
        indoorBias: 0.7,
        physicalIntensity: 0.2,
        seasonalRelevance: 0.5,
      };
  }
}
