// lib/searchEntities.ts

import type { Entity, Mood } from '@/data/entities';

export type SearchParams = {
  query?: string;
  mood?: Mood | 'all';
};

export function searchEntities(
  items: Entity[],
  { query = '', mood = 'all' }: SearchParams
): Entity[] {
  const trimmedQuery = query.trim().toLowerCase();

  return items.filter((item) => {
    const matchesMood = mood === 'all' || item.mood === mood;

    const matchesQuery =
      trimmedQuery.length === 0
        ? true
        : item.name.toLowerCase().includes(trimmedQuery) ||
          item.description.toLowerCase().includes(trimmedQuery);

    return matchesMood && matchesQuery;
  });
}
