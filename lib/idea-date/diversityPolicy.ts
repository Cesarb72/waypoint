import type { DiversityPolicy } from '@/lib/engine/idea-date/diversityRanking';

export type IdeaDateRuntimeMode = 'development' | 'staging' | 'production';

const IDEA_DATE_LIGHT_DIVERSITY_WEIGHT = 0.0005;
const IDEA_DATE_NEAR_EQUAL_ARC_DELTA = 0.015;

function readRuntimeMode(): IdeaDateRuntimeMode {
  if (process.env.NODE_ENV !== 'production') return 'development';
  const vercelEnv = (process.env.VERCEL_ENV ?? '').trim().toLowerCase();
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV ?? '').trim().toLowerCase();
  if (vercelEnv === 'preview' || appEnv === 'staging') {
    return 'staging';
  }
  return 'production';
}

export function readIdeaDateDiversityPolicy(mode = readRuntimeMode()): DiversityPolicy {
  if (mode === 'development' || mode === 'staging') {
    return {
      diversity: {
        enabled: true,
        weight: IDEA_DATE_LIGHT_DIVERSITY_WEIGHT,
      },
      nearEqualArcDelta: IDEA_DATE_NEAR_EQUAL_ARC_DELTA,
    };
  }
  return {
    diversity: {
      enabled: false,
      weight: 0,
    },
    nearEqualArcDelta: IDEA_DATE_NEAR_EQUAL_ARC_DELTA,
  };
}

