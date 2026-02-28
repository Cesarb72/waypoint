import { extractCity } from './extractCity';

function looksZipLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d{4,10}(?:-\d{4})?$/.test(trimmed)) return true;
  if (/^[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(trimmed)) return true;
  return false;
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function looksLikeCityOrState(candidate: string, formattedAddress: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return true;
  if (/^[A-Z]{2}$/i.test(trimmed)) return true;
  const derivedCity = extractCity(formattedAddress);
  if (!derivedCity) return false;
  return normalizeForCompare(derivedCity) === normalizeForCompare(trimmed);
}

function isValidNeighborhoodCandidate(candidate: string, formattedAddress: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed.length > 40) return false;
  if (/\d/.test(trimmed)) return false;
  if (looksLikeCityOrState(trimmed, formattedAddress)) return false;
  return true;
}

const DISTRICTISH_KEYWORDS =
  /\b(district|downtown|midtown|uptown|old town|soma)\b/i;

export function extractDistrict(formattedAddress: string | null | undefined): string | null {
  if (typeof formattedAddress !== 'string') return null;
  const trimmed = formattedAddress.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const normalizedParts = [...parts];
  const lastPart = normalizedParts[normalizedParts.length - 1] ?? '';
  if (looksZipLike(lastPart)) {
    normalizedParts.pop();
  }

  // Example: "1 Market St, SoMa, San Francisco, CA 94105" => "SoMa"
  // Example: "Unit 73, High St Mall, Portadown, Craigavon BT63 5WH, UK" => "High St Mall"
  // Example: "123 Main St, Downtown, San Jose, CA 95112" => "Downtown"
  if (normalizedParts.length >= 4) {
    const candidate = normalizedParts[1] ?? '';
    if (isValidNeighborhoodCandidate(candidate, trimmed)) {
      return candidate.trim();
    }
  }

  const firstPart = normalizedParts[0] ?? '';
  if (DISTRICTISH_KEYWORDS.test(firstPart)) {
    return firstPart.trim();
  }

  return null;
}
