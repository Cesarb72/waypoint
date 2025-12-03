// app/api/entities/route.ts

import { NextResponse } from 'next/server';
import { entities, type Entity, type Mood } from '@/data/entities';

type GooglePlace = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  types?: string[];
};

/**
 * Map a Google Places result into our internal Entity shape.
 */
function mapPlaceToEntity(place: GooglePlace): Entity {
  const name = place.name ?? 'Unknown place';
  const description =
    place.formatted_address ?? place.vicinity ?? 'No description available';

  const types = place.types ?? [];

  // Very simple mood mapping based on place types
  let mood: Mood = 'adventurous';

  if (types.includes('library') || types.includes('university') || types.includes('school')) {
    mood = 'focused';
  } else if (types.includes('spa') || types.includes('cafe') || types.includes('restaurant')) {
    mood = 'chill';
  } else if (types.includes('park') || types.includes('tourist_attraction')) {
    mood = 'playful';
  } else if (types.includes('museum') || types.includes('art_gallery')) {
    mood = 'reflective';
  }

  return {
    id: place.place_id ?? name,
    name,
    description,
    mood,
  };
}

async function callGooglePlaces(
  apiKey: string,
  options: {
    query: string;
    lat?: number;
    lng?: number;
  }
): Promise<Entity[] | null> {
  const { query, lat, lng } = options;

  const url = new URL(
    'https://maps.googleapis.com/maps/api/place/textsearch/json'
  );

  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);

  // If we have coordinates, bias results around that location
  if (typeof lat === 'number' && typeof lng === 'number') {
    url.searchParams.set('location', `${lat},${lng}`);
    // radius in meters (e.g., 3000m ~ 3km)
    url.searchParams.set('radius', '3000');
  }

  const res = await fetch(url.toString());

  if (!res.ok) {
    console.error('Google Places API error:', res.status, res.statusText);
    return null;
  }

  const json = await res.json();

  if (!json.results || !Array.isArray(json.results)) {
    console.error('Unexpected Google Places response format.');
    return null;
  }

  const places: GooglePlace[] = json.results;

  if (!places.length) {
    return [];
  }

  const mapped = places.map(mapPlaceToEntity);

  return mapped.slice(0, 20);
}

/**
 * Try to fetch live data from Google Places with:
 *  1) query + location (if available)
 *  2) if no results, query-only (global)
 * If both fail, we return null so the caller can fall back to static entities.
 */
async function fetchFromGooglePlaces(options: {
  query?: string;
  lat?: number;
  lng?: number;
}): Promise<Entity[] | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.warn('GOOGLE_PLACES_API_KEY is not set. Falling back to static entities.');
    return null;
  }

  const { query, lat, lng } = options;

  const effectiveQuery =
    query && query.trim().length > 0 ? query.trim() : 'things to do near me';

  // Pass 1: query + location (if we have it)
  let results: Entity[] | null = await callGooglePlaces(apiKey, {
    query: effectiveQuery,
    lat,
    lng,
  });

  if (results && results.length > 0) {
    return results;
  }

  // Pass 2: global query-only search (no location bias)
  results = await callGooglePlaces(apiKey, {
    query: effectiveQuery,
  });

  if (results && results.length > 0) {
    return results;
  }

  // Signal to caller to fall back to static entities
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get('q') ?? undefined;
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');

  const lat = latParam ? Number(latParam) : undefined;
  const lng = lngParam ? Number(lngParam) : undefined;

  // Try live data first
  const liveEntities = await fetchFromGooglePlaces({ query: q, lat, lng });

  if (liveEntities && liveEntities.length > 0) {
    return NextResponse.json({ entities: liveEntities });
  }

  // Fallback: static seed data (ensures the app always works)
  await new Promise((resolve) => setTimeout(resolve, 150));
  return NextResponse.json({ entities });
}
