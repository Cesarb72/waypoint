export type WaypointTemplate = {
  id: 'date-night' | 'family-trip' | 'venue-event';
  name: string;
  description: string;
  defaultStops: number;
  intentQueryHints: string[];
  icon?: string;
};

export type DiscoveryPreset = {
  id: string;
  label: string;
  query: string;
  mood?: string | null;
  hint?: string;
};

export const WAYPOINT_TEMPLATES: WaypointTemplate[] = [
  {
    id: 'date-night',
    name: 'Date Night',
    description: 'Dinner + a vibe + a closer.',
    defaultStops: 3,
    intentQueryHints: ['cocktail bar', 'dinner', 'live music'],
    icon: '🍸',
  },
  {
    id: 'family-trip',
    name: 'Family Trip',
    description: "Kid-friendly stops that don\u2019t melt down the group chat.",
    defaultStops: 3,
    intentQueryHints: ['park', 'casual food', 'activity'],
    icon: '🧃',
  },
  {
    id: 'venue-event',
    name: 'Venue Event',
    description: 'Pre/post stops around a venue (food, drinks, parking).',
    defaultStops: 3,
    intentQueryHints: ['food near venue', 'drinks near venue', 'parking'],
    icon: '🎟️',
  },
];

export const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  {
    id: 'date-night',
    label: 'Date night',
    query: 'cozy bar dessert',
    mood: 'chill',
    hint: 'Cozy, romantic, and relaxed.',
  },
  {
    id: 'family-friendly',
    label: 'Family-friendly',
    query: 'family friendly lunch park',
    mood: null,
    hint: 'Kid-friendly options.',
  },
  {
    id: 'nightlife',
    label: 'Nightlife',
    query: 'cocktail bar live music',
    mood: null,
    hint: 'Late-night energy.',
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    query: 'outdoor patio coffee',
    mood: null,
    hint: 'Fresh air and sunshine.',
  },
  {
    id: 'quick-bite',
    label: 'Quick bite',
    query: 'quick casual food',
    mood: null,
    hint: 'Fast and easy.',
  },
  {
    id: 'culture',
    label: 'Culture',
    query: 'museum gallery coffee',
    mood: null,
    hint: 'Art and a slow stop.',
  },
];
