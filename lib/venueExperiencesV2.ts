export type VenueExperienceV2 = {
  id: string;
  title: string;
  venueName: string;
  locationHint: string;
  description: string;
  audienceTags: string[];
  experienceType: 'workshop' | 'immersive' | 'dining' | 'nature' | 'tour' | 'social';
  discoveryPresetId: string;
  defaultQuery: string;
  defaultStopCount: number;
  seededStops?: string[];
  accent?: string;
  logoUrl?: string;
};

export const VENUE_EXPERIENCES_V2: readonly VenueExperienceV2[] = [
  {
    id: 'jashn-romantic',
    title: 'Romantic Dinner + Walk',
    venueName: 'Jashn',
    locationHint: 'Downtown',
    description: 'A cozy dinner anchor with a scenic walk and dessert finish.',
    audienceTags: ['couples', 'date-night'],
    experienceType: 'dining',
    discoveryPresetId: 'date-night',
    defaultQuery: 'cocktail bar',
    defaultStopCount: 3,
    seededStops: ['Dinner reservation', 'Scenic walk', 'Dessert or nightcap'],
    accent: '#f472b6',
    logoUrl: 'https://example.com/logo-jashn.png',
  },
  {
    id: 'night-market-social',
    title: 'Night Market Social',
    venueName: 'City Night Market',
    locationHint: 'Arts District',
    description: 'Grab bites, linger for live music, and end with a late-night treat.',
    audienceTags: ['friends', 'social'],
    experienceType: 'social',
    discoveryPresetId: 'night-out',
    defaultQuery: 'live music',
    defaultStopCount: 4,
    seededStops: ['Market stroll', 'Street food bite', 'Live music / hang', 'Late-night treat'],
    accent: '#38bdf8',
  },
  {
    id: 'family-museum',
    title: 'Family Museum Day',
    venueName: 'City Science Museum',
    locationHint: 'Midtown',
    description: 'A low-stress family outing with an easy meal and wind-down stop.',
    audienceTags: ['families', 'kids'],
    experienceType: 'immersive',
    discoveryPresetId: 'family-friendly',
    defaultQuery: 'family activity',
    defaultStopCount: 4,
    seededStops: ['Museum entry', 'Interactive exhibit', 'Snack break', 'Wind-down stop'],
    accent: '#a78bfa',
  },
  {
    id: 'garden-tea',
    title: 'Garden + Tea Reset',
    venueName: 'Greenhouse Collective',
    locationHint: 'Riverfront',
    description: 'Slow down with a garden stroll, tea, and a light bite.',
    audienceTags: ['solo', 'chill'],
    experienceType: 'nature',
    discoveryPresetId: 'quick-hang',
    defaultQuery: 'coffee shop',
    defaultStopCount: 3,
    seededStops: ['Garden stroll', 'Tea service', 'Quiet reading nook'],
    accent: '#34d399',
  },
  {
    id: 'urban-adventure',
    title: 'Urban Adventure Loop',
    venueName: 'Waypoint Curators',
    locationHint: 'City center',
    description: 'One bold activity, then a chill reward stop to reset.',
    audienceTags: ['adventure', 'friends'],
    experienceType: 'tour',
    discoveryPresetId: 'adventure',
    defaultQuery: 'fun activity',
    defaultStopCount: 3,
    seededStops: ['Main activity', 'Photo spot', 'Reward drink/coffee'],
    accent: '#f59e0b',
  },
];

export function getVenueExperienceV2ById(
  id: string | null | undefined
): VenueExperienceV2 | undefined {
  if (!id) return undefined;
  return VENUE_EXPERIENCES_V2.find((experience) => experience.id === id);
}
