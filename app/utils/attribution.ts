import type { Plan, PlanOrigin } from '../plan-engine';

export type Attribution = {
  headline: string;
  byline: string;
  provenance: string;
  modeHint: string;
};

type AttributionOptions = {
  surface: 'share' | 'embed';
  mode: 'view' | 'edit';
};

function formatOrigin(origin?: PlanOrigin | null): string | null {
  if (!origin) return null;
  const label = origin.label?.trim();
  const query = origin.query?.trim();
  const mood = origin.mood?.trim();

  switch (origin.kind) {
    case 'search':
      if (query) return `Search "${query}"`;
      if (label) return `Search "${label}"`;
      return 'Search';
    case 'mood':
      if (mood) return `Mood "${mood}"`;
      if (label) return `Mood "${label}"`;
      return 'Mood';
    case 'surprise':
      if (label) return `Surprise "${label}"`;
      return 'Surprise';
    case 'template':
      if (label) return `Template "${label}"`;
      return 'Template';
    case 'curated':
      if (label) return `Curated "${label}"`;
      return 'Curated';
    case 'unknown':
      return label ?? 'Waypoint';
    default:
      if (label) return label;
      return 'Waypoint';
  }
}

export function getAttribution(plan: Plan, options: AttributionOptions): Attribution {
  const presenter = plan.metadata?.createdBy?.trim();
  const brandingName = plan.presentation?.branding?.name?.trim();
  const origin = plan.meta?.origin ?? plan.origin;
  const originSummary = formatOrigin(origin);

  const headline = options.surface === 'embed' ? 'Waypoint Embed' : 'Shared plan';

  const byline = presenter
    ? `Shared by ${presenter}`
    : brandingName
    ? `Shared from ${brandingName}`
    : 'Shared from Waypoint';

  const provenance = originSummary ? `Origin: ${originSummary}` : 'Origin: Waypoint';

  const modeHint =
    options.surface === 'embed'
      ? 'Read-only'
      : options.mode === 'edit'
      ? 'Editing your version'
      : 'Viewing shared plan';

  return { headline, byline, provenance, modeHint };
}
