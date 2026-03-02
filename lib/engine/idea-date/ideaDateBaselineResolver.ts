import type { PlaceLite, PlaceRef } from '@/lib/core/planTypes';
import {
  IDEA_DATE_INTENT_KEYS,
  createIntentVector,
  createZeroIntentVector,
  type IdeaDateIntentVector,
  type IdeaDateRole,
} from './ideaDateConfig';
import { GOOGLE_TYPE_BASELINES } from './ideaDatePlaceTypeMapping';
import { clamp01, IdeaDateStopProfileSchema, type IdeaDateStopProfile } from './schemas';

export type IdeaDatePlaceLike = {
  placeLite?: PlaceLite | null;
  placeRef?: PlaceRef | null;
  name?: string;
};

const ROLE_TYPE_PRIORITY: Record<IdeaDateRole, string[]> = {
  start: ['cafe', 'park', 'bookstore', 'art_gallery', 'restaurant'],
  main: ['restaurant', 'museum', 'tourist_attraction', 'live_music_venue', 'bar'],
  windDown: ['dessert_shop', 'bar', 'park', 'movie_theater', 'cafe'],
  flex: ['restaurant', 'cafe', 'park', 'museum', 'bar'],
};

const ROLE_INTENT_BASELINES: Record<IdeaDateRole, IdeaDateIntentVector> = {
  start: createIntentVector({
    intimacy: 0.68,
    energy: 0.34,
    novelty: 0.45,
    discovery: 0.52,
    pretense: 0.14,
    pressure: 0.1,
  }),
  main: createIntentVector({
    intimacy: 0.74,
    energy: 0.58,
    novelty: 0.56,
    discovery: 0.54,
    pretense: 0.28,
    pressure: 0.24,
  }),
  windDown: createIntentVector({
    intimacy: 0.82,
    energy: 0.28,
    novelty: 0.38,
    discovery: 0.38,
    pretense: 0.18,
    pressure: 0.1,
  }),
  flex: createIntentVector({
    intimacy: 0.6,
    energy: 0.5,
    novelty: 0.5,
    discovery: 0.5,
    pretense: 0.2,
    pressure: 0.2,
  }),
};

function resolvePrimaryGoogleType(types: string[], role: IdeaDateRole): string {
  const rolePriority = ROLE_TYPE_PRIORITY[role] ?? ROLE_TYPE_PRIORITY.flex;
  for (const preferredType of rolePriority) {
    if (types.includes(preferredType) && GOOGLE_TYPE_BASELINES[preferredType]) {
      return preferredType;
    }
  }
  for (const candidate of types) {
    if (GOOGLE_TYPE_BASELINES[candidate]) return candidate;
  }
  return 'default';
}

function blendIntentVectors(
  fromPlaceAndRole: IdeaDateIntentVector,
  blend: IdeaDateIntentVector
): IdeaDateIntentVector {
  const out = createZeroIntentVector();
  for (const key of IDEA_DATE_INTENT_KEYS) {
    out[key] = clamp01(fromPlaceAndRole[key] * 0.7 + blend[key] * 0.3);
  }
  return out;
}

function roleAdjustIntent(base: IdeaDateIntentVector, role: IdeaDateRole): IdeaDateIntentVector {
  const roleVector = ROLE_INTENT_BASELINES[role] ?? ROLE_INTENT_BASELINES.flex;
  const out = createZeroIntentVector();
  for (const key of IDEA_DATE_INTENT_KEYS) {
    out[key] = clamp01(base[key] * 0.75 + roleVector[key] * 0.25);
  }
  return out;
}

function roleAdjustEnergy(baseEnergy: number, role: IdeaDateRole): number {
  if (role === 'start') return clamp01(Math.min(baseEnergy, 0.52));
  if (role === 'main') return clamp01(baseEnergy + 0.08);
  if (role === 'windDown') return clamp01(baseEnergy - 0.12);
  return clamp01(baseEnergy);
}

function roleAdjustDuration(baseDurationMin: number, role: IdeaDateRole): number {
  if (role === 'start') return Math.round(baseDurationMin * 0.85);
  if (role === 'main') return Math.round(baseDurationMin * 1.1);
  if (role === 'windDown') return Math.round(baseDurationMin * 0.9);
  return Math.round(baseDurationMin);
}

function normalizeTypes(place: IdeaDatePlaceLike | null | undefined): string[] {
  const rawTypes = place?.placeLite?.types ?? [];
  if (!Array.isArray(rawTypes)) return [];
  return rawTypes
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export function hydrateIdeaDateStopProfile(input: {
  place?: IdeaDatePlaceLike | null;
  role: IdeaDateRole;
  blend?: Partial<IdeaDateIntentVector>;
}): IdeaDateStopProfile {
  const types = normalizeTypes(input.place);
  const primaryType = resolvePrimaryGoogleType(types, input.role);
  const baseline = GOOGLE_TYPE_BASELINES[primaryType] ?? GOOGLE_TYPE_BASELINES.default;
  const blendedTarget = createIntentVector(input.blend);
  const roleAdjustedIntent = roleAdjustIntent(baseline.intentVector, input.role);
  const intentVector = blendIntentVectors(roleAdjustedIntent, blendedTarget);

  return IdeaDateStopProfileSchema.parse({
    role: input.role,
    intentVector,
    energyLevel: roleAdjustEnergy(baseline.energyLevel, input.role),
    durationMin: roleAdjustDuration(baseline.durationMin, input.role),
    sourceGoogleType: baseline.googleType,
    overrides: { chillLively: 0, relaxedActive: 0, quickLingering: 0 },
  });
}

