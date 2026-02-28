export type TemplateV2 = {
  id: string;
  name: string;
  description: string;
  defaultStopCount: number;
  discoveryPresetId: string;
};

export const DEFAULT_TEMPLATE_V2_ID = 'date-night';

export const TEMPLATES_V2: readonly TemplateV2[] = [
  {
    id: 'date-night',
    name: 'Date night',
    description: 'A simple, cozy multi-stop evening.',
    defaultStopCount: 4,
    discoveryPresetId: 'date-night',
  },
  {
    id: 'family-friendly',
    name: 'Family friendly',
    description: 'Easy wins with room for breaks.',
    defaultStopCount: 4,
    discoveryPresetId: 'family-friendly',
  },
  {
    id: 'night-out',
    name: 'Night out',
    description: 'High-energy stops with momentum.',
    defaultStopCount: 5,
    discoveryPresetId: 'night-out',
  },
  {
    id: 'quick-hang',
    name: 'Quick hang',
    description: 'Low lift, still feels intentional.',
    defaultStopCount: 3,
    discoveryPresetId: 'quick-hang',
  },
  {
    id: 'adventure',
    name: 'Adventure',
    description: 'A little ambitious, a lot memorable.',
    defaultStopCount: 5,
    discoveryPresetId: 'adventure',
  },
];

export function getTemplateV2ById(id: string | null | undefined): TemplateV2 | undefined {
  if (!id) return undefined;
  return TEMPLATES_V2.find((template) => template.id === id);
}

