'use client';

type VerticalTemplate = {
  id: string;
  name: string;
  intent?: { primaryOutcome?: string };
};

type Props = {
  verticalTemplate?: VerticalTemplate;
};

const FALLBACK_PURPOSE = 'Designed guidance for this experience type.';

const ICON_BY_ID: Record<string, string> = {
  'idea-date': '💡',
  'tourism-dmo': '🧭',
  'restaurants-hospitality': '🍽️',
  'community-org': '🤝',
  'events-festivals': '🎟️',
};

function resolveIcon(id?: string): string {
  if (!id) return '🧭';
  return ICON_BY_ID[id] ?? '🧭';
}

export function VerticalIdentityHeader({ verticalTemplate }: Props) {
  const hasTemplate = Boolean(verticalTemplate);
  const title = hasTemplate ? verticalTemplate?.name ?? 'Vertical' : 'Generic plan';
  const purpose = hasTemplate
    ? verticalTemplate?.intent?.primaryOutcome?.trim() || FALLBACK_PURPOSE
    : 'No vertical guidance applied.';
  const icon = resolveIcon(verticalTemplate?.id);

  return (
    <section className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none" aria-hidden="true">
          {icon}
        </span>
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <div className="text-[11px] text-slate-400">{purpose}</div>
        </div>
      </div>
    </section>
  );
}
