// data/entities.ts

// Core tag vocab shared across the app

export type Mood = 'chill' | 'focused' | 'adventurous' | 'reflective' | 'playful';

export type CostTag = 'free' | 'affordable' | 'splurge';

export type ProximityTag = 'nearby' | 'short-drive' | 'worth-the-trip';

export type UseCaseTag =
  | 'casual-date'
  | 'special-occasion'
  | 'friends-night'
  | 'family-outing'
  | 'solo-reset';

export type Entity = {
  id: string;
  name: string;
  description?: string;
  location?: string;
  mood: Mood;
  cost?: CostTag;
  proximity?: ProximityTag;
  useCases?: UseCaseTag[];
  /**
   * Free-form text tags / keywords that the search layer can match against.
   * e.g. ["cheap date", "patio", "cocktails", "san jose"]
   */
  tags?: string[];
};

// 🔹 Seed data: intentionally varied by mood, cost, proximity, and use case.
// These don’t have to be exact real businesses – they’re "real-world feeling" fixtures.

export const ENTITIES: Entity[] = [
  {
    id: 'cozy-wine-bar-san-pedro',
    name: 'Cozy Wine Bar on San Pedro',
    description:
      'Dim lights, small plates, and a quiet corner vibe — perfect for unwinding after a long week.',
    location: 'Downtown San Jose, CA',
    mood: 'chill',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['casual-date', 'friends-night'],
    tags: [
      'cheap date',
      'wine',
      'cozy',
      'downtown',
      'small plates',
      'san jose',
      'patio',
      'date night',
    ],
  },
  {
    id: 'santana-row-dinner-stroll',
    name: 'Santana Row Dinner & Stroll',
    description:
      'Grab dinner, people-watch, and end with a dessert walk under the string lights.',
    location: 'Santana Row, San Jose, CA',
    mood: 'playful',
    cost: 'splurge',
    proximity: 'short-drive',
    useCases: ['special-occasion', 'casual-date'],
    tags: ['birthday dinner', 'anniversary', 'outdoor dining', 'string lights', 'san jose'],
  },
  {
    id: 'los-gatos-creek-trail-walk',
    name: 'Los Gatos Creek Trail Walk',
    description:
      'Easy, flat trail with trees and water — good for walking, talking, and decompressing.',
    location: 'Los Gatos Creek Trail, San Jose, CA',
    mood: 'reflective',
    cost: 'free',
    proximity: 'short-drive',
    useCases: ['solo-reset', 'casual-date', 'family-outing'],
    tags: ['walk', 'nature', 'trail', 'sunset walk', 'cheap date', 'outdoors', 'bay area'],
  },
  {
    id: 'craft-beer-and-arcade',
    name: 'Craft Beer & Retro Arcade Night',
    description:
      'Pinball, old-school cabinets, and local taps. Loud, fun, and zero pressure to be fancy.',
    location: 'San Jose, CA',
    mood: 'playful',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['friends-night', 'casual-date'],
    tags: ['arcade', 'games', 'beer', 'friends', 'casual', 'night out', 'date night'],
  },
  {
    id: 'board-game-cafe',
    name: 'Board Game Café Hangout',
    description:
      'Shelves of games, snacks, and a table you can camp at for hours. Great for small groups.',
    location: 'Campbell, CA',
    mood: 'focused',
    cost: 'affordable',
    proximity: 'short-drive',
    useCases: ['friends-night', 'family-outing'],
    tags: ['board games', 'coffee', 'tea', 'indoor', 'rainy day', 'group activity'],
  },
  {
    id: 'downtown-karaoke-lounge',
    name: 'Downtown Karaoke Lounge',
    description:
      'Private rooms, guilty-pleasure playlists, and just enough neon to feel like a movie.',
    location: 'Downtown San Jose, CA',
    mood: 'playful',
    cost: 'splurge',
    proximity: 'nearby',
    useCases: ['friends-night', 'special-occasion'],
    tags: ['karaoke', 'birthday', 'group', 'nightlife', 'late night', 'sing'],
  },
  {
    id: 'museum-late-night',
    name: 'Museum Late Night & Drinks',
    description:
      'Art + ideas + a quiet bar after. Good for thoughtful dates or “let’s feel like adults again” nights.',
    location: 'San Jose, CA',
    mood: 'reflective',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['casual-date', 'special-occasion'],
    tags: ['museum', 'art', 'exhibit', 'culture', 'indoor', 'quiet', 'date night'],
  },
  {
    id: 'coffee-and-deep-work-loft',
    name: 'Coffee & Deep Work Loft',
    description:
      'Bright café with big tables, plenty of outlets, and “I live in Notion” energy.',
    location: 'San Jose, CA',
    mood: 'focused',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['solo-reset'],
    tags: ['coffee', 'laptop', 'remote work', 'study', 'focused', 'afternoon'],
  },
  {
    id: 'family-picnic-rose-garden',
    name: 'Family Picnic at the Rose Garden',
    description:
      'Grass, flowers, and enough space for kids to run while grown-ups actually breathe.',
    location: 'Municipal Rose Garden, San Jose, CA',
    mood: 'chill',
    cost: 'free',
    proximity: 'nearby',
    useCases: ['family-outing'],
    tags: ['picnic', 'kids', 'family', 'park', 'daytime', 'blanket', 'cheap'],
  },
  {
    id: 'mini-golf-and-ice-cream',
    name: 'Mini Golf & Ice Cream Combo',
    description:
      'Silly competition + a sugar bribe at the end. Low-stakes fun for dates or family.',
    location: 'Santa Clara, CA',
    mood: 'playful',
    cost: 'affordable',
    proximity: 'short-drive',
    useCases: ['casual-date', 'family-outing', 'friends-night'],
    tags: ['mini golf', 'ice cream', 'games', 'outdoors', 'date', 'kids'],
  },
  {
    id: 'sunset-overlook-drive',
    name: 'Sunset Overlook Drive',
    description:
      'Scenic drive up the hills, park, and watch the city lights switch on below.',
    location: 'East Foothills, San Jose, CA',
    mood: 'reflective',
    cost: 'free',
    proximity: 'worth-the-trip',
    useCases: ['casual-date', 'solo-reset'],
    tags: ['sunset', 'viewpoint', 'city lights', 'drive', 'romantic', 'quiet'],
  },
  {
    id: 'saturday-farmers-market',
    name: 'Saturday Morning Farmers Market',
    description:
      'Local produce, coffee in hand, bumping into at least three people you kind of know.',
    location: 'San Pedro Square, San Jose, CA',
    mood: 'chill',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['family-outing', 'casual-date', 'solo-reset'],
    tags: ['farmers market', 'local', 'morning', 'coffee', 'produce', 'walk'],
  },
];
