import type { IdeaDateRole, IdeaDateVibeId } from '@/lib/engine/idea-date/ideaDateConfig';
import { haversineDistanceM } from '@/lib/engine/idea-date/travelEstimate';
import type {
  IdeaDateSearchCandidate,
  SearchCandidates,
} from '@/lib/engine/idea-date/replacement';
import dataset from './data/replacementCandidates.json';

type CandidateDatasetRow = IdeaDateSearchCandidate & {
  roles: IdeaDateRole[];
  vibes: IdeaDateVibeId[];
};

const DATASET_ROWS = (dataset as CandidateDatasetRow[])
  .slice()
  .sort((a, b) => a.placeId.localeCompare(b.placeId));

const ROLE_TYPE_HINTS: Record<IdeaDateRole, string[]> = {
  start: ['cafe', 'coffee_shop', 'bakery', 'book_store', 'tea_house'],
  main: ['restaurant', 'art_gallery', 'museum'],
  windDown: ['dessert_shop', 'tea_house', 'bar', 'cocktail_bar'],
  flex: ['cafe', 'restaurant', 'art_gallery', 'dessert_shop'],
};

function hasTypeHint(candidate: CandidateDatasetRow, role: IdeaDateRole): boolean {
  const lowerTypes = new Set((candidate.types ?? []).map((item) => item.toLowerCase()));
  for (const hint of ROLE_TYPE_HINTS[role]) {
    if (lowerTypes.has(hint)) return true;
  }
  return false;
}

function readStopLatLng(stop: { placeRef?: { latLng?: { lat: number; lng: number } } }): { lat: number; lng: number } | null {
  const latLng = stop.placeRef?.latLng;
  if (!latLng) return null;
  if (!Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) return null;
  return latLng;
}

export const searchIdeaDateCandidates: SearchCandidates = ({
  role,
  stop,
  radiusMeters,
  vibeId,
  limit,
}) => {
  const stopLatLng = readStopLatLng(stop);
  if (!stopLatLng) return [];

  const radius = Math.max(1, Math.round(radiusMeters));
  const ranked = DATASET_ROWS
    .map((candidate) => {
      const distanceM = haversineDistanceM(stopLatLng, { lat: candidate.lat, lng: candidate.lng });
      const roleMatch = candidate.roles.includes(role);
      const vibeMatch = candidate.vibes.includes(vibeId);
      const typeHintMatch = hasTypeHint(candidate, role);
      const score =
        (roleMatch ? 2 : 0) +
        (vibeMatch ? 1 : 0) +
        (typeHintMatch ? 0.5 : 0) -
        distanceM / Math.max(radius, 1);
      return { candidate, distanceM, score, roleMatch };
    })
    .filter((item) => item.distanceM <= radius && item.roleMatch)
    .sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      const distanceDelta = a.distanceM - b.distanceM;
      if (distanceDelta !== 0) return distanceDelta;
      const nameDelta = a.candidate.name.localeCompare(b.candidate.name);
      if (nameDelta !== 0) return nameDelta;
      return a.candidate.placeId.localeCompare(b.candidate.placeId);
    });

  return ranked.slice(0, Math.max(1, limit)).map((item) => ({
    placeId: item.candidate.placeId,
    name: item.candidate.name,
    lat: item.candidate.lat,
    lng: item.candidate.lng,
    types: item.candidate.types ?? [],
    priceLevel: item.candidate.priceLevel,
    editorialSummary: item.candidate.editorialSummary,
  }));
};
