import { NextResponse } from 'next/server';

type PlaceLite = {
  placeId: string;
  name?: string;
  formattedAddress?: string;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  googleMapsUrl?: string;
  website?: string;
};

type PlacesTextSearchResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
};

type PlacesTextSearchResponse = {
  status?: string;
  results?: PlacesTextSearchResult[];
  error_message?: string;
};

const RESOLVE_CACHE = new Map<string, PlaceLite | null>();
const RESOLVE_CACHE_LIMIT = 200;

function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function resolvePlace(input: { q: string; near?: string; city?: string }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'missing_key' }, { status: 500 });
  }

  const q = input.q.trim();
  const near = (input.near ?? '').trim();
  const city = (input.city ?? '').trim();
  if (q.length < 3) {
    return NextResponse.json({ ok: true, place: null });
  }

  const key = normalizeKey(`${q}|${near}|${city}`);
  if (RESOLVE_CACHE.has(key)) {
    return NextResponse.json({ ok: true, place: RESOLVE_CACHE.get(key) ?? null });
  }

  const query = [q, near || city].filter(Boolean).join(' ');
  const params = new URLSearchParams({ query, key: apiKey });
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    }

    const data = (await res.json()) as PlacesTextSearchResponse;
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    }

    const top = Array.isArray(data.results) ? data.results[0] : undefined;
    if (!top?.place_id) {
      RESOLVE_CACHE.set(key, null);
      if (RESOLVE_CACHE.size > RESOLVE_CACHE_LIMIT) RESOLVE_CACHE.clear();
      return NextResponse.json({ ok: true, place: null });
    }

    const place: PlaceLite = {
      placeId: top.place_id,
      name: top.name,
      formattedAddress: top.formatted_address || top.vicinity,
      rating: top.rating,
      userRatingsTotal: top.user_ratings_total,
      priceLevel: top.price_level,
      googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(
        top.place_id
      )}`,
    };

    RESOLVE_CACHE.set(key, place);
    if (RESOLVE_CACHE.size > RESOLVE_CACHE_LIMIT) RESOLVE_CACHE.clear();

    return NextResponse.json({ ok: true, place });
  } catch {
    return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const near = searchParams.get('near')?.trim() ?? '';
  const city = searchParams.get('city')?.trim() ?? '';
  return resolvePlace({ q, near, city });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      q?: string;
      near?: string;
      city?: string;
    };
    return resolvePlace({
      q: body.q?.trim() ?? '',
      near: body.near,
      city: body.city,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
}
