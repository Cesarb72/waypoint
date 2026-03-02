import type { Plan } from '@/lib/core/planTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getIdeaDateMeta(plan: Plan): Record<string, unknown> | undefined {
  return getVerticalMeta(plan, 'ideaDate');
}

export function getVerticalMeta(plan: Plan, verticalKey: string): Record<string, unknown> | undefined {
  const meta = isRecord(plan.meta) ? plan.meta : null;
  if (!meta) return undefined;
  const verticalMeta = meta[verticalKey];
  return isRecord(verticalMeta) ? verticalMeta : undefined;
}

export function setVerticalMeta(
  plan: Plan,
  verticalKey: string,
  partial: Record<string, unknown>
): Plan {
  const nextMeta = isRecord(plan.meta) ? plan.meta : {};
  const nextVertical = isRecord(nextMeta[verticalKey]) ? nextMeta[verticalKey] : {};
  const mergedMeta: Record<string, unknown> = {
    ...nextMeta,
    [verticalKey]: {
      ...nextVertical,
      ...partial,
    },
  };
  return {
    ...plan,
    meta: mergedMeta as Plan['meta'],
  };
}

export function setIdeaDateMeta(plan: Plan, partial: Record<string, unknown>): Plan {
  return setVerticalMeta(plan, 'ideaDate', partial);
}

export function setLocalActivationMeta(plan: Plan, partial: Record<string, unknown>): Plan {
  return setVerticalMeta(plan, 'localActivation', partial);
}

