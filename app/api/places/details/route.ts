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
  photoUrl?: string | null;
  editorialSummary?: string;
  openingHours?: {
    openNow?: boolean;
    weekdayText?: string[];
  };
  types?: string[];
};

type PlaceDetailsResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  url?: string;
  website?: string;
  vicinity?: string;
  types?: string[];
  editorial_summary?: {
    overview?: string;
  };
  opening_hours?: {
    open_now?: boolean;
    weekday_text?: string[];
  };
  photos?: Array<{
    photo_reference?: string;
  }>;
};

type PlaceDetailsResponse = {
  status?: string;
  result?: PlaceDetailsResult;
  error_message?: string;
};

const DETAILS_CACHE = new Map<string, PlaceLite>();
const DETAILS_CACHE_LIMIT = 200;

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function normalizePlaceLite(placeId: string, result: PlaceDetailsResult): PlaceLite | null {
  if (!placeId) return null;
  const name = result.name?.trim() || undefined;
  const formattedAddress =
    result.formatted_address?.trim() || result.vicinity?.trim() || undefined;
  return {
    placeId,
    name,
    formattedAddress,
    rating: typeof result.rating === 'number' ? result.rating : undefined,
    userRatingsTotal:
      typeof result.user_ratings_total === 'number' ? result.user_ratings_total : undefined,
    priceLevel:
      typeof result.price_level === 'number' ? result.price_level : undefined,
    googleMapsUrl: result.url?.trim() || undefined,
    website: result.website?.trim() || undefined,
  };
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return isDev()
      ? NextResponse.json({ ok: false, error: 'missing_api_key' }, { status: 500 })
      : NextResponse.json({}, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get('placeId')?.trim() ?? '';
  if (!placeId) {
    return NextResponse.json({ ok: false, error: 'missing_placeId' }, { status: 400 });
  }

  const cached = DETAILS_CACHE.get(placeId);
  if (cached) {
    return NextResponse.json({ ok: true, place: cached });
  }

  const params = new URLSearchParams({
    place_id: placeId,
    key: apiKey,
    fields:
      'place_id,name,formatted_address,vicinity,rating,user_ratings_total,price_level,url,website,types,editorial_summary,opening_hours,photos',
  });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.text();
      if (isDev()) {
        console.warn('[places/details] upstream http error', {
          placeId,
          status: res.status,
          body,
        });
        return NextResponse.json(
          { ok: false, error: 'upstream_error', upstreamStatus: res.status, body },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    }

    const data = (await res.json()) as PlaceDetailsResponse;
    if (data.status && data.status !== 'OK') {
      if (isDev()) {
        console.warn('[places/details] upstream status error', {
          placeId,
          status: data.status,
          message: data.error_message,
        });
        return NextResponse.json(
          {
            ok: false,
            error: 'upstream_error',
            upstreamStatus: data.status,
            upstreamMessage: data.error_message ?? null,
          },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    }

    const result = data.result;
    if (!result) {
      return isDev()
        ? NextResponse.json({ ok: false, error: 'missing_result' }, { status: 502 })
        : NextResponse.json({ ok: true, place: null });
    }

    const place = normalizePlaceLite(placeId, result);
    if (place) {
      const photoRef = result.photos?.[0]?.photo_reference?.trim();
      if (photoRef) {
        place.photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${encodeURIComponent(
          photoRef
        )}&key=${encodeURIComponent(apiKey)}`;
      } else {
        place.photoUrl = null;
      }
      const summary = result.editorial_summary?.overview?.trim();
      if (summary) place.editorialSummary = summary;
      if (result.opening_hours) {
        place.openingHours = {
          openNow: result.opening_hours.open_now,
          weekdayText: result.opening_hours.weekday_text,
        };
      }
      if (Array.isArray(result.types) && result.types.length > 0) {
        place.types = result.types;
      }
    }
    if (place) {
      DETAILS_CACHE.set(placeId, place);
      if (DETAILS_CACHE.size > DETAILS_CACHE_LIMIT) {
        DETAILS_CACHE.clear();
      }
    }

    return NextResponse.json({ ok: true, place });
  } catch (error) {
    if (isDev()) {
      console.warn('[places/details] exception', { placeId, error });
      return NextResponse.json(
        { ok: false, error: 'exception', upstreamStatus: null },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
  }
}
