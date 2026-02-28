import type { IdeaDatePrefTilt } from '@/lib/engine/idea-date/refineTilt';

export const IDEA_DATE_DEFAULT_MODE = 'default' as const;

export type IdeaDateMode =
  | 'default'
  | 'date_night'
  | 'tourist_day'
  | 'family'
  | 'low_mobility';

type IdeaDateModePolicy = {
  defaultPrefTilt: IdeaDatePrefTilt;
  label: string;
  description?: string;
};

export const IDEA_DATE_MODE_OPTIONS: readonly IdeaDateMode[] = [
  'default',
  'date_night',
  'tourist_day',
  'family',
  'low_mobility',
] as const;

const IDEA_DATE_MODE_POLICY_MAP: Record<IdeaDateMode, IdeaDateModePolicy> = {
  default: {
    label: 'Default',
    description: 'Balanced assistant defaults.',
    defaultPrefTilt: { vibe: 0, walking: 0, peak: 0 },
  },
  date_night: {
    label: 'Date Night',
    description: 'Slightly livelier pacing with a later peak.',
    defaultPrefTilt: { vibe: 1, walking: 0, peak: 1 },
  },
  tourist_day: {
    label: 'Tourist Day',
    description: 'Discovery-forward day plan with more walking.',
    defaultPrefTilt: { vibe: 1, walking: 1, peak: -1 },
  },
  family: {
    label: 'Family',
    description: 'Calmer pacing, shorter walking, earlier peak.',
    defaultPrefTilt: { vibe: -1, walking: -1, peak: -1 },
  },
  low_mobility: {
    label: 'Low Mobility',
    description: 'Minimize movement while preserving flow.',
    defaultPrefTilt: { vibe: 0, walking: -1, peak: 0 },
  },
};

export function isIdeaDateMode(value: unknown): value is IdeaDateMode {
  return typeof value === 'string' && (IDEA_DATE_MODE_OPTIONS as readonly string[]).includes(value);
}

export function normalizeIdeaDateMode(value: unknown): IdeaDateMode {
  if (isIdeaDateMode(value)) return value;
  return IDEA_DATE_DEFAULT_MODE;
}

export function getIdeaDateModePolicy(mode: IdeaDateMode): IdeaDateModePolicy {
  const policy = IDEA_DATE_MODE_POLICY_MAP[mode];
  return {
    label: policy.label,
    description: policy.description,
    defaultPrefTilt: { ...policy.defaultPrefTilt },
  };
}
