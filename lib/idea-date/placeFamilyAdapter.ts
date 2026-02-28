import type { Stop } from '@/app/plan-engine/types';
import type { IdeaDatePlaceCandidate } from '@/lib/engine/idea-date/replacement';
import type { FamilyKeyAdapter } from '@/lib/engine/idea-date/diversityRanking';

const TYPE_FAMILY_MAP: Array<{
  familyKey: string;
  types: readonly string[];
}> = [
  {
    familyKey: 'food',
    types: ['restaurant', 'cafe', 'bakery', 'meal_takeaway', 'meal_delivery'],
  },
  {
    familyKey: 'culture',
    types: ['museum', 'art_gallery'],
  },
  {
    familyKey: 'nightlife',
    types: ['bar', 'night_club'],
  },
  {
    familyKey: 'dessert',
    types: ['dessert_shop', 'ice_cream_shop', 'tea_house'],
  },
  {
    familyKey: 'outdoors',
    types: ['park', 'tourist_attraction'],
  },
];

function normalizeTypes(types: string[]): Set<string> {
  const normalized = types
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return new Set(normalized);
}

function classifyByName(name: string | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  if (/\b(museum|gallery)\b/.test(normalized)) return 'culture';
  if (/\b(bar|lounge|club)\b/.test(normalized)) return 'nightlife';
  if (/\b(dessert|gelato|ice cream|boba|tea)\b/.test(normalized)) return 'dessert';
  if (/\b(park|garden|trail)\b/.test(normalized)) return 'outdoors';
  if (/\b(cafe|coffee|restaurant|bistro|bakery)\b/.test(normalized)) return 'food';
  return null;
}

export function classifyIdeaDatePlaceFamily(types: string[], name?: string): string {
  const typeSet = normalizeTypes(types);
  if (typeSet.size === 0) return 'other';
  for (const entry of TYPE_FAMILY_MAP) {
    if (entry.types.some((type) => typeSet.has(type))) {
      return entry.familyKey;
    }
  }
  return classifyByName(name) ?? 'other';
}

function classifyStopFamilyKey(stop: Stop): string {
  return classifyIdeaDatePlaceFamily(stop.placeLite?.types ?? [], stop.name);
}

function classifyCandidateFamilyKey(candidate: IdeaDatePlaceCandidate): string {
  return classifyIdeaDatePlaceFamily(candidate.placeLite?.types ?? [], candidate.name);
}

export const ideaDatePlaceFamilyAdapter: FamilyKeyAdapter<IdeaDatePlaceCandidate> = {
  classifyStopFamilyKey,
  classifyCandidateFamilyKey,
};
