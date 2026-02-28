import type { PlaceLite } from '@/app/plan-engine/types';
import { getStopCanonicalPlaceId } from '@/lib/stopLocation';

type StopLike = {
  placeRef?: {
    placeId?: string | null;
    mapsUrl?: string | null;
    websiteUrl?: string | null;
  } | null;
  placeLite?: PlaceLite | null;
};

type HydratableStop<T> = T & StopLike;
type HydrateOptions = {
  debug?: boolean;
  onRequest?: (placeIds: string[]) => void;
  forcePlaceIds?: string[];
  maxConcurrency?: number;
};

function hasCorePlaceLite(placeLite?: PlaceLite | null): boolean {
  if (!placeLite) return false;
  const hasAddress = Boolean(placeLite.formattedAddress);
  const hasRating = placeLite.rating !== undefined;
  const hasPhoto = Boolean(placeLite.photoUrl);
  return hasAddress && hasRating && hasPhoto;
}

async function fetchPlaceLite(
  placeId: string,
  opts?: { debug?: boolean; warnOnce?: Set<string> }
): Promise<PlaceLite | null> {
  try {
    const params = new URLSearchParams({ placeId });
    const res = await fetch(`/api/places/details?${params.toString()}`);
    if (!res.ok) {
      if (opts?.debug && opts.warnOnce && !opts.warnOnce.has(placeId)) {
        opts.warnOnce.add(placeId);
        let payload: unknown = null;
        try {
          payload = await res.json();
        } catch {
          try {
            payload = await res.text();
          } catch {
            payload = null;
          }
        }
        console.warn('[hydratePlaceLite] failed', {
          placeId,
          status: res.status,
          payload,
        });
      }
      return null;
    }
    const data = (await res.json()) as { place?: PlaceLite | null };
    return data?.place ?? null;
  } catch {
    if (opts?.debug && opts.warnOnce && !opts.warnOnce.has(placeId)) {
      opts.warnOnce.add(placeId);
      console.warn('[hydratePlaceLite] failed', { placeId, status: 'network' });
    }
    return null;
  }
}

function mergePlaceLite(
  existing: PlaceLite | null | undefined,
  fetched: PlaceLite,
  placeId: string
): PlaceLite {
  if (!existing) {
    return { ...fetched, placeId: fetched.placeId ?? placeId };
  }
  const merged: PlaceLite = { ...existing };
  (Object.entries(fetched) as [keyof PlaceLite, PlaceLite[keyof PlaceLite]][]).forEach(
    ([key, value]) => {
      const current = (merged as Record<string, unknown>)[key as string];
      if (current == null && value != null) {
        (merged as Record<string, unknown>)[key as string] = value as unknown;
      }
    }
  );
  if (!merged.placeId) {
    merged.placeId = fetched.placeId ?? placeId;
  }
  return merged;
}

export async function hydrateStopsPlaceLite<T extends StopLike>(
  stops: HydratableStop<T>[],
  options?: HydrateOptions
): Promise<HydratableStop<T>[]> {
  const placeIds = new Set<string>();
  const forced = options?.forcePlaceIds?.length ? options.forcePlaceIds : null;
  if (forced) {
    forced.forEach((value) => {
      const trimmed = value?.trim();
      if (trimmed) placeIds.add(trimmed);
    });
  } else {
    for (const stop of stops) {
      const placeId = getStopCanonicalPlaceId(stop);
      if (!placeId) continue;
      if (hasCorePlaceLite(stop.placeLite)) continue;
      placeIds.add(placeId);
    }
  }

  if (placeIds.size === 0) return stops;

  const placeIdsList = Array.from(placeIds);
  options?.onRequest?.(placeIdsList);
  const warnOnce = options?.debug ? new Set<string>() : undefined;
  if (options?.debug) {
    placeIdsList.forEach((placeId) => {
      console.info('[hydratePlaceLite] fetching details', placeId);
    });
  }
  const maxConcurrency = options?.maxConcurrency ?? 4;
  const fetchedEntries: Array<readonly [string, PlaceLite | null]> = [];
  for (let i = 0; i < placeIdsList.length; i += maxConcurrency) {
    const batch = placeIdsList.slice(i, i + maxConcurrency);
    const batchEntries = await Promise.all(
      batch.map(
        async (placeId) =>
          [placeId, await fetchPlaceLite(placeId, { debug: options?.debug, warnOnce })] as const
      )
    );
    fetchedEntries.push(...batchEntries);
  }
  const fetchedById = new Map<string, PlaceLite | null>(fetchedEntries);

  let changed = false;
  const nextStops = stops.map((stop) => {
    const placeId = getStopCanonicalPlaceId(stop);
    if (!placeId) return stop;
    const fetched = fetchedById.get(placeId);
    if (!fetched) return stop;
    const mergedPlaceLite = mergePlaceLite(stop.placeLite, fetched, placeId);
    const nextPlaceRef = stop.placeRef ?? { placeId };
    const fetchedMapsUrl =
      typeof fetched.googleMapsUrl === 'string' ? fetched.googleMapsUrl.trim() : '';
    const fetchedWebsiteUrl =
      typeof fetched.website === 'string' ? fetched.website.trim() : '';
    const nextMapsUrl = nextPlaceRef.mapsUrl ?? (fetchedMapsUrl ? fetchedMapsUrl : null);
    const nextWebsiteUrl =
      nextPlaceRef.websiteUrl ?? (fetchedWebsiteUrl ? fetchedWebsiteUrl : null);
    const mergedPlaceRef = {
      ...nextPlaceRef,
      placeId,
      ...(nextMapsUrl ? { mapsUrl: nextMapsUrl } : {}),
      ...(nextWebsiteUrl ? { websiteUrl: nextWebsiteUrl } : {}),
    };
    changed = true;
    return { ...stop, placeLite: mergedPlaceLite, placeRef: mergedPlaceRef };
  });

  return changed ? nextStops : stops;
}
