<<<<<<< HEAD
import type { Entity } from "@/types/entity";

export const ENTITIES: Entity[] = [
  {
    id: "sunset-hike",
    title: "Sunset hike in the foothills",
    category: "Outdoors",
    location: "South San Jose",
    timeLabel: "This Saturday · 5:30–8:00 pm",
    cost: "$",
    tags: ["hike", "sunset", "nature", "low-key"],
  },
  {
    id: "board-game-meetup",
    title: "Neighborhood board game meetup",
    category: "Social",
    location: "Downtown San Jose",
    timeLabel: "Friday · 7:00–10:00 pm",
    cost: "Free (bring snacks)",
    tags: ["indoor", "board games", "social", "low cost"],
  },
  {
    id: "live-music-bar",
    title: "Live music at Local Bar & Grill",
    category: "Music",
    location: "Willow Glen",
    timeLabel: "Tonight · 8:00–11:00 pm",
    cost: "$$",
    tags: ["live music", "drinks", "night out"],
  },
  {
    id: "coffee-and-read",
    title: "Slow morning at Third Wave Coffee",
    category: "Cafe",
    location: "Japantown",
    timeLabel: "Sunday · 10:00 am–12:00 pm",
    cost: "$",
    tags: ["coffee", "reading", "chill", "solo-friendly"],
  },
  {
    id: "movie-night",
    title: "Indie movie night at Retro Cinema",
    category: "Movies",
    location: "Downtown San Jose",
    timeLabel: "Thursday · 7:30–10:00 pm",
    cost: "$$",
    tags: ["indie film", "cinema", "night out"],
  },
  {
    id: "food-truck-rally",
    title: "Food truck rally and night market",
    category: "Food & Drink",
    location: "San Pedro Square",
    timeLabel: "This weekend · 6:00–10:00 pm",
    cost: "$$",
    tags: ["street food", "night market", "crowds"],
=======
// data/entities.ts

export type Mood = 'chill' | 'focused' | 'adventurous' | 'reflective' | 'playful';

export type CostTag = 'free' | 'affordable' | 'splurge';

export type ProximityTag = 'nearby' | 'short-drive' | 'worth-it';

export type UseCaseTag =
  | 'casual-date'
  | 'special-occasion'
  | 'friends-night'
  | 'family-outing'
  | 'solo-reset';

export type Entity = {
  id: string;
  name: string;
  description: string;

  mood: Mood;

  // Optional metadata used by UI (chips, “matched for”, etc.)
  location?: string;
  timeLabel?: string;

  cost?: CostTag;
  proximity?: ProximityTag;
  useCases?: UseCaseTag[];

  // Lightweight search helpers / copy (optional)
  tags?: string[];

  // Optional coordinates (future-proofing for real map + places)
  lat?: number;
  lng?: number;
};

/**
 * Canonical list used by the app.
 * Keep this as ENTITIES, and export `entities` as a back-compat alias.
 */
export const ENTITIES: Entity[] = [
  {
    id: 'sj-boardgames-night',
    name: 'Board Games Café Night',
    description: 'Low-key, social, and easy. Grab a table and let the games do the talking.',
    mood: 'playful',
    location: 'Downtown San Jose',
    timeLabel: 'Fri · 7:00–10:00 PM',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['friends-night', 'casual-date'],
    tags: ['board games', 'coffee', 'casual', 'social', 'downtown'],
  },
  {
    id: 'sj-romantic-dinner',
    name: 'Romantic Dinner + Walk',
    description: 'Dinner somewhere warm and cozy, then a short stroll to land the night gently.',
    mood: 'reflective',
    location: 'Willow Glen',
    timeLabel: 'Sat · 6:30–9:30 PM',
    cost: 'splurge',
    proximity: 'short-drive',
    useCases: ['special-occasion', 'casual-date'],
    tags: ['romantic', 'dinner', 'walk', 'date night', 'cozy'],
  },
  {
    id: 'sj-night-market',
    name: 'Night Market Adventure',
    description: 'Food, lights, people-watching, and a little chaos in the best way.',
    mood: 'adventurous',
    location: 'San Jose',
    timeLabel: 'Sat · 7:00–10:30 PM',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['friends-night', 'casual-date'],
    tags: ['night market', 'street food', 'adventure', 'snacks', 'music'],
  },
  {
    id: 'sj-solo-reset',
    name: 'Solo Reset: Coffee + Bookstore',
    description: 'A calm pocket of time: good coffee, a quiet aisle, and your brain exhaling.',
    mood: 'focused',
    location: 'San Jose',
    timeLabel: 'Sun · 10:00 AM–12:00 PM',
    cost: 'affordable',
    proximity: 'nearby',
    useCases: ['solo-reset'],
    tags: ['coffee', 'bookstore', 'quiet', 'reset', 'solo'],
  },
  {
    id: 'sj-family-park',
    name: 'Family Park + Treat',
    description: 'Easy win: fresh air, room to move, then something sweet on the way home.',
    mood: 'chill',
    location: 'San Jose',
    timeLabel: 'Sat · 2:00–5:00 PM',
    cost: 'free',
    proximity: 'nearby',
    useCases: ['family-outing'],
    tags: ['park', 'family', 'outdoors', 'walk', 'treat'],
>>>>>>> db20182 (fix: wrap search params routes in Suspense for prod build)
  },
];

/**
 * Back-compat export: some files (like app/api/entities/route.ts) import { entities }.
 * Keep this alias so both `ENTITIES` and `entities` work.
 */
export const entities = ENTITIES;

export default ENTITIES;
