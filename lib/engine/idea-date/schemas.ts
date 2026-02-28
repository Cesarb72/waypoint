import { z } from 'zod';
import {
  IDEA_DATE_DEFAULT_TRAVEL_MODE,
  IDEA_DATE_INTENT_KEYS,
  createZeroIntentVector,
  getIdeaDateVibeProfile,
  type IdeaDateIntentVector,
  type IdeaDateRole,
  type IdeaDateTravelMode,
  type IdeaDateVibeId,
} from './ideaDateConfig';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

const UnitNumberSchema = z
  .any()
  .transform((value) => clamp01(readNumber(value, 0)));

const DurationNumberSchema = z
  .any()
  .transform((value) => clamp(Math.round(readNumber(value, 75)), 20, 240));

const EnergyNumberSchema = z
  .any()
  .transform((value) => clamp01(readNumber(value, 0.45)));

export const IdeaDateIntentVectorSchema = z
  .object({
    intimacy: UnitNumberSchema.optional(),
    energy: UnitNumberSchema.optional(),
    novelty: UnitNumberSchema.optional(),
    discovery: UnitNumberSchema.optional(),
    pretense: UnitNumberSchema.optional(),
    pressure: UnitNumberSchema.optional(),
  })
  .partial()
  .default(createZeroIntentVector())
  .transform((value) => {
    const out = createZeroIntentVector();
    for (const key of IDEA_DATE_INTENT_KEYS) {
      out[key] = clamp01(readNumber(value[key], 0));
    }
    return out;
  });

export type IdeaDateOverrides = {
  chillLively: number;
  relaxedActive: number;
  quickLingering: number;
};

export const IdeaDateOverridesSchema = z
  .object({
    chillLively: z.any().optional(),
    relaxedActive: z.any().optional(),
    quickLingering: z.any().optional(),
  })
  .partial()
  .default({
    chillLively: 0,
    relaxedActive: 0,
    quickLingering: 0,
  })
  .transform((value): IdeaDateOverrides => ({
    chillLively: clamp(readNumber(value.chillLively, 0), -1, 1),
    relaxedActive: clamp(readNumber(value.relaxedActive, 0), -1, 1),
    quickLingering: clamp(readNumber(value.quickLingering, 0), -1, 1),
  }));

const RoleSchema = z.enum(['start', 'main', 'windDown', 'flex']);
const VibeIdSchema = z.enum(['first_date_low_pressure', 'anniversary_intimate']);
const TravelModeSchema = z.enum(['walk', 'drive']);

export type IdeaDateStopProfile = {
  role: IdeaDateRole;
  intentVector: IdeaDateIntentVector;
  energyLevel: number;
  durationMin: number;
  sourceGoogleType: string | null;
  overrides: IdeaDateOverrides;
};

export const IdeaDateStopProfileSchema = z
  .object({
    role: RoleSchema.default('flex'),
    intentVector: IdeaDateIntentVectorSchema.default(createZeroIntentVector()),
    energyLevel: EnergyNumberSchema.default(0.45),
    durationMin: DurationNumberSchema.default(75),
    sourceGoogleType: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .nullable()
      .optional(),
    overrides: IdeaDateOverridesSchema.default({
      chillLively: 0,
      relaxedActive: 0,
      quickLingering: 0,
    }),
  })
  .transform((value): IdeaDateStopProfile => ({
    role: value.role,
    intentVector: value.intentVector,
    energyLevel: clamp01(value.energyLevel),
    durationMin: clamp(value.durationMin, 20, 240),
    sourceGoogleType: value.sourceGoogleType ?? null,
    overrides: value.overrides,
  }));

export type IdeaDatePlanProfile = {
  vibeId: IdeaDateVibeId;
  vibeTarget: IdeaDateIntentVector;
  vibeImportance: IdeaDateIntentVector;
  travelMode: IdeaDateTravelMode;
};

export const IdeaDatePlanProfileSchema = z
  .object({
    vibeId: VibeIdSchema.default('first_date_low_pressure'),
    vibeTarget: IdeaDateIntentVectorSchema.optional(),
    vibeImportance: IdeaDateIntentVectorSchema.optional(),
    travelMode: TravelModeSchema.default(IDEA_DATE_DEFAULT_TRAVEL_MODE),
  })
  .transform((value): IdeaDatePlanProfile => {
    const vibe = getIdeaDateVibeProfile(value.vibeId);
    return {
      vibeId: value.vibeId,
      vibeTarget: value.vibeTarget ?? vibe.target,
      vibeImportance: value.vibeImportance ?? vibe.importance,
      travelMode: value.travelMode,
    };
  });

export function parseIdeaDatePlanProfile(value: unknown): IdeaDatePlanProfile {
  return IdeaDatePlanProfileSchema.parse(value);
}

export function parseIdeaDateStopProfile(value: unknown): IdeaDateStopProfile {
  return IdeaDateStopProfileSchema.parse(value);
}

export function clampIdeaDateIntentVector(input: Partial<IdeaDateIntentVector>): IdeaDateIntentVector {
  const out = {} as IdeaDateIntentVector;
  for (const key of IDEA_DATE_INTENT_KEYS) {
    out[key] = clamp01(readNumber(input[key], 0));
  }
  return out;
}
