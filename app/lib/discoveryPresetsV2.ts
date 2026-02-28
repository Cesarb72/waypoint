export type DiscoveryPresetV2 = {
  id: string;
  label: string;
  defaultQuery: string;
  uiHint?: string;
  filterHints?: {
    where?: string;
    mood?: string;
    tags?: string[];
  };
};

export const DISCOVERY_PRESETS_V2: readonly DiscoveryPresetV2[] = [
  {
    id: 'date-night',
    label: 'Date night',
    defaultQuery: 'cocktail bar',
    uiHint: 'Start with a drink, then dinner.',
    filterHints: { mood: 'reflective', tags: ['date-night', 'dinner'] },
  },
  {
    id: 'family-friendly',
    label: 'Family friendly',
    defaultQuery: 'family activity',
    uiHint: 'Look for easy wins nearby.',
    filterHints: { mood: 'chill', tags: ['family', 'outdoors'] },
  },
  {
    id: 'night-out',
    label: 'Night out',
    defaultQuery: 'live music',
    uiHint: 'Aim for energy and short hops.',
    filterHints: { mood: 'playful', tags: ['music', 'bar'] },
  },
  {
    id: 'quick-hang',
    label: 'Quick hang',
    defaultQuery: 'coffee shop',
    uiHint: 'Keep it close and simple.',
    filterHints: { mood: 'focused', tags: ['coffee', 'casual'] },
  },
  {
    id: 'adventure',
    label: 'Adventure',
    defaultQuery: 'fun activity',
    uiHint: 'Pick one bold anchor, then support it.',
    filterHints: { mood: 'adventurous', tags: ['activity', 'outdoors'] },
  },
];

export function getDiscoveryPresetV2ById(
  id: string | null | undefined
): DiscoveryPresetV2 | undefined {
  if (!id) return undefined;
  return DISCOVERY_PRESETS_V2.find((preset) => preset.id === id);
}

