import type { ExperiencePackSummary } from './experiencePackQueries';

export type ExperiencePackDraft = {
  templateId: string;
  city?: string | null;
  typicalStopsCount?: number | null;
  commonStopSequence?: string[];
  typicalHourBin?: string | null;
  notes: string[];
  evidence: {
    distinctPlans: number;
    totalSignals: number;
    timeframe?: string | null;
  };
};

type ExperiencePackPreviewDefaults = {
  typicalStopsCount: number;
  typicalHourBin?: string | null;
};

const DEFAULT_PREVIEW_DEFAULTS: ExperiencePackPreviewDefaults = {
  typicalStopsCount: 2,
};

export const PACK_DEFAULTS: Record<string, ExperiencePackPreviewDefaults> = {
  'idea-date': {
    typicalStopsCount: 2,
    typicalHourBin: '18-21',
  },
  'tourism-dmo': {
    typicalStopsCount: 3,
    typicalHourBin: '12-18',
  },
  'events-festival': {
    typicalStopsCount: 3,
    typicalHourBin: '18-24',
  },
  'restaurants-hospitality': {
    typicalStopsCount: 2,
    typicalHourBin: '18-21',
  },
  'community-organization': {
    typicalStopsCount: 2,
    typicalHourBin: '9-15',
  },
};

export function getExperiencePackPreviewDefaults(
  templateId?: string | null
): ExperiencePackPreviewDefaults {
  const key = templateId?.trim() ?? '';
  return PACK_DEFAULTS[key] ?? DEFAULT_PREVIEW_DEFAULTS;
}

export function buildExperiencePackDraft(
  summary: ExperiencePackSummary,
  args: { templateId: string; city?: string | null }
): ExperiencePackDraft {
  const summaryEvidence = summary.evidence as ExperiencePackSummary['evidence'] & {
    distinctPlans?: number;
    totalSignals?: number;
    timeframe?: string | null;
  };
  const distinctPlans = Math.max(
    0,
    Math.round(summaryEvidence.distinctPlans ?? summaryEvidence.count ?? 0)
  );
  const totalSignals = Math.max(
    distinctPlans,
    Math.round(summaryEvidence.totalSignals ?? distinctPlans)
  );
  const city = args.city ?? summaryEvidence.city ?? null;
  const summaryWithOptionalMedian = summary as ExperiencePackSummary & {
    median_stop_count?: number;
  };
  const stopCountRaw =
    summaryWithOptionalMedian.median_stop_count ?? summary.recommended_stop_count;
  const roundedStops = Number.isFinite(stopCountRaw)
    ? Math.round(stopCountRaw)
    : null;

  return {
    templateId: args.templateId,
    city,
    typicalStopsCount: roundedStops,
    commonStopSequence: summary.common_stop_sequence,
    typicalHourBin: summary.common_hour_bin,
    notes: [
      `Derived from recently completed plans in ${city ?? 'this city'} for this toolkit.`,
      'This is a draft suggestion - you can edit or ignore it.',
      'No personalization yet.',
    ],
    evidence: {
      distinctPlans,
      totalSignals,
      timeframe: summaryEvidence.timeframe ?? null,
    },
  };
}

export function buildPreviewExperiencePackDraft(args: {
  templateId: string;
  city?: string | null;
  templateStopTypeIds: string[];
}): ExperiencePackDraft {
  const defaults = getExperiencePackPreviewDefaults(args.templateId);
  const sequence = args.templateStopTypeIds.filter(
    (stopTypeId) => typeof stopTypeId === 'string' && stopTypeId.trim().length > 0
  );
  return {
    templateId: args.templateId,
    city: args.city ?? null,
    typicalStopsCount: defaults.typicalStopsCount,
    commonStopSequence: sequence,
    typicalHourBin: defaults.typicalHourBin ?? null,
    notes: [
      'Preview mode: rule-driven from this toolkit and your current plan context.',
      'Not based on completed plans from other users.',
      'This is a draft suggestion - you can edit or ignore it.',
    ],
    evidence: {
      distinctPlans: 0,
      totalSignals: 0,
      timeframe: null,
    },
  };
}
