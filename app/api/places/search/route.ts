import { NextResponse } from 'next/server';
import {
  normalizePlaceToEntity,
  type NormalizedPlaceEntity,
  type PlacesTextSearchResult,
} from '@/lib/places/normalizePlaceToEntity';

type PlacesTextSearchResponse = {
  status?: string;
  results?: PlacesTextSearchResult[];
  error_message?: string;
};

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'missing_key', results: [] });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  if (!q) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const lat = parseNumber(searchParams.get('lat'));
  const lng = parseNumber(searchParams.get('lng'));
  const radius = parseNumber(searchParams.get('radius'));

  const params = new URLSearchParams({ query: q, key: apiKey });
  if (lat !== undefined && lng !== undefined) {
    params.set('location', `${lat},${lng}`);
  }
  if (radius !== undefined) {
    params.set('radius', String(Math.round(radius)));
  }

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'upstream_error', results: [] });
    }

    const data = (await res.json()) as PlacesTextSearchResponse;
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return NextResponse.json({ ok: false, error: 'upstream_error', results: [] });
    }

    const rawResults = Array.isArray(data.results) ? data.results : [];
    const results = rawResults
      .map(normalizePlaceToEntity)
      .filter((item): item is NormalizedPlaceEntity => Boolean(item));

    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, error: 'upstream_error', results: [] });
  }
}
