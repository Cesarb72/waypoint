import { createPlanFromTemplate, nowIso, generateId } from '@/app/plan-engine/defaults';
import type { Plan, Stop } from '@/app/plan-engine/types';
import type { Template, TemplateStop } from '@/types/templates';
import { normalizeStop } from '@/lib/stopLocation';

type CreatePlanOverrides = Partial<
  Pick<Plan, 'title' | 'intent' | 'audience' | 'context'>
> & {
  resolvedStopNames?: Record<string, string>;
};

export function getTemplateStopDisplayLabel(
  stop: TemplateStop,
  resolvedName?: string
): string {
  if (resolvedName && resolvedName.trim()) return resolvedName;
  if (stop.placeRef?.query && stop.placeRef.query.trim()) return stop.placeRef.query.trim();
  return stop.label;
}

function mapTemplateStop(
  stop: TemplateStop,
  resolvedStopNames?: Record<string, string>
): Stop {
  const resolvedName = resolvedStopNames?.[stop.id];
  const role = stop.role;
  const hasPlaceId = Boolean(stop.placeRef?.placeId && stop.placeRef.placeId.trim());
  const baseStop: Stop = {
    id: generateId(),
    name: getTemplateStopDisplayLabel(stop, resolvedName),
    role,
    optionality: role === 'optional' ? 'flexible' : 'required',
    placeRef: stop.placeRef,
    resolve:
      !hasPlaceId && (stop.resolveQuery || stop.resolveNear || stop.isPlaceholder)
        ? {
            q: stop.resolveQuery,
            near: stop.resolveNear,
            placeholder: stop.isPlaceholder,
          }
        : undefined,
  };
  return normalizeStop(baseStop).stop;
}

export function createPlanFromTemplateSeed(
  template: Template,
  overrides?: CreatePlanOverrides
): Plan {
  const timestamp = nowIso();
  const startAt = template.defaults?.startAt ?? null;
  const endAt = template.defaults?.endAt ?? null;
  const timeWindow = template.defaults?.when;
  const planSource =
    template.origin ?? (template.kind === 'experience' ? 'curated' : 'template');
  const base = createPlanFromTemplate({
    title: overrides?.title ?? template.title,
    intent: overrides?.intent ?? template.defaults?.intent ?? template.description,
    audience: overrides?.audience ?? 'me-and-friends',
    stops: template.stops.map((stop) => mapTemplateStop(stop, overrides?.resolvedStopNames)),
    constraints:
      timeWindow || startAt || endAt
        ? {
            timeWindow: timeWindow?.trim() || undefined,
            startAt,
            endAt,
          }
        : undefined,
    brand: template.brand ? { ...template.brand } : undefined,
    origin: {
      kind: planSource,
      source: planSource,
      templateId: template.id,
      title: template.title,
      label: template.title,
    },
    metadata: {
      createdAt: timestamp,
      lastUpdated: timestamp,
    },
  });

  base.createdFrom =
    template.kind === 'experience'
      ? {
          kind: 'experience',
          experienceId: template.id,
          experienceTitle: template.title,
        }
      : {
          kind: 'template',
          templateId: template.id,
          templateTitle: template.title,
        };

  return base;
}
