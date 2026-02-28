import type { Stop } from '@/app/plan-engine/types';

export type StopMapTarget =
  | { kind: 'placeId'; placeId: string }
  | { kind: 'latLng'; latLng: { lat: number; lng: number } }
  | { kind: 'mapsUrl'; mapsUrl: string };

type StopPlaceRef = NonNullable<Stop['placeRef']>;
type StopPlaceLite = NonNullable<Stop['placeLite']>;

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'function') {
    try {
      const result = value();
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isMapsUrl(value: string): boolean {
  return /^(https?:\/\/)(www\.)?google\.(com|[a-z.]+)\/maps/i.test(value);
}

function isPlaceIdLike(value: string): boolean {
  return /^ChI[\w-]{8,}$/.test(value);
}

export function getStopCanonicalPlaceId(stop: Stop | Record<string, unknown>): string | null {
  const record = stop as Record<string, unknown>;
  const placeRef = record.placeRef as Record<string, unknown> | undefined;
  const place = record.place as Record<string, unknown> | undefined;
  const candidate =
    readString(placeRef?.placeId) ??
    readString(record.placeId) ??
    readString(record.place_id) ??
    readString(record.googlePlaceId) ??
    readString(record.google_place_id) ??
    readString(place?.placeId) ??
    readString(place?.id) ??
    null;
  if (candidate) return candidate;
  const provider = readString(placeRef?.provider) ?? readString(record.provider);
  if (provider === 'google') {
    const id = readString(record.id);
    return id && isPlaceIdLike(id) ? id : null;
  }
  return null;
}

function normalizeLatLng(record: Record<string, unknown>): { lat: number; lng: number } | null {
  const fromLatLng = record.latLng as Record<string, unknown> | undefined;
  const fromCoordinates = record.coordinates as Record<string, unknown> | undefined;
  const lat =
    readNumber(record.lat) ??
    readNumber(record.latitude) ??
    readNumber(fromLatLng?.lat) ??
    readNumber(fromCoordinates?.lat) ??
    readNumber(
      (record.place as { geometry?: { location?: { lat?: unknown } } } | undefined)?.geometry
        ?.location?.lat
    );
  const lng =
    readNumber(record.lng) ??
    readNumber(record.longitude) ??
    readNumber(fromLatLng?.lng) ??
    readNumber(fromCoordinates?.lng) ??
    readNumber(
      (record.place as { geometry?: { location?: { lng?: unknown } } } | undefined)?.geometry
        ?.location?.lng
    );
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }
  return null;
}

function normalizePlaceRef(record: Record<string, unknown>): StopPlaceRef {
  const placeRef = (record.placeRef ?? {}) as Record<string, unknown>;
  const placeId = getStopCanonicalPlaceId(record);
  const latLng =
    (placeRef.latLng as { lat?: unknown; lng?: unknown } | undefined) && {
      lat: readNumber((placeRef.latLng as { lat?: unknown }).lat) ?? undefined,
      lng: readNumber((placeRef.latLng as { lng?: unknown }).lng) ?? undefined,
    };
  const normalizedLatLng =
    latLng && typeof latLng.lat === 'number' && typeof latLng.lng === 'number'
      ? { lat: latLng.lat, lng: latLng.lng }
      : normalizeLatLng(record);
  const mapsCandidate =
    readString(placeRef.mapsUrl) ??
    readString(record.mapsUrl) ??
    readString(record.googleMapsUrl) ??
    readString(record.url) ??
    null;
  const mapsUrl = mapsCandidate && isMapsUrl(mapsCandidate) ? mapsCandidate : null;
  const websiteCandidate =
    readString(placeRef.websiteUrl) ??
    readString(record.websiteUrl) ??
    readString(record.website) ??
    readString(record.url) ??
    null;
  const websiteUrl =
    websiteCandidate && /^https?:\/\//i.test(websiteCandidate) && !isMapsUrl(websiteCandidate)
      ? websiteCandidate
      : null;
  const placeLite = record.placeLite as Record<string, unknown> | undefined;
  const label =
    readString(placeRef.label) ??
    readString(placeRef.name) ??
    readString(record.label) ??
    readString(placeLite?.name) ??
    readString(record.name) ??
    null;
  const query = readString(placeRef.query) ?? readString(record.query) ?? null;
  const provider =
    placeRef.provider === 'google'
      ? 'google'
      : placeId
        ? 'google'
        : undefined;

  return {
    provider,
    placeId: placeId ?? undefined,
    latLng: normalizedLatLng ?? undefined,
    mapsUrl: mapsUrl ?? undefined,
    websiteUrl: websiteUrl ?? undefined,
    label: label ?? undefined,
    query: query ?? undefined,
  };
}

function normalizePlaceLite(record: Record<string, unknown>): StopPlaceLite | null {
  const placeLite = record.placeLite as Record<string, unknown> | undefined;
  const formattedAddress =
    readString(placeLite?.formattedAddress) ??
    readString(record.formattedAddress) ??
    readString(record.formatted_address) ??
    readString(record.address) ??
    readString(record.location) ??
    readString(record.vicinity) ??
    null;
  const name =
    readString(placeLite?.name) ?? readString(record.name) ?? readString(record.label) ?? null;
  const placeId =
    readString(placeLite?.placeId) ??
    readString(record.placeId) ??
    readString(record.place_id) ??
    readString(record.googlePlaceId) ??
    null;
  const website =
    readString(placeLite?.website) ??
    readString(record.website) ??
    readString(record.websiteUrl) ??
    null;
  const googleMapsUrl =
    readString(placeLite?.googleMapsUrl) ??
    (readString(record.googleMapsUrl) && isMapsUrl(String(record.googleMapsUrl))
      ? String(record.googleMapsUrl)
      : null) ??
    null;
  const rating =
    readNumber(placeLite?.rating) ?? readNumber(record.rating) ?? undefined;
  const userRatingsTotal =
    readNumber(placeLite?.userRatingsTotal) ??
    readNumber(record.userRatingsTotal) ??
    readNumber(record.user_ratings_total) ??
    undefined;
  const priceLevel =
    readNumber(placeLite?.priceLevel) ?? readNumber(record.priceLevel) ?? undefined;
  const photoUrl =
    typeof placeLite?.photoUrl === 'string' ? placeLite.photoUrl : null;
  const types = Array.isArray(placeLite?.types)
    ? (placeLite?.types as string[])
    : Array.isArray(record.types)
      ? (record.types as string[])
      : undefined;

  const hasAny =
    placeId ||
    formattedAddress ||
    name ||
    website ||
    googleMapsUrl ||
    rating !== undefined ||
    userRatingsTotal !== undefined ||
    priceLevel !== undefined ||
    photoUrl ||
    (types && types.length > 0);

  if (!hasAny) return null;

  return {
    placeId: placeId ?? undefined,
    name: name ?? undefined,
    formattedAddress: formattedAddress ?? undefined,
    rating,
    userRatingsTotal,
    priceLevel,
    googleMapsUrl: googleMapsUrl ?? undefined,
    website: website ?? undefined,
    photoUrl,
    types,
  };
}

export function getStopMapTarget(stop: { placeRef?: StopPlaceRef | null }): StopMapTarget | null {
  const placeRef = stop.placeRef ?? null;
  if (!placeRef) return null;
  if (placeRef.placeId) return { kind: 'placeId', placeId: placeRef.placeId };
  if (placeRef.latLng) return { kind: 'latLng', latLng: placeRef.latLng };
  if (placeRef.mapsUrl) return { kind: 'mapsUrl', mapsUrl: placeRef.mapsUrl };
  return null;
}

export function getStopMapHref(stop: { placeRef?: StopPlaceRef | null }): string | null {
  const target = getStopMapTarget(stop);
  if (!target) return null;
  if (target.kind === 'placeId') {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
      target.placeId
    )}`;
  }
  if (target.kind === 'latLng') {
    return `https://www.google.com/maps/search/?api=1&query=${target.latLng.lat},${target.latLng.lng}`;
  }
  return target.mapsUrl;
}

export function getStopWebsiteHref(stop: {
  placeRef?: StopPlaceRef | null;
  placeLite?: StopPlaceLite | null;
}): string | null {
  const candidate = stop.placeRef?.websiteUrl ?? stop.placeLite?.website ?? null;
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) return null;
  if (isMapsUrl(candidate)) return null;
  return candidate;
}

export function getStopAddress(stop: { placeLite?: StopPlaceLite | null }): string | null {
  const value = stop.placeLite?.formattedAddress ?? null;
  return value && value.trim() ? value.trim() : null;
}

export function hasStopMapTarget(stop: { placeRef?: StopPlaceRef | null }): boolean {
  return Boolean(getStopMapTarget(stop));
}

export function normalizeStop(stop: Stop | Record<string, unknown>): {
  stop: Stop;
  mapTarget: StopMapTarget | null;
} {
  const record = stop as Record<string, unknown>;
  const placeRef = normalizePlaceRef(record);
  const placeLite = normalizePlaceLite(record);
  const normalized: Stop = {
    ...(record as unknown as Stop),
    placeRef,
    ...(placeLite ? { placeLite } : {}),
  };
  const mapTarget = getStopMapTarget(normalized);
  return { stop: normalized, mapTarget };
}

export function normalizeStops(stops: Stop[]): Stop[] {
  return stops.map((stop) => normalizeStop(stop).stop);
}
