import { createIntentVector, type IdeaDateIntentVector } from './ideaDateConfig';

export type IdeaDatePlaceBaseline = {
  googleType: string;
  energyLevel: number;
  durationMin: number;
  intentVector: IdeaDateIntentVector;
};

export const GOOGLE_TYPE_BASELINES: Record<string, IdeaDatePlaceBaseline> = {
  cafe: {
    googleType: 'cafe',
    energyLevel: 0.35,
    durationMin: 55,
    intentVector: createIntentVector({
      intimacy: 0.72,
      energy: 0.32,
      novelty: 0.36,
      discovery: 0.44,
      pretense: 0.14,
      pressure: 0.12,
    }),
  },
  restaurant: {
    googleType: 'restaurant',
    energyLevel: 0.5,
    durationMin: 85,
    intentVector: createIntentVector({
      intimacy: 0.74,
      energy: 0.5,
      novelty: 0.46,
      discovery: 0.42,
      pretense: 0.3,
      pressure: 0.26,
    }),
  },
  bar: {
    googleType: 'bar',
    energyLevel: 0.64,
    durationMin: 80,
    intentVector: createIntentVector({
      intimacy: 0.54,
      energy: 0.72,
      novelty: 0.5,
      discovery: 0.4,
      pretense: 0.4,
      pressure: 0.32,
    }),
  },
  park: {
    googleType: 'park',
    energyLevel: 0.28,
    durationMin: 70,
    intentVector: createIntentVector({
      intimacy: 0.78,
      energy: 0.25,
      novelty: 0.34,
      discovery: 0.52,
      pretense: 0.05,
      pressure: 0.08,
    }),
  },
  museum: {
    googleType: 'museum',
    energyLevel: 0.42,
    durationMin: 95,
    intentVector: createIntentVector({
      intimacy: 0.58,
      energy: 0.42,
      novelty: 0.62,
      discovery: 0.78,
      pretense: 0.24,
      pressure: 0.18,
    }),
  },
  art_gallery: {
    googleType: 'art_gallery',
    energyLevel: 0.4,
    durationMin: 75,
    intentVector: createIntentVector({
      intimacy: 0.63,
      energy: 0.4,
      novelty: 0.62,
      discovery: 0.72,
      pretense: 0.25,
      pressure: 0.2,
    }),
  },
  movie_theater: {
    googleType: 'movie_theater',
    energyLevel: 0.48,
    durationMin: 110,
    intentVector: createIntentVector({
      intimacy: 0.56,
      energy: 0.42,
      novelty: 0.32,
      discovery: 0.22,
      pretense: 0.22,
      pressure: 0.14,
    }),
  },
  live_music_venue: {
    googleType: 'live_music_venue',
    energyLevel: 0.76,
    durationMin: 95,
    intentVector: createIntentVector({
      intimacy: 0.5,
      energy: 0.82,
      novelty: 0.64,
      discovery: 0.56,
      pretense: 0.48,
      pressure: 0.42,
    }),
  },
  tourist_attraction: {
    googleType: 'tourist_attraction',
    energyLevel: 0.55,
    durationMin: 80,
    intentVector: createIntentVector({
      intimacy: 0.4,
      energy: 0.58,
      novelty: 0.66,
      discovery: 0.72,
      pretense: 0.24,
      pressure: 0.3,
    }),
  },
  bookstore: {
    googleType: 'bookstore',
    energyLevel: 0.25,
    durationMin: 45,
    intentVector: createIntentVector({
      intimacy: 0.67,
      energy: 0.2,
      novelty: 0.34,
      discovery: 0.48,
      pretense: 0.1,
      pressure: 0.08,
    }),
  },
  dessert_shop: {
    googleType: 'dessert_shop',
    energyLevel: 0.38,
    durationMin: 40,
    intentVector: createIntentVector({
      intimacy: 0.6,
      energy: 0.36,
      novelty: 0.4,
      discovery: 0.32,
      pretense: 0.18,
      pressure: 0.12,
    }),
  },
  default: {
    googleType: 'default',
    energyLevel: 0.46,
    durationMin: 70,
    intentVector: createIntentVector({
      intimacy: 0.5,
      energy: 0.5,
      novelty: 0.45,
      discovery: 0.45,
      pretense: 0.2,
      pressure: 0.22,
    }),
  },
};
