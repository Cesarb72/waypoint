import type { Plan, PresentationAccent } from '../plan-engine';

type AccentStyle = {
  badge: string;
  line: string;
};

const ACCENT_STYLES: Record<PresentationAccent, AccentStyle> = {
  slate: {
    badge: 'border-slate-700 bg-slate-800 text-slate-200',
    line: 'border-l-slate-600',
  },
  blue: {
    badge: 'border-sky-700/70 bg-sky-500/10 text-sky-200',
    line: 'border-l-sky-500/70',
  },
  emerald: {
    badge: 'border-emerald-700/70 bg-emerald-500/10 text-emerald-200',
    line: 'border-l-emerald-500/70',
  },
  violet: {
    badge: 'border-violet-700/70 bg-violet-500/10 text-violet-200',
    line: 'border-l-violet-500/70',
  },
  amber: {
    badge: 'border-amber-700/70 bg-amber-500/10 text-amber-200',
    line: 'border-l-amber-500/70',
  },
};

export const ACCENT_OPTIONS: PresentationAccent[] = [
  'slate',
  'blue',
  'emerald',
  'violet',
  'amber',
];

type BrandingLite = {
  presentedBy: string | null;
  logoUrl: string | null;
  accent: PresentationAccent | null;
  accentClass: string | null;
  accentLineClass: string | null;
};

function sanitizeSingleLine(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function sanitizeLogoUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isAccent(value?: string | null): value is PresentationAccent {
  if (!value) return false;
  return ACCENT_OPTIONS.includes(value as PresentationAccent);
}

export function getBrandingLite(plan: Plan): BrandingLite | null {
  const presentation = plan.presentation;
  const branding = presentation?.branding;

  const presentedBy =
    sanitizeSingleLine(presentation?.presentedBy) ?? sanitizeSingleLine(branding?.name);
  const logoUrl =
    sanitizeLogoUrl(presentation?.logoUrl) ?? sanitizeLogoUrl(branding?.logoUrl);
  const accentRaw = presentation?.accent ?? branding?.accentColor;
  const accent = isAccent(accentRaw) ? accentRaw : null;
  const accentClass = accent ? ACCENT_STYLES[accent].badge : null;
  const accentLineClass = accent ? ACCENT_STYLES[accent].line : null;

  if (!presentedBy && !logoUrl && !accent) return null;

  return { presentedBy, logoUrl, accent, accentClass, accentLineClass };
}
