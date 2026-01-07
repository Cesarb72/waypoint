// lib/searchEntities.ts

import type {
  Entity,
  Mood,
  CostTag,
  ProximityTag,
  UseCaseTag,
} from '@/data/entities';

export type SearchOptions = {
  query?: string;
  mood?: Mood | 'all';
};

/**
 * Small helpers
 */
function norm(text: string | undefined | null): string {
  return (text ?? '').toLowerCase();
}

function contains(haystack: string, needle: string): boolean {
  return haystack.includes(needle.toLowerCase());
}

function countKeywordHits(haystack: string, keywords: string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Keyword → tag dictionaries
 * These make queries like "romantic dinner night" / "cheap adventure"
 * map into your structured tags.
 */

const COST_KEYWORDS: Record<CostTag, string[]> = {
  Free: ['free', 'no money', 'no-cost', 'no cost'],
  '$': ['cheap', 'affordable', 'budget', 'low cost', 'inexpensive'],
  '$$': ['mid', 'moderate', 'dinner out', 'date night', 'midrange'],
  '$$$': ['fancy', 'splurge', 'upscale', 'expensive', 'bougie', 'nice dinner'],
};

const PROXIMITY_KEYWORDS: Record<ProximityTag, string[]> = {
  nearby: ['near me', 'nearby', 'close', 'walkable', 'walking distance'],
  'short-drive': ['short drive', 'quick drive', '10 min drive', '15 min drive'],
  'worth-it': [
    'day trip',
    'road trip',
    'worth-it',
    'far',
    'drive out',
  ],
};

const USE_CASE_KEYWORDS: Record<UseCaseTag, string[]> = {
  'casual-date': [
    'date',
    'date night',
    'romantic',
    'dinner date',
    'low key date',
    'first date',
  ],
  'special-occasion': [
    'special occasion',
    'anniversary',
    'birthday',
    'celebration',
    'big night',
  ],
  'friends-night': [
    'friends',
    'friend night',
    'night out',
    'bar crawl',
    'game night',
    'crew',
  ],
  'family-outing': [
    'family',
    'kids',
    'children',
    'with the kids',
    'family day',
  ],
  'solo-reset': ['solo', 'alone', 'reset', 'me time', 'unplug', 'recharge'],
};

const MOOD_KEYWORDS: Record<Mood, string[]> = {
  chill: ['chill', 'relaxed', 'cozy', 'low key', 'laid back', 'quiet'],
  focused: ['focused', 'study', 'work', 'cowork', 'deep work', 'productive'],
  adventurous: [
    'adventure',
    'adventurous',
    'hike',
    'trail',
    'outdoors',
    'explore',
    'escape room',
    'arcade',
  ],
  reflective: ['reflective', 'introspective', 'journal', 'deep talk', 'quiet talk'],
  playful: ['playful', 'fun', 'games', 'mini golf', 'bowling', 'arcade', 'goofy'],
};

/**
 * From a raw query, infer mood / tags.
 */
function inferIntentFromQuery(query: string | undefined) {
  const q = norm(query);
  const inferred: {
    mood?: Mood;
    cost?: CostTag;
    proximity?: ProximityTag;
    useCases: UseCaseTag[];
  } = {
    mood: undefined,
    cost: undefined,
    proximity: undefined,
    useCases: [],
  };

  if (!q) return inferred;

  // Mood
  (Object.keys(MOOD_KEYWORDS) as Mood[]).forEach((mood) => {
    if (inferred.mood) return;
    if (MOOD_KEYWORDS[mood].some((kw) => contains(q, kw))) {
      inferred.mood = mood;
    }
  });

  // Cost
  (Object.keys(COST_KEYWORDS) as CostTag[]).forEach((cost) => {
    if (inferred.cost) return;
    if (COST_KEYWORDS[cost].some((kw) => contains(q, kw))) {
      inferred.cost = cost;
    }
  });

  // Proximity
  (Object.keys(PROXIMITY_KEYWORDS) as ProximityTag[]).forEach((prox) => {
    if (inferred.proximity) return;
    if (PROXIMITY_KEYWORDS[prox].some((kw) => contains(q, kw))) {
      inferred.proximity = prox;
    }
  });

  // Use cases (can be multiple)
  (Object.keys(USE_CASE_KEYWORDS) as UseCaseTag[]).forEach((tag) => {
    if (USE_CASE_KEYWORDS[tag].some((kw) => contains(q, kw))) {
      inferred.useCases.push(tag);
    }
  });

  return inferred;
}

/**
 * Main search / ranking function.
 *
 * - Uses text search across name/description/location/useCases/tags
 * - Uses inferred intent from keywords → tags
 * - Uses mood filter to boost ordering (not a hard filter)
 * - Has a soft fallback so "weird" queries still show *something*
 */
export function searchEntities(
  entities: Entity[],
  options: SearchOptions
): Entity[] {
  const query = options.query?.trim() ?? '';
  const moodFilter = options.mood ?? 'all';
  const inferred = inferIntentFromQuery(query);

  const qLower = norm(query);
  const queryWords = qLower
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  type Scored = { entity: Entity; score: number };

  const scored: Scored[] = [];

  for (const entity of entities) {
    let score = 0;

    const haystack = [
      entity.name,
      entity.description,
      entity.location,
      entity.useCases?.join(' '),
      entity.tags?.join(' '),
    ]
      .map((x) => norm(x))
      .join(' ');

    // 2. Base score when there's *any* query or mood filter,
    //    so we have something to sort by.
    if (qLower || moodFilter !== 'all') {
      score += 1;
    }

    // 3. Text match (name / description / location)
    if (qLower && haystack) {
      for (const word of queryWords) {
        if (word.length < 3) continue; // ignore super tiny words
        if (haystack.includes(word)) {
          score += 2;
        }
      }

      // Slight boost if the entity name itself appears in the query
      if (contains(qLower, norm(entity.name))) {
        score += 3;
      }
    }

    // 4. Tag alignment: inferred intent vs actual tags

    // Mood: inferred OR explicit filter (already applied by filtering)
    if (inferred.mood && entity.mood === inferred.mood) {
      score += 4;
    }

    if (inferred.mood && inferred.mood !== moodFilter) {
      const hits = countKeywordHits(haystack, MOOD_KEYWORDS[inferred.mood]);
      if (hits > 0) {
        score += 2 + hits;
      }
    }

    if (moodFilter !== 'all') {
      if (entity.mood === moodFilter) {
        score += 4;
      }
      const hits = countKeywordHits(haystack, MOOD_KEYWORDS[moodFilter]);
      if (hits > 0) {
        score += 2 + hits;
      }
    }

    // Cost
    if (inferred.cost && entity.cost === inferred.cost) {
      score += 3;
    }

    // Proximity
    if (inferred.proximity && entity.proximity === inferred.proximity) {
      score += 2;
    }

    // Use cases
    if (inferred.useCases.length > 0 && entity.useCases) {
      const overlap = entity.useCases.filter((u) =>
        inferred.useCases.includes(u)
      ).length;
      if (overlap > 0) {
        score += 4 + overlap; // more overlap → slightly more score
      }
    }

    if (inferred.useCases.length > 0) {
      for (const useCase of inferred.useCases) {
        const hits = countKeywordHits(haystack, USE_CASE_KEYWORDS[useCase]);
        if (hits > 0) {
          score += 2 + hits;
        }
      }
    }

    // 5. Small bonus if entity mood matches explicit filter mood
    if (moodFilter !== 'all' && entity.mood === moodFilter) {
      score += 2;
    }

    scored.push({ entity, score });
  }

  // If no filtering at all, just return everything in a stable order
  if (!qLower && moodFilter === 'all') {
    return entities;
  }

  // First, see if we have any meaningfully matching entities
  const positive = scored.filter((s) => s.score > 0);

  if (positive.length > 0) {
    return positive
      .sort((a, b) => b.score - a.score)
      .map((s) => s.entity);
  }

  // Fallback: if *nothing* scored above 0,
  // return the entities that passed mood filter,
  // in a stable order. This prevents "0 results" for odd but
  // harmless queries like "adventure" before we’ve tagged everything.
  return scored.map((s) => s.entity);
}
