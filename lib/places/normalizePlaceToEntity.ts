import type { Entity } from '@/data/entities';

export type NormalizedPlaceEntity = Pick<
  Entity,
  'id' | 'name' | 'description' | 'location' | 'tags' | 'lat' | 'lng' | 'cost'
>;

export type PlacesTextSearchResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  types?: string[];
  price_level?: number;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

const COST_MAP: Record<number, Entity['cost']> = {
  0: 'Free',
  1: '$',
  2: '$$',
  3: '$$$',
  4: '$$$',
};

function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function normalizePlaceToEntity(
  place: PlacesTextSearchResult,
): NormalizedPlaceEntity | null {
  const name = place.name?.trim();
  if (!name) return null;

  const lat = place.geometry?.location?.lat;
  const lng = place.geometry?.location?.lng;
  const id =
    place.place_id?.trim() ??
    slugifyId(`${name}-${lat ?? 'na'}-${lng ?? 'na'}`);

  const location =
    place.formatted_address?.trim() || place.vicinity?.trim() || undefined;
  const description = location ?? name;

  const cost =
    typeof place.price_level === 'number' ? COST_MAP[place.price_level] : undefined;

  const tags =
    Array.isArray(place.types) && place.types.length > 0
      ? place.types.map((type) => type.replace(/_/g, ' '))
      : undefined;

  return {
    id,
    name,
    description,
    location,
    tags,
    lat,
    lng,
    cost,
  };
}
