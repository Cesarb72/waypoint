'use client';

type StopTypeLike = {
  id: string;
  label: string;
};

type VerticalTemplateLike = {
  stopTypes: StopTypeLike[];
};

type StopLike = {
  stop_type_id?: string | null;
};

export function resolveStopTypeLabel(
  verticalTemplate: VerticalTemplateLike | undefined,
  stop: StopLike | null | undefined,
  fallbackLabel: string
): string {
  const stopTypeId = stop?.stop_type_id ?? null;
  if (!stopTypeId) return fallbackLabel;
  const match = verticalTemplate?.stopTypes?.find((stopType) => stopType.id === stopTypeId);
  return match?.label ?? fallbackLabel;
}

type BadgeProps = {
  label: string;
};

export function StopTypeBadge({ label }: BadgeProps) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
      {label}
    </span>
  );
}
