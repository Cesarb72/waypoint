import type { PlaceLite, PlaceRef } from '@/app/plan-engine/types';
import type { IdeaDateTravelMode } from './ideaDateConfig';
import { estimateTravelMinutes, haversineDistanceM } from './travelEstimate';

const IDEA_DATE_TRAVEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = {
  distanceM: number;
  minutes: number;
  expiresAt: number;
};

const edgeCache = new Map<string, CacheEntry>();

export type IdeaDateTravelNode = {
  id?: string;
  placeRef?: PlaceRef | null;
  placeLite?: PlaceLite | null;
};

export type IdeaDateTravelEdge = {
  key: string;
  fromKey: string;
  toKey: string;
  mode: IdeaDateTravelMode;
  distanceM: number;
  minutes: number;
  cached: boolean;
};

function getNodeId(node: IdeaDateTravelNode | null | undefined): string {
  if (!node) return 'unknown';
  const placeId = node.placeRef?.placeId ?? node.placeLite?.placeId;
  if (typeof placeId === 'string' && placeId.trim().length > 0) return placeId.trim();
  if (node.placeRef?.latLng) {
    const lat = node.placeRef.latLng.lat.toFixed(5);
    const lng = node.placeRef.latLng.lng.toFixed(5);
    return `latlng:${lat},${lng}`;
  }
  if (typeof node.id === 'string' && node.id.trim().length > 0) return node.id.trim();
  return 'unknown';
}

function estimateDistanceFallback(from: IdeaDateTravelNode, to: IdeaDateTravelNode): number {
  const fromPlaceId = from.placeRef?.placeId ?? from.placeLite?.placeId;
  const toPlaceId = to.placeRef?.placeId ?? to.placeLite?.placeId;
  if (fromPlaceId && toPlaceId && fromPlaceId === toPlaceId) return 120;
  return 1800;
}

function estimateDistance(from: IdeaDateTravelNode, to: IdeaDateTravelNode): number {
  const fromLatLng = from.placeRef?.latLng ?? null;
  const toLatLng = to.placeRef?.latLng ?? null;
  if (fromLatLng && toLatLng) {
    return haversineDistanceM(fromLatLng, toLatLng);
  }
  return estimateDistanceFallback(from, to);
}

function makeEdgeKey(fromKey: string, toKey: string, mode: IdeaDateTravelMode): string {
  return `${fromKey}::${toKey}::${mode}`;
}

function cleanupExpiredEntries(now: number): void {
  for (const [key, entry] of edgeCache.entries()) {
    if (entry.expiresAt <= now) edgeCache.delete(key);
  }
}

export function clearIdeaDateTravelCache(): void {
  edgeCache.clear();
}

export function getEdge(
  fromPlace: IdeaDateTravelNode,
  toPlace: IdeaDateTravelNode,
  mode: IdeaDateTravelMode
): IdeaDateTravelEdge {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const fromKey = getNodeId(fromPlace);
  const toKey = getNodeId(toPlace);
  const key = makeEdgeKey(fromKey, toKey, mode);
  const cached = edgeCache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      key,
      fromKey,
      toKey,
      mode,
      distanceM: cached.distanceM,
      minutes: cached.minutes,
      cached: true,
    };
  }

  const distanceM = estimateDistance(fromPlace, toPlace);
  const minutes = estimateTravelMinutes(mode, distanceM);
  edgeCache.set(key, {
    distanceM,
    minutes,
    expiresAt: now + IDEA_DATE_TRAVEL_CACHE_TTL_MS,
  });

  return { key, fromKey, toKey, mode, distanceM, minutes, cached: false };
}
