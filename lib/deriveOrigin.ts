export type DerivedOrigin = {
  originType: 'District' | 'City' | 'Template' | 'Search';
  primaryLabel: string;
  secondaryLabel?: string;
  originHref?: string;
};

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === 'object';
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getPathValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function getStringAtPath(value: unknown, path: string[]): string | null {
  return readString(getPathValue(value, path));
}

function pickString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const found = getStringAtPath(value, path);
    if (found) return found;
  }
  return null;
}

const CITY_ROUTE_EXISTS = true;
const DISTRICT_ROUTE_EXISTS = false;
const TEMPLATE_ROUTE_EXISTS = false;
const SEARCH_ROUTE_EXISTS = false;

export function deriveOrigin(savedItem: unknown): DerivedOrigin | null {
  const districtSlug = pickString(savedItem, [
    ['districtSlug'],
    ['district', 'slug'],
    ['context', 'district', 'slug'],
  ]);
  const districtName = pickString(savedItem, [
    ['districtName'],
    ['district', 'name'],
    ['context', 'district', 'name'],
  ]);
  const citySlug = pickString(savedItem, [
    ['citySlug'],
    ['city', 'slug'],
    ['context', 'district', 'citySlug'],
    ['context', 'city', 'slug'],
  ]);
  const cityName = pickString(savedItem, [
    ['cityName'],
    ['city', 'name'],
    ['context', 'district', 'cityName'],
    ['context', 'city', 'name'],
  ]);

  if (districtSlug && citySlug) {
    const primaryLabel = cityName ?? citySlug;
    const secondaryLabel = districtName ?? districtSlug;
    const originHref = DISTRICT_ROUTE_EXISTS
      ? `/city/${citySlug}/district/${districtSlug}`
      : undefined;
    return { originType: 'District', primaryLabel, secondaryLabel, originHref };
  }

  if (citySlug) {
    const primaryLabel = cityName ?? citySlug;
    const originHref = CITY_ROUTE_EXISTS ? `/city/${citySlug}` : undefined;
    return { originType: 'City', primaryLabel, originHref };
  }

  const templateName = pickString(savedItem, [
    ['templateName'],
    ['template', 'name'],
    ['template', 'title'],
    ['templateTitle'],
  ]);
  const templateId = pickString(savedItem, [['templateId'], ['template', 'id']]);
  if (templateName || templateId) {
    const primaryLabel = templateName ?? templateId ?? 'Template';
    const originHref = TEMPLATE_ROUTE_EXISTS ? `/templates/${primaryLabel}` : undefined;
    return { originType: 'Template', primaryLabel, originHref };
  }

  const searchQuery = pickString(savedItem, [['searchQuery'], ['query']]);
  if (searchQuery) {
    const originHref = SEARCH_ROUTE_EXISTS ? `/search?q=${encodeURIComponent(searchQuery)}` : undefined;
    return { originType: 'Search', primaryLabel: searchQuery, originHref };
  }

  return null;
}

let didLogDeriveOrigin = false;
if (process.env.NODE_ENV === 'development' && !didLogDeriveOrigin) {
  didLogDeriveOrigin = true;
  const mocks: unknown[] = [
    {
      districtSlug: 'downtown',
      districtName: 'Downtown',
      citySlug: 'san-jose',
      cityName: 'San Jose',
    },
    {
      citySlug: 'san-jose',
      cityName: 'San Jose',
    },
    {
      templateName: 'Dinner Template',
    },
    {
      query: 'cheap date night',
    },
  ];
  console.debug('[deriveOrigin] mock results', mocks.map(deriveOrigin));
}
