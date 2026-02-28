import { getExperiencePackPreviewDefaults } from '../packs/experiencePackDraft';

type StopType = {
  id: string;
  label?: string;
};

type ExperiencePackLike = {
  common_stop_sequence?: string[];
  recommended_stop_count?: number | null;
  median_stop_count?: number | null;
};

export type V52Suggestion = {
  id:
    | 'plan_strength_fragility'
    | 'stop_type_delta'
    | 'day_weekend_suitability'
    | 'seasonal_shift_hint';
  title: string;
  why: string;
  mode: 'earned' | 'preview';
};

function findFirstMissing(sequence: string[], existing: Set<string>): string | null {
  for (const stopTypeId of sequence) {
    const trimmed = stopTypeId?.trim();
    if (!trimmed) continue;
    if (!existing.has(trimmed)) return trimmed;
  }
  return null;
}

export function buildV52CoachSuggestions(args: {
  templateId: string;
  locationLabel?: string | null;
  city?: string | null;
  hasAnchorDate?: boolean;
  topDayOfWeek?: number | null;
  monthOverMonthDelta?: number | null;
  currentStopCount: number;
  currentStopTypeIds: string[];
  verticalStopTypes: StopType[];
  earnedSummary?: ExperiencePackLike | null;
}): V52Suggestion[] {
  const suggestions: V52Suggestion[] = [];
  const locationLabel = args.locationLabel?.trim() || args.city?.trim() || 'this location';
  const hasAnchorDate = Boolean(args.hasAnchorDate);
  const topDayOfWeek =
    typeof args.topDayOfWeek === 'number' && args.topDayOfWeek >= 0 && args.topDayOfWeek <= 6
      ? args.topDayOfWeek
      : null;
  const monthOverMonthDelta =
    typeof args.monthOverMonthDelta === 'number' ? args.monthOverMonthDelta : null;
  const todayDayOfWeek = new Date().getDay();
  const todayIsWeekend = todayDayOfWeek === 0 || todayDayOfWeek === 6;
  const topDayIsWeekend = topDayOfWeek === 0 || topDayOfWeek === 6;
  const hasWeekendPatternMismatch =
    typeof topDayOfWeek === 'number' &&
    ((topDayIsWeekend && !todayIsWeekend) || (!topDayIsWeekend && todayIsWeekend));

  if (hasWeekendPatternMismatch) {
    const title = topDayIsWeekend
      ? `This toolkit in ${locationLabel} tends to complete more on weekends.`
      : `This toolkit in ${locationLabel} tends to complete more on weekdays.`;
    suggestions.push({
      id: 'day_weekend_suitability',
      title,
      why: `Why: based on completed-plan day-of-week signals for this toolkit in ${locationLabel}.`,
      mode: 'earned',
    });
  } else if (!hasAnchorDate) {
    suggestions.push({
      id: 'day_weekend_suitability',
      title: 'Set a date to help the plan fit the right day.',
      why: 'Why: no anchor date is set yet, so day-of-week fit cannot be assessed.',
      mode: 'preview',
    });
  }

  const TREND_THRESHOLD = 2;
  if (typeof monthOverMonthDelta === 'number' && Math.abs(monthOverMonthDelta) >= TREND_THRESHOLD) {
    const trendWord = monthOverMonthDelta > 0 ? 'up' : 'down';
    suggestions.push({
      id: 'seasonal_shift_hint',
      title: `This area is trending ${trendWord} this month for this toolkit.`,
      why: `Why: based on month-over-month completion counts for this toolkit in ${locationLabel}.`,
      mode: 'earned',
    });
  } else {
    suggestions.push({
      id: 'seasonal_shift_hint',
      title: 'Seasonal trends will appear once more plans are completed.',
      why: `Why: trend signals are not yet stable for this toolkit in ${locationLabel}.`,
      mode: 'preview',
    });
  }

  const existingStopTypes = new Set(
    args.currentStopTypeIds
      .map((stopTypeId) => stopTypeId.trim())
      .filter((stopTypeId) => stopTypeId.length > 0)
  );
  const stopTypeLabelById = new Map<string, string>();
  args.verticalStopTypes.forEach((stopType) => {
    const stopTypeId = stopType.id?.trim();
    if (!stopTypeId) return;
    stopTypeLabelById.set(stopTypeId, stopType.label?.trim() || stopTypeId);
  });

  const earnedMedianRaw =
    args.earnedSummary?.median_stop_count ?? args.earnedSummary?.recommended_stop_count ?? null;
  const earnedMedian = Number.isFinite(earnedMedianRaw)
    ? Math.round(earnedMedianRaw as number)
    : null;
  if (typeof earnedMedian === 'number') {
    if (args.currentStopCount <= earnedMedian - 1) {
      suggestions.push({
        id: 'plan_strength_fragility',
        title:
          'This plan is structurally light (more likely to drop off). Consider adding a support stop.',
        why: `Why: based on completed-plan stop-count patterns for this toolkit in ${locationLabel}.`,
        mode: 'earned',
      });
    } else if (args.currentStopCount >= earnedMedian + 2) {
      suggestions.push({
        id: 'plan_strength_fragility',
        title: 'This plan is dense. Consider grouping or trimming to reduce friction.',
        why: `Why: based on completed-plan stop-count patterns for this toolkit in ${locationLabel}.`,
        mode: 'earned',
      });
    }
  } else {
    const previewDefaults = getExperiencePackPreviewDefaults(args.templateId);
    if (args.currentStopCount < previewDefaults.typicalStopsCount) {
      suggestions.push({
        id: 'plan_strength_fragility',
        title:
          'This plan is structurally light (more likely to drop off). Consider adding a support stop.',
        why: `Why: preview template defaults for ${args.templateId || 'this toolkit'} suggest a slightly fuller structure.`,
        mode: 'preview',
      });
    }
  }

  const earnedSequence = (args.earnedSummary?.common_stop_sequence ?? []).filter(
    (stopTypeId) => typeof stopTypeId === 'string' && stopTypeId.trim().length > 0
  );
  if (earnedSequence.length > 0) {
    const missingEarnedStopTypeId = findFirstMissing(earnedSequence, existingStopTypes);
    if (missingEarnedStopTypeId) {
      const label = stopTypeLabelById.get(missingEarnedStopTypeId) ?? missingEarnedStopTypeId;
      suggestions.push({
        id: 'stop_type_delta',
        title: `Consider adding: ${label}.`,
        why: `Why: completed plans of this toolkit in ${locationLabel} most often include: ${label}.`,
        mode: 'earned',
      });
    }
  } else {
    const previewSequence = args.verticalStopTypes
      .map((stopType) => stopType.id?.trim() || '')
      .filter((stopTypeId) => stopTypeId.length > 0);
    const missingPreviewStopTypeId = findFirstMissing(previewSequence, existingStopTypes);
    if (missingPreviewStopTypeId) {
      const label = stopTypeLabelById.get(missingPreviewStopTypeId) ?? missingPreviewStopTypeId;
      suggestions.push({
        id: 'stop_type_delta',
        title: `Consider adding: ${label}.`,
        why: `Why: preview defaults suggest this toolkit usually starts with ${label}.`,
        mode: 'preview',
      });
    }
  }

  return suggestions.slice(0, 2);
}
