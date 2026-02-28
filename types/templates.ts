export type TemplateStop = {
  id: string;
  label: string;
  role: 'anchor' | 'support' | 'optional';
  placeRef?: {
    provider?: 'google';
    placeId?: string;
    latLng?: { lat: number; lng: number };
    mapsUrl?: string;
    websiteUrl?: string;
    label?: string;
    query?: string;
  };
  placeLite?: {
    placeId?: string;
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
  resolveQuery?: string;
  resolveNear?: string;
  isPlaceholder?: boolean;
};

export type TemplateOrigin = 'curated' | 'template';

export type Template = {
  id: string;
  version: number;
  kind: 'pack' | 'experience';
  origin?: TemplateOrigin;
  title: string;
  description: string;
  brand?: {
    name?: string;
    accent?: string;
    logoUrl?: string;
    byline?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
  defaults?: {
    intent?: string;
    city?: string;
    when?: string;
    startAt?: string | null;
    endAt?: string | null;
  };
  stops: TemplateStop[];
};
