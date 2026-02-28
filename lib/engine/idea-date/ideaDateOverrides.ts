import { createIntentVector } from './ideaDateConfig';
import { clamp01, IdeaDateStopProfileSchema, type IdeaDateOverrides, type IdeaDateStopProfile } from './schemas';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function applyChillLively(profile: IdeaDateStopProfile, amount: number): IdeaDateStopProfile {
  const normalized = clamp(amount, -1, 1);
  const livelyDelta = normalized * 0.22;
  const intentVector = createIntentVector({
    ...profile.intentVector,
    intimacy: clamp01(profile.intentVector.intimacy - livelyDelta),
    energy: clamp01(profile.intentVector.energy + livelyDelta),
    novelty: clamp01(profile.intentVector.novelty + normalized * 0.12),
    discovery: clamp01(profile.intentVector.discovery + normalized * 0.1),
    pretense: clamp01(profile.intentVector.pretense + normalized * 0.08),
    pressure: clamp01(profile.intentVector.pressure + normalized * 0.1),
  });
  return {
    ...profile,
    intentVector,
    energyLevel: clamp01(profile.energyLevel + livelyDelta * 0.5),
  };
}

function applyRelaxedActive(profile: IdeaDateStopProfile, amount: number): IdeaDateStopProfile {
  const normalized = clamp(amount, -1, 1);
  const energyDelta = normalized * 0.2;
  const intentVector = createIntentVector({
    ...profile.intentVector,
    energy: clamp01(profile.intentVector.energy + energyDelta),
    pressure: clamp01(profile.intentVector.pressure + normalized * 0.06),
  });
  return {
    ...profile,
    intentVector,
    energyLevel: clamp01(profile.energyLevel + energyDelta),
  };
}

function applyQuickLingering(profile: IdeaDateStopProfile, amount: number): IdeaDateStopProfile {
  const normalized = clamp(amount, -1, 1);
  const durationFactor = 1 + normalized * 0.25;
  const nextDuration = Math.round(profile.durationMin * durationFactor);
  const intentVector = createIntentVector({
    ...profile.intentVector,
    pressure: clamp01(profile.intentVector.pressure - normalized * 0.14),
  });
  return {
    ...profile,
    intentVector,
    durationMin: nextDuration,
  };
}

export function applyOverridesToProfile(
  base: IdeaDateStopProfile,
  overridesInput?: Partial<IdeaDateOverrides> | null
): IdeaDateStopProfile {
  const overrides: IdeaDateOverrides = {
    chillLively: clamp(overridesInput?.chillLively ?? 0, -1, 1),
    relaxedActive: clamp(overridesInput?.relaxedActive ?? 0, -1, 1),
    quickLingering: clamp(overridesInput?.quickLingering ?? 0, -1, 1),
  };

  let next = { ...base, overrides };
  next = applyChillLively(next, overrides.chillLively);
  next = applyRelaxedActive(next, overrides.relaxedActive);
  next = applyQuickLingering(next, overrides.quickLingering);

  return IdeaDateStopProfileSchema.parse({
    ...next,
    overrides,
  });
}
