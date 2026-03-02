export type StopRole = 'anchor' | 'support' | 'optional';

export type Optionality = 'required' | 'flexible' | 'fallback';

export type ShareMode = 'link' | 'qr' | 'embed';
export type PlanState = 'DRAFT' | 'PUBLISHED';

export interface Constraints {
  timeWindow?: string;
  startAt?: string | null;
  endAt?: string | null;
  budgetRange?: string;
  mobility?: string;
  energyLevel?: string;
  accessibility?: string;
}

export interface Signals {
  vibe?: string;
  flexibility?: string;
  commitment?: string;
}

export interface PlanSignals {
  // Explicitly marked as the chosen saved plan; not a completion signal; reversible.
  chosen: boolean;
  // Timestamp when chosen was set; not inferred from activity; reversible.
  chosenAt: string | null;
  // Outcome acknowledgement: completed = "This happened", skipped = "This did not happen",
  // neither = "Outcome not acknowledged".
  // Explicitly marked as completed; not inferred from time; reversible.
  completed: boolean;
  // Timestamp when completed was set; not the event time; reversible.
  completedAt: string | null;
  // Explicitly marked as skipped; not inferred from time; reversible.
  skipped?: boolean;
  // Timestamp when skipped was set; not the event time; reversible.
  skippedAt?: string | null;
  // Count of explicit revisits; not passive analytics; manually adjustable.
  revisitedCount: number;
  // Explicit revisit timestamps; not background tracking; reversible.
  revisitedAt: string[];
  // Optional sentiment feedback; explicit, user-provided, non-evaluative; silence is valid.
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  // Optional timestamp when sentiment was set; not inferred; reversible.
  sentimentAt?: string;
  // Optional private notes; not shared or public; reversible.
  feedbackNotes: string | null;
}

export interface Context {
  occasion?: string;
  season?: string;
  localNote?: string;
  district?: {
    id: string;
    slug: string;
    name: string;
    cityId?: string;
    citySlug?: string;
    cityName?: string;
    label: string;
  };
}

export interface Branding {
  name?: string;
  logoUrl?: string;
  accentColor?: string;
}

export interface PlanBrand {
  name?: string;
  accent?: string;
  logoUrl?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export type PresentationAccent = 'slate' | 'blue' | 'emerald' | 'violet' | 'amber';

export interface Presentation {
  templateType?: string;
  branding?: Branding;
  shareModes?: ShareMode[];
  shareToken?: string;
  presentedBy?: string;
  logoUrl?: string;
  accent?: PresentationAccent;
}

export interface Metadata {
  createdBy?: string;
  createdFor?: string;
  createdAt?: string;
  lastUpdated?: string;
}

export type PlanSource = 'curated' | 'template' | 'search' | 'surprise' | 'unknown';

export type PlanOriginKind =
  | 'manual'
  | 'search'
  | 'mood'
  | 'surprise'
  | 'template'
  | 'curated'
  | 'generated'
  | 'unknown'
  | 'toolkit'
  | 'pack'
  | 'experience';

export interface PlanOrigin {
  kind: PlanOriginKind;
  query?: string;
  mood?: string;
  entityId?: string;
  label?: string;
  source?: PlanSource;
  templateId?: string;
  title?: string;
}

export type PlanPrefTiltValue = -1 | 0 | 1;

export interface PlanPrefTilt {
  vibe: PlanPrefTiltValue;
  walking: PlanPrefTiltValue;
  peak: PlanPrefTiltValue;
}

export interface PlanMeta {
  origin?: PlanOrigin;
  ideaDate?: unknown;
  prefTilt?: PlanPrefTilt;
  mode?: string;
}

export type TemplateMeta = {
  title: string;
  intent?: string;
  audience?: string;
  tags?: string[];
  packId?: string;
  packTitle?: string;
  packDescription?: string;
  packTags?: string[];
};

export type CreatedFrom =
  | {
      kind: 'template';
      templateId: string;
      templateTitle: string;
      packId?: string;
    }
  | {
      kind: 'experience';
      experienceId: string;
      experienceTitle: string;
      discoveryPresetId?: string;
      venueName?: string;
      locationHint?: string;
    };

export type PlanOwnerType = 'user' | 'org';

export type PlanOwner = {
  type: PlanOwnerType;
  id: string;
};

export type PlanEditPolicy = 'owner_only' | 'fork_required';

// The doc references Location and Duration but does not define their shapes; keep them flexible.
export type Location = string;
export type Duration = string;

export type PlaceProvider = 'google';

export type PlaceRef = {
  provider?: PlaceProvider;
  placeId?: string;
  latLng?: { lat: number; lng: number };
  mapsUrl?: string;
  websiteUrl?: string;
  label?: string;
  query?: string;
};

export type PlaceLite = {
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

export interface Stop {
  id: string;
  name: string;
  role: StopRole;
  optionality: Optionality;
  stop_type_id?: string;
  location?: string;
  duration?: Duration;
  notes?: string;
  placeRef?: PlaceRef;
  placeLite?: PlaceLite;
  resolve?: {
    q?: string;
    near?: string;
    placeholder?: boolean;
  };
  ideaDate?: unknown;
}

export interface PlanObject {
  id: string;
  version: string;
  title: string;
  intent: string;
  audience: string;
  stops: Stop[];
  constraints?: Constraints;
  signals?: Signals;
  planSignals?: PlanSignals;
  context?: Context;
  presentation?: Presentation;
  brand?: PlanBrand;
  metadata?: Metadata;
  meta?: PlanMeta;
  origin?: PlanOrigin;
  isTemplate?: boolean;
  templateMeta?: TemplateMeta;
  template_id?: string;
  createdFrom?: CreatedFrom;
  owner?: PlanOwner;
  editPolicy?: PlanEditPolicy;
  ownerId?: string;
  originStarterId?: string;
  state?: PlanState;
}

export type Plan = PlanObject;

export interface ValidationIssue {
  level: 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  isValid: boolean;
}

export type PlanValidationResult = ValidationResult;
