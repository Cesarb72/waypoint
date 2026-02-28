type PlaceCategory = 'park' | 'museum' | 'cafe' | 'bar' | 'restaurant' | 'generic';

type PlaceFallbackInput = {
  types?: string[] | null;
  label?: string | null;
  category?: string | null;
};

const CATEGORY_STYLES: Record<
  PlaceCategory,
  { bg: string; fg: string; text: string }
> = {
  park: { bg: '#0f3d2e', fg: '#b7f7d5', text: 'P' },
  museum: { bg: '#2b2f5b', fg: '#c7ccff', text: 'M' },
  cafe: { bg: '#3b2b1a', fg: '#f7d9b3', text: 'C' },
  bar: { bg: '#3b1737', fg: '#f6b9e9', text: 'B' },
  restaurant: { bg: '#3a1d1a', fg: '#ffcbb3', text: 'R' },
  generic: { bg: '#1f2430', fg: '#cbd5f1', text: 'G' },
};

function normalize(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasAny(list: string[], needles: string[]): boolean {
  return needles.some((needle) => list.includes(needle));
}

function pickCategory(input: PlaceFallbackInput): PlaceCategory {
  const types = (input.types ?? []).map((value) => normalize(value));
  const label = normalize(input.label);
  const category = normalize(input.category);
  const tokens = [label, category].filter(Boolean).join(' ');

  if (hasAny(types, ['park', 'campground', 'rv park', 'tourist attraction']) || tokens.includes('park')) {
    return 'park';
  }
  if (hasAny(types, ['museum', 'art gallery', 'art_gallery', 'tourist attraction']) || tokens.includes('museum')) {
    return 'museum';
  }
  if (
    hasAny(types, ['cafe', 'bakery', 'coffee shop', 'coffee_shop', 'tea house', 'tea_house']) ||
    tokens.includes('cafe') ||
    tokens.includes('coffee') ||
    tokens.includes('tea')
  ) {
    return 'cafe';
  }
  if (hasAny(types, ['bar', 'night club', 'night_club']) || tokens.includes('bar')) {
    return 'bar';
  }
  if (hasAny(types, ['restaurant', 'meal takeaway', 'meal_takeaway', 'meal delivery', 'meal_delivery'])) {
    return 'restaurant';
  }

  return 'generic';
}

function buildSvgDataUri(bg: string, fg: string, text: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" rx="12" ry="12" fill="${bg}"/>` +
    `<circle cx="48" cy="40" r="18" fill="${fg}" opacity="0.18"/>` +
    `<text x="48" y="62" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" fill="${fg}">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getPlaceFallbackImage(input: PlaceFallbackInput): string {
  const category = pickCategory(input);
  const style = CATEGORY_STYLES[category];
  return buildSvgDataUri(style.bg, style.fg, style.text);
}
