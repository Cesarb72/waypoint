import type { Template } from '@/types/templates';
import { hasStopMapTarget } from '@/lib/stopLocation';

export const TEMPLATE_SEEDS: Template[] = [
  {
    id: 'jashn-romantic',
    version: 1,
    kind: 'experience',
    origin: 'curated',
    title: 'Romantic Dinner + Walk',
    description: 'A cozy dinner anchor with a scenic walk and dessert finish.',
    defaults: {
      intent: 'A relaxed date night with a soft finish.',
      city: 'San Jose',
      when: 'Friday evening',
    },
    stops: [
      {
        id: 'jashn-dinner',
        label: 'Dinner reservation',
        role: 'anchor',
        isPlaceholder: true,
        placeRef: { query: 'romantic dinner' },
      },
      {
        id: 'jashn-walk',
        label: 'Scenic walk',
        role: 'support',
        isPlaceholder: true,
        placeRef: { query: 'scenic walk' },
      },
      {
        id: 'jashn-dessert',
        label: 'Dessert or nightcap',
        role: 'optional',
        isPlaceholder: true,
        placeRef: { query: 'dessert cafe' },
      },
    ],
  },
  {
    id: 'night-market-social',
    version: 1,
    kind: 'experience',
    origin: 'curated',
    title: 'Night Market Social',
    description: 'Grab bites, linger for live music, and end with a late-night treat.',
    brand: {
      name: 'Visit San Jose',
      accent: '#f59e0b',
      byline: 'Presented by Visit San Jose',
      ctaLabel: 'More night events',
      ctaUrl: 'https://www.sanjose.org/events',
    },
    defaults: {
      intent: 'A social night with a loose schedule.',
      city: 'San Jose',
      when: 'Saturday night',
      startAt: '2026-02-07T19:00:00Z',
      endAt: '2026-02-07T22:00:00Z',
    },
    stops: [
      {
        id: 'night-market-stroll',
        label: 'Berryessa Night Market',
        role: 'support',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJCeglYg_Nj4AR_67C_BFWcq4',
          label: 'Berryessa Night Market',
        },
      },
      {
        id: 'night-market-bite',
        label: 'Indian Street Food - Food Truck',
        role: 'anchor',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJtQ3ndCO3j4ARTToNOS78Zrg',
          label: 'Indian Street Food - Food Truck',
        },
      },
      {
        id: 'night-market-music',
        label: 'Quarter Note Bar & Grill',
        role: 'optional',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJbdQi0h22j4ARhEaYM2ENgXI',
          label: 'Quarter Note Bar & Grill',
        },
      },
    ],
  },
  {
    id: 'family-museum',
    version: 1,
    kind: 'experience',
    origin: 'curated',
    title: 'Family Museum Day',
    description: 'A low-stress family outing with an easy meal and wind-down stop.',
    defaults: {
      intent: 'A family-friendly afternoon with built-in breaks.',
      city: 'San Jose',
      when: 'Saturday afternoon',
    },
    stops: [
      {
        id: 'family-museum-entry',
        label: 'Children’s discovery museum',
        role: 'anchor',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJHyD5sa_Mj4ARURwnBwmTwTU',
          label: "Children's Discovery Museum of San Jose",
        },
      },
      {
        id: 'family-snack',
        label: 'Family-friendly cafe (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'family-wind-down',
        label: 'Family-friendly park (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
  {
    id: 'garden-tea',
    version: 1,
    kind: 'experience',
    origin: 'curated',
    title: 'Garden + Tea Reset',
    description: 'Slow down with a garden stroll, tea, and a light bite.',
    defaults: {
      intent: 'A gentle reset with greenery and tea.',
      city: 'San Jose',
      when: 'Sunday morning',
    },
    stops: [
      {
        id: 'garden-stroll',
        label: 'Municipal Rose Garden',
        role: 'anchor',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJb5KWbRTLj4AR1iYBl5vpNf8',
          label: 'San Jose Municipal Rose Garden',
        },
      },
      {
        id: 'garden-tea',
        label: 'Tea service (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'garden-reading',
        label: 'Quiet cafe (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
  {
    id: 'urban-adventure',
    version: 1,
    kind: 'experience',
    origin: 'curated',
    title: 'Urban Adventure Loop',
    description: 'One bold activity, then a chill reward stop to reset.',
    defaults: {
      intent: 'An energetic start with a relaxed finish.',
      city: 'San Jose',
      when: 'Weekend afternoon',
    },
    stops: [
      {
        id: 'urban-activity',
        label: 'Activity (pick one)',
        role: 'anchor',
        isPlaceholder: true,
      },
      {
        id: 'urban-photo',
        label: 'Photo spot (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'urban-reward',
        label: 'Coffee shop (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
  {
    id: 'date-night',
    version: 1,
    kind: 'pack',
    origin: 'template',
    title: 'Date Night',
    description: 'Dinner, a vibe, and a closer.',
    defaults: {
      intent: 'A simple date night flow.',
      city: 'San Jose',
      when: 'Friday evening',
    },
    stops: [
      {
        id: 'date-night-dinner',
        label: 'Dinner spot (pick one)',
        role: 'anchor',
        isPlaceholder: true,
      },
      {
        id: 'date-night-vibe',
        label: 'Cocktail bar (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'date-night-closer',
        label: 'Dessert (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
  {
    id: 'family-trip',
    version: 1,
    kind: 'pack',
    origin: 'template',
    title: 'Family Trip',
    description: 'Kid-friendly stops that keep the group moving.',
    defaults: {
      intent: 'An easy outing that works for everyone.',
      city: 'San Jose',
      when: 'Saturday afternoon',
    },
    stops: [
      {
        id: 'family-trip-main',
        label: 'Family activity (pick one)',
        role: 'anchor',
        isPlaceholder: true,
      },
      {
        id: 'family-trip-food',
        label: 'Family-friendly meal (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'family-trip-park',
        label: 'Park (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
  {
    id: 'venue-event',
    version: 1,
    kind: 'pack',
    origin: 'template',
    title: 'Venue Event',
    description: 'Pre/post stops around a venue.',
    brand: {
      name: 'Downtown Sunnyvale',
      accent: '#10b981',
      byline: 'Presented by Downtown Sunnyvale',
      ctaLabel: 'Explore downtown',
      ctaUrl: 'https://www.downtownsunnyvale.com',
    },
    defaults: {
      intent: 'A plan that wraps a venue event.',
      city: 'San Jose',
      when: 'Evening',
      startAt: '2026-03-01T19:30:00Z',
      endAt: '2026-03-01T22:30:00Z',
    },
    stops: [
      {
        id: 'venue-event-pre',
        label: 'Pre-event bite (pick one)',
        role: 'support',
        isPlaceholder: true,
      },
      {
        id: 'venue-event-main',
        label: 'Venue event',
        role: 'anchor',
        placeRef: {
          provider: 'google',
          placeId: 'ChIJ_QhGaqXMj4AR5GHCXNt35E0',
          label: 'San Jose Center for the Performing Arts',
        },
      },
      {
        id: 'venue-event-post',
        label: 'Post-event drink (pick one)',
        role: 'optional',
        isPlaceholder: true,
      },
    ],
  },
];

type SeedValidationResult = { ok: boolean; issues: string[] };

const warnedTemplateSeeds = new Set<string>();

function isRealPlaceStop(stop: Template['stops'][number]): boolean {
  return !stop.isPlaceholder;
}

export function validateTemplateSeed(template: Template): SeedValidationResult {
  const issues: string[] = [];
  const origin = template.origin ?? (template.kind === 'experience' ? 'curated' : 'template');
  const needsBakedPlaceId = origin === 'curated';

  for (const stop of template.stops) {
    if (!isRealPlaceStop(stop)) continue;
    const hasMapTarget = hasStopMapTarget({ placeRef: stop.placeRef ?? undefined });
    if (!hasMapTarget && needsBakedPlaceId) {
      issues.push(`Missing map target for curated stop: ${stop.label}`);
    }
    if (!hasMapTarget && origin === 'template' && stop.placeRef) {
      issues.push(`Missing map target for real template stop: ${stop.label}`);
    }
  }

  const result = { ok: issues.length === 0, issues };

  const shouldLogTemplateWarnings = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
  if (shouldLogTemplateWarnings && issues.length > 0) {
    const key = `${template.id}:${issues.join('|')}`;
    if (!warnedTemplateSeeds.has(key)) {
      console.warn(
        'Template misconfigured: real place stop requires baked map target.',
        { templateId: template.id, issues }
      );
      warnedTemplateSeeds.add(key);
    }
  }

  return result;
}

export function getTemplateSeedById(id: string): Template | undefined {
  const template = TEMPLATE_SEEDS.find((candidate) => candidate.id === id);
  if (template) {
    validateTemplateSeed(template);
  }
  return template;
}
