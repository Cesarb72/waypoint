'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  Entity,
  Mood,
  CostTag,
  ProximityTag,
  UseCaseTag,
} from '@/data/entities';
import { fetchEntities } from '@/lib/entitySource';
import { searchEntities } from '@/lib/searchEntities';
import {
  loadDiscoverySession,
  saveDiscoverySession,
  getDiscoveryRestoreFlag,
  clearDiscoveryRestoreFlag,
} from '@/lib/discoveryStorage';
import {
  loadSavedWaypoints,
  saveWaypointFromEntity,
  removeSavedWaypoint,
  type SavedWaypoint,
} from '@/lib/savedWaypoints';
import { deriveOrigin } from '@/lib/deriveOrigin';
import {
  createEmptyPlan,
  createPlanFromTemplate,
  createPlanFromTemplatePlan,
  deserializePlan,
  serializePlan,
  type Plan,
  type Stop,
  v6Starters,
} from './plan-engine';
import type { Template } from '@/types/templates';
import type { PlanStarter } from './plan-engine';
import {
  generateSurpriseStarterCandidate,
  type SurpriseGeneratorMode,
  type SurpriseStarterMeta,
} from './plan-engine/v7/discovery';
import {
  getRecentPlans,
  getSavedPlans,
  getTemplatePlans,
  loadSavedPlan,
  removePlanById,
  upsertRecentPlan,
  type PlanIndexItem,
  type TemplateIndexItem,
  isPlanShared,
} from './utils/planStorage';
import { ctaClass } from './ui/cta';
import AuthPanel from './auth/AuthPanel';
import { useSession } from './auth/SessionProvider';
import { getSupabaseBrowserClient } from './lib/supabaseBrowserClient';
import { fetchCloudPlan, listCloudPlans } from './lib/cloudPlans';
import { CLOUD_PLANS_TABLE } from './lib/cloudTables';
import { withPreservedModeParam } from './lib/entryMode';
import {
  WAYPOINT_TEMPLATES,
  type WaypointTemplate,
  DISCOVERY_PRESETS,
} from '@/lib/templates';
import {
  VENUE_EXPERIENCES_V2,
  type VenueExperienceV2,
} from '@/lib/venueExperiencesV2';
import { getTemplateSeedById, validateTemplateSeed } from '@/lib/templateSeeds';
import { getTemplateStopDisplayLabel } from '@/lib/templatePlan';

const MOOD_OPTIONS: (Mood | 'all')[] = [
  'all',
  'chill',
  'focused',
  'adventurous',
  'reflective',
  'playful',
];

type Coords = {
  lat: number;
  lng: number;
};

type DisplayWaypoint =
  | { source: 'entity'; entity: Entity }
  | { source: 'saved'; saved: SavedWaypoint };

const PENDING_STARTER_KEY = 'waypoint_pending_starter';
const DEMO_PLAN: Plan = {
  id: 'demo-plan',
  version: '2.0',
  title: 'Demo plan',
  intent: 'Test plan',
  audience: 'me',
  stops: [
    {
      id: 'stop-1',
      name: 'Anchor',
      role: 'anchor',
      optionality: 'required',
    },
  ],
};

type PlacePreview = {
  displayName: string;
  locationHint?: string;
  cost?: CostTag;
};

type PreviewQuery = {
  key: string;
  query: string;
  fallback: string;
};

const PLACE_PREVIEW_CACHE = new Map<string, PlacePreview | null>();
const PLACE_PREVIEW_INFLIGHT = new Map<string, Promise<PlacePreview | null>>();
const PLACE_PREVIEW_MAX_CONCURRENCY = 6;

let didLogSavedWaypoint = false;
const LAST_SEARCH_STORAGE_KEY = 'waypoint.lastSearch';
const ACTIVE_PLAN_STORAGE_KEY = 'waypoint.activePlanId';
const RECENT_PLANS_PULSE_KEY = 'waypoint.recentPlansPulse';
const RECENT_PLANS_PULSE_EVENT = 'waypoint:recentPlansPulse';

function mergePlanLists(
  base: PlanIndexItem[],
  supa: PlanIndexItem[]
): PlanIndexItem[] {
  const merged = new Map<string, PlanIndexItem>();

  const upsert = (item: PlanIndexItem) => {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      return;
    }
    const existingTime = new Date(existing.updatedAt).getTime();
    const incomingTime = new Date(item.updatedAt).getTime();
    const useIncoming = incomingTime > existingTime;
    merged.set(item.id, {
      ...(useIncoming ? item : existing),
      isSaved: Boolean(existing.isSaved || item.isSaved),
      isShared: existing.isShared || item.isShared,
      updatedAt: useIncoming ? item.updatedAt : existing.updatedAt,
    });
  };

  base.forEach(upsert);
  supa.forEach(upsert);

  return [...merged.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

// Helpers to pretty-print tags on the chips
function labelCost(cost: CostTag): string {
  if (cost === 'Free') return 'Free';
  if (cost === '$') return '$';
  if (cost === '$$') return '$$';
  if (cost === '$$$') return '$$$';
  return String(cost);
}

function labelProximity(p: ProximityTag): string {
  if (p === 'nearby') return 'Close by';
  if (p === 'short-drive') return 'Short drive';
  return 'Worth the trip';
}

function labelUseCase(u: UseCaseTag): string {
  switch (u) {
    case 'casual-date':
      return 'Casual date';
    case 'special-occasion':
      return 'Special occasion';
    case 'friends-night':
      return 'Friends night';
    case 'family-outing':
      return 'Family outing';
    case 'solo-reset':
      return 'Solo reset';
    default:
      return u;
  }
}

function extractImageUrl(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;

  const readString = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

  const direct = readString(obj.imageUrl) ?? readString(obj.photoUrl);
  if (direct) return direct;

  const image = obj.image;
  if (typeof image === 'string') {
    const candidate = readString(image);
    if (candidate) return candidate;
  } else if (image && typeof image === 'object') {
    const imageObj = image as Record<string, unknown>;
    const candidate = readString(imageObj.url) ?? readString(imageObj.src);
    if (candidate) return candidate;
  }

  const photos = Array.isArray(obj.photos) ? obj.photos : null;
  if (photos && photos.length > 0) {
    const first = photos[0];
    if (typeof first === 'string') {
      const candidate = readString(first);
      if (candidate) return candidate;
    } else if (first && typeof first === 'object') {
      const firstObj = first as Record<string, unknown>;
      const candidate = readString(firstObj.url) ?? readString(firstObj.src);
      if (candidate) return candidate;
    }
  }

  const media = Array.isArray(obj.media) ? obj.media : null;
  if (media && media.length > 0) {
    const first = media[0];
    if (first && typeof first === 'object') {
      const firstObj = first as Record<string, unknown>;
      const candidate = readString(firstObj.url) ?? readString(firstObj.src);
      if (candidate) return candidate;
    }
  }

  const savedWaypoint = obj.savedWaypoint;
  if (savedWaypoint && typeof savedWaypoint === 'object') {
    const savedObj = savedWaypoint as Record<string, unknown>;
    const candidate =
      readString(savedObj.imageUrl) ?? readString(savedObj.photoUrl);
    if (candidate) return candidate;
  }

  return null;
}

function extractWebsiteUrl(input: unknown): string | undefined {
  if (!input) return undefined;
  const obj = input as Record<string, unknown>;

  const readString = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

  const normalize = (value: string | null): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return undefined;
    if (trimmed.startsWith('/')) return undefined;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.includes(' ') || /\s/.test(trimmed)) return undefined;
    if (trimmed.includes('.')) {
      return `https://${trimmed}`;
    }
    return undefined;
  };

  const direct =
    readString(obj.websiteUrl) ??
    readString(obj.website) ??
    readString(obj.url) ??
    readString(obj.link);
  const normalizedDirect = normalize(direct);
  if (normalizedDirect) return normalizedDirect;

  const entity = obj.entity;
  if (entity && typeof entity === 'object') {
    const entityObj = entity as Record<string, unknown>;
    const entityValue =
      readString(entityObj.websiteUrl) ??
      readString(entityObj.website) ??
      readString(entityObj.url) ??
      readString(entityObj.link);
    const normalizedEntity = normalize(entityValue);
    if (normalizedEntity) return normalizedEntity;
  }

  const savedWaypoint = obj.savedWaypoint;
  if (savedWaypoint && typeof savedWaypoint === 'object') {
    const savedObj = savedWaypoint as Record<string, unknown>;
    const savedValue =
      readString(savedObj.websiteUrl) ??
      readString(savedObj.website) ??
      readString(savedObj.url);
    const normalizedSaved = normalize(savedValue);
    if (normalizedSaved) return normalizedSaved;
  }

  return undefined;
}

function buildPreviewKey(query: string, coords: Coords | null): string {
  const normalizedQuery = query.trim().toLowerCase();
  const locationKey = coords
    ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`
    : 'none';
  return `${normalizedQuery}|${locationKey}`;
}

function shortenLocationHint(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const first = trimmed.split(',')[0]?.trim();
  return first || trimmed;
}

async function fetchPlacePreview(
  query: string,
  coords: Coords | null
): Promise<PlacePreview | null> {
  const params = new URLSearchParams({ q: query });
  if (coords) {
    params.set('lat', String(coords.lat));
    params.set('lng', String(coords.lng));
    params.set('radius', '8000');
  }
  try {
    const res = await fetch(`/api/places/search?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; results?: Entity[] };
    if (!data?.ok || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    const top = data.results[0];
    if (!top?.name) return null;
    return {
      displayName: top.name,
      locationHint: shortenLocationHint(top.location),
      cost: top.cost,
    };
  } catch {
    return null;
  }
}

async function resolvePlacePreview(
  query: PreviewQuery,
  coords: Coords | null
): Promise<PlacePreview | null> {
  if (PLACE_PREVIEW_CACHE.has(query.key)) {
    return PLACE_PREVIEW_CACHE.get(query.key) ?? null;
  }
  const inflight = PLACE_PREVIEW_INFLIGHT.get(query.key);
  if (inflight) return inflight;
  const promise = fetchPlacePreview(query.query, coords)
    .then((result) => {
      PLACE_PREVIEW_CACHE.set(query.key, result ?? null);
      PLACE_PREVIEW_INFLIGHT.delete(query.key);
      return result ?? null;
    })
    .catch(() => {
      PLACE_PREVIEW_CACHE.set(query.key, null);
      PLACE_PREVIEW_INFLIGHT.delete(query.key);
      return null;
    });
  PLACE_PREVIEW_INFLIGHT.set(query.key, promise);
  return promise;
}

function buildSeededTemplatePreviewQueries(
  template: Template,
  coords: Coords | null
): PreviewQuery[] {
  const stops = template.stops.length > 0 ? template.stops : [];
  return stops.slice(0, 3).map((stop) => {
    const fallback = stop.label?.trim() || template.title;
    const query = stop.placeRef?.query?.trim() || fallback;
    return {
      key: buildPreviewKey(query, coords),
      query,
      fallback,
    };
  });
}

function buildExperiencePreviewQueries(
  experience: VenueExperienceV2,
  coords: Coords | null
): PreviewQuery[] {
  const stops =
    experience.seededStops && experience.seededStops.length > 0
      ? experience.seededStops
      : [experience.defaultQuery];
  const suffix = experience.locationHint ? ` ${experience.locationHint}` : '';
  return stops.slice(0, 3).map((stop) => {
    const fallback = stop?.trim() || experience.title;
    const query = `${fallback}${suffix}`.trim();
    return {
      key: buildPreviewKey(query, coords),
      query,
      fallback,
    };
  });
}

function buildPackPreviewQueries(
  template: WaypointTemplate,
  coords: Coords | null
): PreviewQuery[] {
  const hints =
    Array.isArray(template.intentQueryHints) && template.intentQueryHints.length > 0
      ? template.intentQueryHints
      : [template.name];
  return hints.slice(0, 3).map((hint) => {
    const fallback = hint?.trim() || template.name;
    const query = fallback;
    return {
      key: buildPreviewKey(query, coords),
      query,
      fallback,
    };
  });
}

function getPreviewDisplay(
  queries: PreviewQuery[]
): { label: string; title?: string }[] {
  const seen = new Set<string>();
  const items: { label: string; title?: string }[] = [];
  queries.forEach((query) => {
    const cached = PLACE_PREVIEW_CACHE.get(query.key);
    const label = cached?.displayName ?? query.fallback;
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const titleParts = [
      cached?.locationHint?.trim() || undefined,
      cached?.cost ? `Price: ${labelCost(cached.cost)}` : undefined,
    ].filter(Boolean) as string[];
    items.push({
      label,
      title: titleParts.length > 0 ? titleParts.join(' · ') : undefined,
    });
  });
  return items.slice(0, 3);
}

function buildResolvedStopNameMap(
  template: Template,
  coords: Coords | null
): Record<string, string> {
  const previewItems = getPreviewDisplay(
    buildSeededTemplatePreviewQueries(template, coords)
  );
  const resolved: Record<string, string> = {};
  template.stops.slice(0, previewItems.length).forEach((stop, index) => {
    const label = previewItems[index]?.label;
    if (label) {
      resolved[stop.id] = label;
    }
  });
  return resolved;
}

function looksLikeAddress(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const streetPattern =
    /\b\d{1,5}\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pkwy|parkway)\b/i;
  const cityStateZipPattern = /\b[A-Z][a-z]+,\s*[A-Z]{2}\s*\d{5}\b/;
  const hasZipLike = /\b\d{5}\b/.test(trimmed);
  const hasComma = trimmed.includes(',');
  const hasAddressTokens = /\b(suite|ste|unit|fl|floor|ca|usa)\b/i.test(trimmed);
  const hasDigits = /\d/.test(trimmed);
  return (
    streetPattern.test(trimmed) ||
    cityStateZipPattern.test(trimmed) ||
    (hasDigits && hasComma && (hasZipLike || hasAddressTokens)) ||
    (hasDigits && hasAddressTokens)
  );
}

function getResultBlurb(
  item: unknown
): { primary: string; secondary?: string; tags?: string[] } {
  const obj = (item ?? {}) as Record<string, unknown>;
  const rawDescription =
    typeof obj.description === 'string' ? obj.description : undefined;
  const rawLocation =
    typeof obj.locationLine === 'string'
      ? obj.locationLine
      : typeof obj.location === 'string'
      ? obj.location
      : undefined;

  const normalizeText = (value: string): string => {
    const collapsed = value.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
    if (!collapsed) return '';
    const limit = 140;
    if (collapsed.length <= limit) return collapsed;
    const trimmed = collapsed.slice(0, limit).replace(/[.,;:!?]?\s*$/, '');
    return `${trimmed}…`;
  };

  const normalizeForCompare = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[.,;:!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const isDuplicateOfLocation = (desc: string, loc: string): boolean => {
    if (!desc || !loc) return false;
    const normDesc = normalizeForCompare(desc);
    const normLoc = normalizeForCompare(loc);
    if (!normDesc || !normLoc) return false;
    if (normDesc.includes(normLoc)) return true;
    if (normLoc.includes(normDesc)) return true;
    const descTokens = new Set(normDesc.split(' ').filter(Boolean));
    const locTokens = new Set(normLoc.split(' ').filter(Boolean));
    if (locTokens.size === 0) return false;
    let overlap = 0;
    locTokens.forEach((token) => {
      if (descTokens.has(token)) overlap += 1;
    });
    return overlap / locTokens.size >= 0.7;
  };

  const toTypeLabel = (value: string | null): string | null => {
    if (!value) return null;
    const normalized = value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalized) return null;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const descriptionCandidate = rawDescription ? normalizeText(rawDescription) : '';
  const locationLine = rawLocation ? rawLocation.trim() : '';
  const description =
    descriptionCandidate &&
    !looksLikeAddress(descriptionCandidate) &&
    !(locationLine && isDuplicateOfLocation(descriptionCandidate, locationLine))
      ? descriptionCandidate
      : '';

  const typeCandidates = [
    obj.category,
    obj.kind,
    obj.type,
    Array.isArray(obj.types) ? obj.types[0] : null,
    (obj.entity as Record<string, unknown> | undefined)?.category,
    (obj.entity as Record<string, unknown> | undefined)?.kind,
    (obj.entity as Record<string, unknown> | undefined)?.type,
    Array.isArray((obj.entity as Record<string, unknown> | undefined)?.types)
      ? ((obj.entity as Record<string, unknown>).types as unknown[])?.[0]
      : null,
    (obj.savedWaypoint as Record<string, unknown> | undefined)?.type,
  ]
    .map((candidate) =>
      typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : null
    )
    .filter(Boolean) as string[];

  const typeLabel = toTypeLabel(typeCandidates[0] ?? null);
  const priceValue =
    typeof obj.priceLevel === 'string' && obj.priceLevel.trim()
      ? obj.priceLevel.trim()
      : typeof obj.cost === 'string' && obj.cost.trim()
      ? obj.cost.trim()
      : null;

  const tags: string[] = [];
  if (obj.outdoor === true || obj.isOutdoor === true) tags.push('Outdoor');
  if (obj.indoor === true || obj.isIndoor === true) tags.push('Indoor');
  if (obj.familyFriendly === true || obj.isFamilyFriendly === true) {
    tags.push('Family-friendly');
  }
  if (typeof obj.priceLevel === 'string' && obj.priceLevel.trim()) {
    tags.push(obj.priceLevel.trim());
  }

  if (description) {
    return {
      primary: description,
      secondary: priceValue ? `Price: ${priceValue}` : undefined,
      tags: tags.length > 0 ? tags.slice(0, 3) : undefined,
    };
  }

  if (typeLabel) {
    return {
      primary: `A ${typeLabel.toLowerCase()} to consider for your plan.`,
      secondary: priceValue ? `Price: ${priceValue}` : 'Good candidate for a stop.',
      tags: tags.length > 0 ? tags.slice(0, 3) : undefined,
    };
  }

  return {
    primary: 'A place to consider for your plan.',
    secondary: priceValue ? `Price: ${priceValue}` : undefined,
    tags: tags.length > 0 ? tags.slice(0, 3) : undefined,
  };
}

function buildReturnTo(pathname: string, searchParams: URLSearchParams): string {
  const qs = searchParams.toString();
  return `${pathname}${qs ? `?${qs}` : ''}`;
}

function sanitizeReturnTo(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    if (!raw.startsWith('/')) return null;
    const url = new URL(raw, 'http://example.com');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function normalizeLabel(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[().,:;\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function HomePageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showDevTools = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === '1';
  void showDevTools;
  const TEMPLATES_ENABLED = false;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { user } = useSession();
  const userId = user?.id ?? null;

  //  Data from "API"
  const [data, setData] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  //  Location (optional)
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'requesting' | 'denied' | 'available'
  >('idle');

  //  Saved waypoints (favorites)
  const [savedWaypoints, setSavedWaypoints] = useState<SavedWaypoint[]>([]);
  const [waypointView, setWaypointView] = useState<'all' | 'saved'>('all');
  const [selectedDiscoveryItem, setSelectedDiscoveryItem] =
    useState<DisplayWaypoint | null>(null);
  const [addToPlanError, setAddToPlanError] = useState<string | null>(null);
  const [addToPlanSuccess, setAddToPlanSuccess] = useState<string | null>(null);
  const [isAddingToPlan, setIsAddingToPlan] = useState(false);
  const [slotHint, setSlotHint] = useState<string | null>(null);
  const [resultsUpdatedAt, setResultsUpdatedAt] = useState<string | null>(null);
  const [resultsCleared, setResultsCleared] = useState(false);
  const [lastResultsSource, setLastResultsSource] = useState<
    'search' | 'surprise' | null
  >(null);
  const [continueCollapsed, setContinueCollapsed] = useState(false);
  const userToggledContinueRef = useRef(false);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  /**
   * SavedWaypoint fields observed from local storage (lib/savedWaypoints.ts):
   * id, name, description, location, mood, cost, proximity, useCases.
   * Source: SavedWaypoint is derived from Entity in data/entities.ts.
   */
  //  V2 plans stored via plan engine (recent/saved)
  const [recentV2Plans, setRecentV2Plans] = useState<PlanIndexItem[]>([]);
  const [recentShowSavedOnly] = useState(false);
  const [templatePlans, setTemplatePlans] = useState<TemplateIndexItem[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [showTemplateExplorer, setShowTemplateExplorer] = useState(false);
  const [activeTemplatePackId, setActiveTemplatePackId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateIndexItem | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const authPanelRef = useRef<HTMLDivElement | null>(null);
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const discoveryScrollTimeoutRef = useRef<number | null>(null);
  const discoverySnapshotRef = useRef<{ path: string; queryString: string } | null>(null);
  const discoveryScrollRestoredRef = useRef(false);
  const discoveryActiveRef = useRef(false);
  const lastSearchHydratedRef = useRef(false);
  const [showExploreMore, setShowExploreMore] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null);
  void previewTick;
  const planIdParam = (searchParams.get('planId') ?? '').trim() || null;
  const currentPlanId = activePlanId || planIdParam;
  const railPlanId = currentPlanId;
  const railShortId = railPlanId ? railPlanId.slice(0, 6) : '';
  const slotPrefillRef = useRef(false);
  const templateSectionRef = useRef<HTMLDivElement | null>(null);
  const exploreSectionRef = useRef<HTMLDivElement | null>(null);
  const templatesBootstrappedRef = useRef(false);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const didLogDerivedOriginRef = useRef(false);
  const addToPlanTimeoutRef = useRef<number | null>(null);
  const addToPlanInFlightRef = useRef(false);
  const addToPlanTickRef = useRef(0);
  const addToPlanTickScheduledRef = useRef(false);
  const addToPlanDedupeRef = useRef<Set<string>>(new Set());
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const lastCompletedSearchRef = useRef<string | null>(null);

  function requestLocation() {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      return;
    }

    setLocationStatus('requesting');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationStatus('available');
      },
      () => {
        setLocationStatus('denied');
      }
    );
  }

  // Load saved waypoints once on mount
  useEffect(() => {
    const saved = loadSavedWaypoints();
    setSavedWaypoints(saved);
    if (
      process.env.NODE_ENV === 'development' &&
      !didLogSavedWaypoint &&
      saved.length > 0
    ) {
      didLogSavedWaypoint = true;
      console.debug('[saved-waypoints] sample shape', saved[0]);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setSupabaseLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (didLogDerivedOriginRef.current) return;
    if (waypointView !== 'saved') return;
    if (savedWaypoints.length === 0) return;
    didLogDerivedOriginRef.current = true;
    savedWaypoints.slice(0, 3).forEach((item) => {
      const origin = deriveOrigin(item);
      console.debug('[saved-waypoints] origin', {
        title: item.name ?? item.id,
        origin,
      });
    });
  }, [savedWaypoints, waypointView]);

  useEffect(() => {
    return () => {
      if (addToPlanTimeoutRef.current) {
        window.clearTimeout(addToPlanTimeoutRef.current);
        addToPlanTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      pendingStarterHandledRef.current = false;
      isPromotingRef.current = false;
    }
  }, [userId]);

  const loadSupabaseWaypoints = useCallback(async () => {
    if (!userId) return;
    setSupabaseLoading(true);
    const listResult = await listCloudPlans(userId);
    if (!listResult.ok) {
      setSupabaseLoading(false);
      const fallback = (recentShowSavedOnly ? getSavedPlans() : getRecentPlans()).map(
        (item) => ({
        ...item,
        isShared: isPlanShared(item.id),
        })
      );
      const filtered = recentShowSavedOnly
        ? fallback.filter((item) => item.isSaved)
        : fallback;
      setRecentV2Plans(filtered.slice(0, 8));
      return;
    }

    const cloudRows = await Promise.all(
      listResult.plans.map(async (summary) => {
        const detail = await fetchCloudPlan(summary.id, userId);
        if (!detail.ok) return null;
        try {
          const encoded = serializePlan(detail.plan);
          return {
            id: summary.id,
            title: summary.title || detail.plan.title || 'Waypoint',
            intent: detail.plan.intent,
            audience: detail.plan.audience,
            encoded,
            updatedAt: new Date(summary.updatedAt).toISOString(),
            isSaved: true,
            isShared: isPlanShared(summary.id),
          } as PlanIndexItem;
        } catch {
          return null;
        }
      })
    );

    const mapped = cloudRows.filter(Boolean) as PlanIndexItem[];
    const base = (recentShowSavedOnly ? getSavedPlans() : getRecentPlans()).map(
      (item) => ({
        ...item,
        isShared: isPlanShared(item.id),
      })
    );
    const merged = mergePlanLists(base, mapped);
    const filtered = recentShowSavedOnly
      ? merged.filter((item) => item.isSaved)
      : merged;
    setRecentV2Plans(filtered.slice(0, 8));
    setSupabaseLoading(false);
  }, [recentShowSavedOnly, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshLocalPlans = () => {
      const plans = (recentShowSavedOnly ? getSavedPlans() : getRecentPlans()).map(
        (item) => ({
          ...item,
          isShared: isPlanShared(item.id),
        })
      );
      setRecentV2Plans(plans.slice(0, 8));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RECENT_PLANS_PULSE_KEY) return;
      refreshLocalPlans();
      if (userId) {
        void loadSupabaseWaypoints();
      }
    };
    const handlePulse = () => {
      refreshLocalPlans();
      if (userId) {
        void loadSupabaseWaypoints();
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(RECENT_PLANS_PULSE_EVENT, handlePulse);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(RECENT_PLANS_PULSE_EVENT, handlePulse);
    };
  }, [loadSupabaseWaypoints, recentShowSavedOnly, userId]);

  const loadTemplates = useCallback(async () => {
    const localTemplates = getTemplatePlans();
    if (!userId) {
      setTemplateLoading(false);
      setTemplatePlans(localTemplates.slice(0, 8));
      return;
    }
    setTemplateLoading(true);
    const listResult = await listCloudPlans(userId);
    if (!listResult.ok) {
      setTemplatePlans(localTemplates.slice(0, 8));
      setTemplateLoading(false);
      return;
    }

    const cloudRows = await Promise.all(
      listResult.plans.map(async (summary) => {
        const detail = await fetchCloudPlan(summary.id, userId);
        if (!detail.ok) return null;
        const plan = detail.plan;
        if (!plan.isTemplate) return null;
        try {
          const encoded = serializePlan(plan);
          const templateTitle = plan.templateMeta?.title || plan.title || 'Template';
          return {
            id: summary.id,
            title: plan.title || summary.title || 'Template',
            intent: plan.intent || '',
            audience: plan.audience || undefined,
            encoded,
            updatedAt: new Date(summary.updatedAt).toISOString(),
            isSaved: true,
            isShared: isPlanShared(summary.id),
            templateTitle,
          } as TemplateIndexItem;
        } catch {
          return null;
        }
      })
    );

    const merged = new Map<string, TemplateIndexItem>();
    localTemplates.forEach((item) => merged.set(item.id, item));
    cloudRows.filter(Boolean).forEach((item) => merged.set((item as TemplateIndexItem).id, item as TemplateIndexItem));

    const sorted = [...merged.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    setTemplatePlans(sorted.slice(0, 8));
    setTemplateLoading(false);
  }, [userId]);

  const templatePacks = useMemo(() => {
    const packMap = new Map<
      string,
      { id: string; title: string; description?: string; tags?: string[]; count: number }
    >();
    templatePlans.forEach((template) => {
      const existing = packMap.get(template.packId);
      if (existing) {
        existing.count += 1;
        return;
      }
      packMap.set(template.packId, {
        id: template.packId,
        title: template.packTitle,
        description: template.packDescription,
        tags: template.packTags,
        count: 1,
      });
    });
    const slugify = (value: unknown) => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return trimmed
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    };
    const packs = [...packMap.values()];
    const idCounts = new Map<string, number>();
    return packs.map((pack) => {
      const baseId = typeof pack.id === 'string' && pack.id.trim() ? pack.id : '';
      const fallback =
        slugify(pack.title) || slugify((pack as { name?: string }).name) || slugify((pack as { label?: string }).label);
      const normalizedBase = baseId || fallback || 'pack';
      const seen = idCounts.get(normalizedBase) ?? 0;
      idCounts.set(normalizedBase, seen + 1);
      const id = seen === 0 ? normalizedBase : `${normalizedBase}-${seen + 1}`;
      return { ...pack, id };
    });
  }, [templatePlans]);

  const activeTemplatePack = useMemo(() => {
    if (!activeTemplatePackId) return null;
    return templatePacks.find((pack) => pack.id === activeTemplatePackId) ?? null;
  }, [activeTemplatePackId, templatePacks]);

  const templatesInActivePack = useMemo(() => {
    if (!activeTemplatePackId) return templatePlans;
    return templatePlans.filter((template) => template.packId === activeTemplatePackId);
  }, [activeTemplatePackId, templatePlans]);

  const selectedTemplatePlan = useMemo(() => {
    if (!selectedTemplate?.encoded) return null;
    try {
      return deserializePlan(selectedTemplate.encoded);
    } catch {
      return null;
    }
  }, [selectedTemplate]);
  const demoFromPayload = useMemo(() => {
    try {
      return serializePlan(DEMO_PLAN);
    } catch {
      return '';
    }
  }, []);
  const selectedTemplateFromPayload = useMemo(() => {
    if (!selectedTemplatePlan) return '';
    try {
      const next = createPlanFromTemplatePlan(selectedTemplatePlan);
      return serializePlan(next);
    } catch {
      return '';
    }
  }, [selectedTemplatePlan]);
  const buildModeHref = useCallback((mode: 'plan' | 'publish' | 'curate', from?: string) => {
    const params = new URLSearchParams();
    params.set('mode', mode);
    if (from) params.set('from', from);
    return `/create?${params.toString()}`;
  }, []);
  const planModeHref = useMemo(() => {
    if (selectedTemplateFromPayload) {
      return buildModeHref('plan', selectedTemplateFromPayload);
    }
    return buildModeHref('plan');
  }, [buildModeHref, selectedTemplateFromPayload]);
  const publishModeHref = useMemo(() => {
    return buildModeHref('publish', selectedTemplateFromPayload || demoFromPayload);
  }, [buildModeHref, demoFromPayload, selectedTemplateFromPayload]);
  const curateModeHref = useMemo(() => {
    return buildModeHref('curate', selectedTemplateFromPayload || demoFromPayload);
  }, [buildModeHref, demoFromPayload, selectedTemplateFromPayload]);
  void planModeHref;
  void publishModeHref;
  void curateModeHref;
  const cityDistrictsHref = useMemo(
    () => withPreservedModeParam('/city/san-jose', searchParams),
    [searchParams]
  );
  const downtownDistrictHref = useMemo(
    () => withPreservedModeParam('/districts/downtown', searchParams),
    [searchParams]
  );

  useEffect(() => {
    if (!userId) return;
    if (typeof window === 'undefined') return;
    const flag = `waypoint_migrated_${userId}`;
    if (window.localStorage.getItem(flag) === '1') return;

    const localPlans = getRecentPlans();
    if (localPlans.length === 0) {
      window.localStorage.setItem(flag, '1');
      return;
    }

    (async () => {
      setSupabaseLoading(true);
      type CloudPlanInsert = {
        id: string;
        owner_id: string;
        plan_json: Plan;
        share_token?: string | null;
      };
      const payload = localPlans
        .map((item) => {
          try {
            const planObj = deserializePlan(item.encoded);
            return {
              id: item.id,
              owner_id: userId,
              plan_json: planObj,
              share_token: planObj.presentation?.shareToken ?? null,
            } as CloudPlanInsert;
          } catch {
            return null;
          }
        })
        .filter((item): item is CloudPlanInsert => Boolean(item));

      try {
        await supabase.from(CLOUD_PLANS_TABLE).upsert(payload, { onConflict: 'id' });
        window.localStorage.setItem(flag, '1');
        if (payload.length > 0) {
          setMigrationMessage(
            `Imported ${payload.length} Waypoints from this device. Local copies were kept. Nothing was deleted.`
          );
        }
        loadSupabaseWaypoints();
      } catch {
        // ignore migration errors
      } finally {
        setSupabaseLoading(false);
      }
    })();
  }, [loadSupabaseWaypoints, supabase, userId]);

  useEffect(() => {
    loadSupabaseWaypoints();
  }, [loadSupabaseWaypoints]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (templatesBootstrappedRef.current) return;
    const templatesParam = searchParams.get('templates');
    if (templatesParam !== '1') return;
    templatesBootstrappedRef.current = true;
    setShowTemplateExplorer(true);
    setActiveTemplatePackId(null);
    if (templateSectionRef.current) {
      templateSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  useEffect(() => {
    const authParam = searchParams.get('auth');
    if (authParam !== '1') return;
    handleScrollToAuth();
  }, [searchParams]);

  useEffect(() => {
    const noticeParam = searchParams.get('notice');
    if (!noticeParam) return;
    if (noticeParam === 'missing-plan') {
      setNoticeMessage('We could not open that plan. You are back on Home.');
    } else {
      setNoticeMessage('We could not open that view. You are back on Home.');
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('notice');
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam !== '1') return;
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      const input = document.getElementById('home-what') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('search');
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!showTemplateExplorer) {
      setActiveTemplatePackId(null);
    }
  }, [showTemplateExplorer]);


  // Load V2 recent/saved plans on mount and when filter toggles
  useEffect(() => {
    if (userId) return;
    const plans = (recentShowSavedOnly ? getSavedPlans() : getRecentPlans()).map((item) => ({
      ...item,
      isShared: isPlanShared(item.id),
    }));
    setRecentV2Plans(plans.slice(0, 8));
  }, [recentShowSavedOnly, userId]);

  //  Filters from URL (this is the actual query sent to the API & search)
  const queryFromUrl = searchParams.get('q') ?? '';

  const discoveryQueryString = useMemo(() => {
    const raw = searchParams.toString();
    return raw ? `?${raw}` : '';
  }, [searchParams]);
  const returnTo = useMemo(
    () => buildReturnTo(pathname || '/', searchParams),
    [pathname, searchParams]
  );
  const authReturnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('returnTo')),
    [searchParams]
  );

  useEffect(() => {
    if (!userId) return;
    if (!authReturnTo) return;
    router.replace(authReturnTo);
  }, [authReturnTo, router, userId]);

  const moodFromUrlRaw =
    (searchParams.get('mood') as Mood | 'all' | null) ?? 'all';
  const moodFromUrl: Mood | 'all' = MOOD_OPTIONS.includes(moodFromUrlRaw)
    ? moodFromUrlRaw
    : 'all';
  const hasDiscoveryContext = queryFromUrl.trim().length > 0 || moodFromUrl !== 'all';

  //  Local UX state: "What" and "Where" inputs
  const [whatInput, setWhatInput] = useState(queryFromUrl);
  const [whereInput, setWhereInput] = useState('');
  const resultOrderCacheRef = useRef<Map<string, string[]>>(new Map());

  // Keep "what" in sync if URL changes (back/forward, surprise, etc.)
  useEffect(() => {
    setWhatInput(queryFromUrl);
  }, [queryFromUrl]);

  useEffect(() => {
    if (slotPrefillRef.current) return;
    slotPrefillRef.current = true;
    const slotParam = searchParams.get('slot');
    const queryParam = searchParams.get('q');
    if (slotParam) {
      setSlotHint(slotParam);
    }
    if (queryParam) {
      setWhatInput(queryParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (lastSearchHydratedRef.current) return;
    if (whatInput.trim() || whereInput.trim()) return;
    const raw = window.localStorage.getItem(LAST_SEARCH_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        q?: string;
        where?: string;
        mood?: Mood | 'all';
      };
      if (typeof parsed.q === 'string' && parsed.q.trim()) {
        setWhatInput(parsed.q.trim());
      }
      if (typeof parsed.where === 'string' && parsed.where.trim()) {
        setWhereInput(parsed.where.trim());
      }
      if (parsed.mood && MOOD_OPTIONS.includes(parsed.mood)) {
        if (parsed.mood !== moodFromUrl) {
          updateSearchParams({ mood: parsed.mood });
        }
      }
    } catch {
      // ignore malformed stored state
    }
    lastSearchHydratedRef.current = true;
  }, [moodFromUrl, updateSearchParams, whatInput, whereInput]);

  useEffect(() => {
    discoverySnapshotRef.current = {
      path: pathname || '/',
      queryString: discoveryQueryString,
    };
  }, [discoveryQueryString, pathname]);

  useEffect(() => {
    discoveryActiveRef.current = hasDiscoveryContext;
    if (typeof window === 'undefined') return;
    if (!hasDiscoveryContext) return;
    const existing = loadDiscoverySession();
    const nextSession = {
      path: pathname || '/',
      queryString: discoveryQueryString,
      createdAt: Date.now(),
    };
    const restorePending = getDiscoveryRestoreFlag();
    if (
      restorePending &&
      (!existing ||
        existing.path !== nextSession.path ||
        existing.queryString !== nextSession.queryString)
    ) {
      clearDiscoveryRestoreFlag();
    }
    if (
      restorePending &&
      existing &&
      existing.path === nextSession.path &&
      existing.queryString === nextSession.queryString &&
      window.scrollY === 0 &&
      existing.scrollY > 0
    ) {
      return;
    }
    const nextScrollY =
      existing &&
      existing.queryString === nextSession.queryString &&
      window.scrollY === 0 &&
      existing.scrollY > 0
        ? existing.scrollY
        : window.scrollY;
    saveDiscoverySession({
      ...nextSession,
      scrollY: nextScrollY,
    });
  }, [discoveryQueryString, hasDiscoveryContext, pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleScroll = () => {
      if (discoveryScrollTimeoutRef.current) {
        window.clearTimeout(discoveryScrollTimeoutRef.current);
      }
      discoveryScrollTimeoutRef.current = window.setTimeout(() => {
        if (!discoveryActiveRef.current) return;
        const snapshot = discoverySnapshotRef.current;
        if (!snapshot) return;
        saveDiscoverySession({
          path: snapshot.path,
          queryString: snapshot.queryString,
          scrollY: window.scrollY,
          createdAt: Date.now(),
        });
      }, 200);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (discoveryScrollTimeoutRef.current) {
        window.clearTimeout(discoveryScrollTimeoutRef.current);
      }
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- updateSearchParams is intentionally not memoized
  function updateSearchParams(next: { q?: string; mood?: Mood | 'all' }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.q !== undefined) {
      const trimmed = next.q.trim();
      if (trimmed.length > 0) {
        params.set('q', trimmed);
      } else {
        params.delete('q');
      }
    }

    if (next.mood !== undefined) {
      if (next.mood === 'all') {
        params.delete('mood');
      } else {
        params.set('mood', next.mood);
      }
    }

    const queryString = params.toString();
    const currentQueryString = searchParams.toString();
    if (queryString === currentQueryString) return;
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }

  function buildCombinedQuery() {
    const what = whatInput.trim();
    const where = whereInput.trim();

    if (what && where) return `${what} in ${where}`;
    if (what) return what;
    if (where) return where;
    return '';
  }

  function triggerSearch() {
    const combined = buildCombinedQuery();
    if (typeof window !== 'undefined') {
      const payload = {
        q: whatInput.trim(),
        where: whereInput.trim(),
        mood: moodFromUrl,
      };
      window.localStorage.setItem(LAST_SEARCH_STORAGE_KEY, JSON.stringify(payload));
    }
    updateSearchParams({ q: combined });
  }

  //  Load entities whenever URL query or location changes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);

        const result = await fetchEntities({
          query: queryFromUrl,
          lat: coords?.lat ?? undefined,
          lng: coords?.lng ?? undefined,
        });

        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load ideas.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [queryFromUrl, coords?.lat, coords?.lng]);

  //  Centralized search logic (text + tags + mood)
  const filteredEntities = useMemo(
    () => {
      const results = searchEntities(data, {
        query: queryFromUrl, // use whatever is in the search bar / URL
        mood: moodFromUrl,
      });

      const key = `${queryFromUrl.trim().toLowerCase()}|${moodFromUrl}`;
      const cached = resultOrderCacheRef.current.get(key);
      if (!cached) {
        resultOrderCacheRef.current.set(
          key,
          results.map((entity) => entity.id)
        );
        return results;
      }

      const rank = new Map(cached.map((id, index) => [id, index]));
      return [...results].sort((a, b) => {
        const aRank = rank.get(a.id);
        const bRank = rank.get(b.id);
        if (aRank === undefined && bRank === undefined) return 0;
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        return aRank - bRank;
      });
    },
    [data, moodFromUrl, queryFromUrl]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (discoveryScrollRestoredRef.current) return;
    if (isLoading || error) return;
    if (!hasDiscoveryContext || filteredEntities.length === 0) return;
    const session = loadDiscoverySession();
    if (!session) return;
    if (session.path !== (pathname || '/')) return;
    if (session.queryString !== discoveryQueryString) return;
    discoveryScrollRestoredRef.current = true;
    const restorePending = getDiscoveryRestoreFlag();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: session.scrollY, left: 0, behavior: 'auto' });
        if (restorePending) {
          clearDiscoveryRestoreFlag();
        }
      });
    });
  }, [discoveryQueryString, error, filteredEntities.length, hasDiscoveryContext, isLoading, pathname]);

  //  Navigate into planning flow WITH a snapshot of the entity
  function goToPlanForEntity(entity: Entity) {
    const nextPlan = createEmptyPlan({
      title: entity.name ?? 'New plan',
      intent: 'What do we want to accomplish?',
      audience: 'me-and-friends',
    });

    const origin = {
      kind: 'search' as const,
      query: queryFromUrl || undefined,
      mood: moodFromUrl !== 'all' ? moodFromUrl : undefined,
      entityId: entity.id,
      label: entity.name,
    };

    nextPlan.origin = origin;
    nextPlan.meta = {
      ...(nextPlan.meta ?? {}),
      origin,
    };

    const stopId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `stop_${Math.random().toString(36).slice(2, 8)}`;
    const anchorStop: Stop = {
      id: stopId,
      name: entity.name ?? 'Anchor stop',
      role: 'anchor',
      optionality: 'required',
      location: entity.location ?? entity.description,
      notes: 'Picked from search results.',
    };
    nextPlan.stops = [anchorStop];

    const encoded = serializePlan(nextPlan);
    const params = new URLSearchParams();
    params.set('fromEncoded', encoded);
    params.set('originSource', 'home_search');
    params.set('from', 'home_search_results');
    const href = `/create?${params.toString()}`;
    router.push(withPreservedModeParam(href, searchParams));
  }

  //  When user clicks "Plan this"
  function handlePlanClick(entity: Entity) {
    goToPlanForEntity(entity);
  }
  void handlePlanClick;

  function pushCreateWithParams(params: URLSearchParams) {
    const qs = params.toString();
    const href = `/create${qs ? `?${qs}` : ''}`;
    router.push(withPreservedModeParam(href, searchParams));
  }

  //  Surprise Me: pick a random entity and jump straight into planning
  function handleSurpriseMe(mode?: SurpriseGeneratorMode) {
    setSurpriseError(null);
    setSurpriseSaveError(null);
    setIsSavingSurprisePlan(false);
    setIsSurpriseLoading(true);
    const nextNonce = surpriseNonce + 1;
    setSurpriseNonce(nextNonce);
    const seed = Date.now() + nextNonce;

    try {
      const { starter, meta } = generateSurpriseStarterCandidate({
        entities: filteredEntities.length > 0 ? filteredEntities : data,
        mode,
        seedMeta: {
          sourcePool: surpriseMeta?.sourcePool,
          stopCount: surprisePlan?.stops?.length,
        },
        seed,
      });
      setSurpriseStarter(starter);
      setSurpriseMeta(meta);
      const seededPlan = createPlanFromTemplate(starter.seedPlan);
      const metadata = seededPlan.metadata ?? {};
      const pool = filteredEntities.length > 0 ? filteredEntities : data;
      const nextStops = [...(seededPlan.stops ?? [])].slice(0, 4);
      if (nextStops.length < 2 && pool.length > 0) {
        const usedNames = new Set(nextStops.map((stop) => stop.name));
        const targetCount = Math.min(4, Math.max(2, nextStops.length));
        const seedIndex = seed % pool.length;
        for (let offset = 0; nextStops.length < targetCount && offset < pool.length; offset += 1) {
          const entity = pool[(seedIndex + offset) % pool.length];
          if (!entity || usedNames.has(entity.name)) continue;
          usedNames.add(entity.name);
          nextStops.push({
            id:
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `stop_${Math.random().toString(36).slice(2, 8)}`,
            name: entity.name ?? 'New stop',
            role: nextStops.length === 0 ? 'anchor' : 'support',
            optionality: 'required',
            location: entity.location ?? undefined,
            notes: entity.description ?? undefined,
          });
        }
      }
      const normalizedStops = nextStops.slice(0, 4);
      setSurprisePlan({
        ...seededPlan,
        stops: normalizedStops,
        originStarterId: starter.id,
        origin: {
          kind: 'surprise',
          source: 'surprise',
          label: surpriseOriginLabel ?? undefined,
        },
        metadata: {
          ...metadata,
          createdAt: metadata.createdAt ?? meta.generatedAt,
          lastUpdated: meta.generatedAt,
        },
      });
      markResultsUpdated('surprise', { skipScroll: true });
    } catch {
      setSurpriseStarter(null);
      setSurpriseMeta(null);
      setSurprisePlan(null);
      setSurpriseError('Could not generate a plan. Please try again.');
    } finally {
      setIsSurpriseLoading(false);
    }
  }

  function handleEditSurprisePlan() {
    if (!surprisePlan) return;
    try {
      const encoded = serializePlan(surprisePlan);
      router.push(
        withPreservedModeParam(
          `/create?fromEncoded=${encodeURIComponent(encoded)}&source=surprise&from=home_surprise`,
          searchParams
        )
      );
    } catch {
      setSurpriseError('Could not open this plan. Please try again.');
    }
  }

  function handleClearSurprisePreview() {
    setSurpriseStarter(null);
    setSurpriseMeta(null);
    setSurprisePlan(null);
    setSurpriseError(null);
    setSurpriseSaveError(null);
    setIsSavingSurprisePlan(false);
  }

  async function handleUseSurprisePlan() {
    if (!surprisePlan) return;
    setIsSavingSurprisePlan(true);
    setSurpriseSaveError(null);
    try {
      const encoded = serializePlan(surprisePlan);
      router.push(
        withPreservedModeParam(
          `/create?fromEncoded=${encodeURIComponent(encoded)}&source=surprise&from=home_surprise`,
          searchParams
        )
      );
    } catch {
      setSurpriseSaveError("Couldn't save. Try again.");
    } finally {
      setIsSavingSurprisePlan(false);
    }
  }

  function handleUseTemplate(template: TemplateIndexItem) {
    if (!template.encoded) return;
    try {
      const templatePlan = deserializePlan(template.encoded);
      const next = createPlanFromTemplatePlan(templatePlan);
      const origin = {
        kind: 'template' as const,
        label: template.templateTitle || template.title || 'Untitled template',
        entityId: template.id,
      };
      next.meta = {
        ...next.meta,
        origin,
      };
    next.origin = origin;
    const encoded = serializePlan(next);
    const originHref = '/?templates=1';
    router.push(
      withPreservedModeParam(
        `/create?fromEncoded=${encodeURIComponent(encoded)}&origin=${encodeURIComponent(originHref)}&returnTo=${encodeURIComponent(returnTo)}&from=home_template_library`,
        searchParams
      )
    );
  } catch {
    // ignore invalid payloads
  }
  }

  function handleOpenTemplatePreview(template: TemplateIndexItem) {
    setSelectedTemplate(template);
  }

  function handleCloseTemplatePreview() {
    setSelectedTemplate(null);
  }

  async function handleDeleteTemplate(template: TemplateIndexItem) {
    if (!userId) return;
    try {
      await supabase
        .from(CLOUD_PLANS_TABLE)
        .delete()
        .eq('id', template.id)
        .eq('owner_id', userId);
    } catch {
      // ignore delete failures for now
    }
    removePlanById(template.id);
    setTemplatePlans((prev) => prev.filter((item) => item.id !== template.id));
    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(null);
    }
  }

  function handleSelectTemplatePack(packId: string) {
    setActiveTemplatePackId(packId);
    setShowTemplateExplorer(true);
  }

  function handleRemoveRecentPlan(planId: string) {
    setRecentV2Plans((prev) => prev.filter((plan) => plan.id !== planId));
    removePlanById(planId);
    if (userId) {
      void (async () => {
        try {
          await supabase
            .from(CLOUD_PLANS_TABLE)
            .delete()
            .eq('id', planId)
            .eq('owner_id', userId);
          setRecentV2Plans((prev) => prev.filter((plan) => plan.id !== planId));
        } catch {
          // Ignore delete failures; local copy already removed.
        }
      })();
    }
  }

  //  Toggle saved waypoint
  function toggleSavedWaypointForEntity(entity: Entity) {
    const exists = savedWaypoints.some((wp) => wp.id === entity.id);

    if (exists) {
      removeSavedWaypoint(entity.id);
    } else {
      saveWaypointFromEntity(entity);
    }

    const next = loadSavedWaypoints();
    setSavedWaypoints(next);
  }

  function toggleSavedWaypointById(id: string) {
    const exists = savedWaypoints.some((wp) => wp.id === id);

    if (exists) {
      removeSavedWaypoint(id);
    }

    const next = loadSavedWaypoints();
    setSavedWaypoints(next);
  }

  const markResultsUpdated = useCallback(
    (source: 'search' | 'surprise', options?: { skipScroll?: boolean }) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    setResultsCleared(false);
    setResultsUpdatedAt(`Results updated ${stamp}`);
    setLastResultsSource(source);
    if (typeof window !== 'undefined' && !options?.skipScroll) {
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  // Which waypoints should we show in the main list?
  const displayWaypoints: DisplayWaypoint[] = useMemo(() => {
    if (waypointView === 'all') {
      return filteredEntities.map((entity) => ({ source: 'entity', entity }));
    }
    return savedWaypoints.map((saved) => ({ source: 'saved', saved }));
  }, [waypointView, filteredEntities, savedWaypoints]);
  const visibleWaypoints = resultsCleared ? [] : displayWaypoints;
  const hasResults = visibleWaypoints.length > 0 || Boolean(resultsUpdatedAt);
  const currentPlan = useMemo(
    () =>
      currentPlanId
        ? recentV2Plans.find((plan) => plan.id === currentPlanId) ?? null
        : null,
    [currentPlanId, recentV2Plans]
  );
  const currentPlanShortId = currentPlanId ? currentPlanId.slice(0, 8) : '';
  const currentPlanLabel =
    currentPlan?.title?.trim() || (currentPlanShortId ? `Plan ${currentPlanShortId}` : '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
    setActivePlanId(stored && stored.trim() ? stored : null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activePlanId) {
      window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, activePlanId);
    } else {
      window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    }
  }, [activePlanId]);

  useEffect(() => {
    if (!activePlanId) return;
    if (userId && supabaseLoading) return;
    const exists = recentV2Plans.some((plan) => plan.id === activePlanId);
    if (!exists) {
      setActivePlanId(null);
    }
  }, [activePlanId, recentV2Plans, supabaseLoading, userId]);

  useEffect(() => {
    if (isLoading || error) return;
    const hasActiveSearch = queryFromUrl.trim() !== '' || moodFromUrl !== 'all';
    if (!hasActiveSearch) return;
    const searchKey = `${queryFromUrl}|${moodFromUrl}|${coords?.lat ?? ''}|${
      coords?.lng ?? ''
    }`;
    if (lastCompletedSearchRef.current === searchKey) return;
    lastCompletedSearchRef.current = searchKey;
    setSurpriseStarter(null);
    setSurpriseMeta(null);
    setSurprisePlan(null);
    markResultsUpdated('search');
  }, [
    coords?.lat,
    coords?.lng,
    error,
    isLoading,
    markResultsUpdated,
    moodFromUrl,
    queryFromUrl,
  ]);

  useEffect(() => {
    if (userToggledContinueRef.current) return;
    setContinueCollapsed(hasResults);
  }, [hasResults]);

  const selectedDiscoveryDetail = useMemo(() => {
    if (!selectedDiscoveryItem) return null;
    const source =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity
        : selectedDiscoveryItem.saved;
    const cost: CostTag | undefined =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity.cost
        : (selectedDiscoveryItem.saved.cost as CostTag | undefined);
    const proximity: ProximityTag | undefined =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity.proximity
        : (selectedDiscoveryItem.saved.proximity as ProximityTag | undefined);
    const useCases: UseCaseTag[] | undefined =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity.useCases
        : (selectedDiscoveryItem.saved.useCases as UseCaseTag[] | undefined);
    const timeLabel =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity.timeLabel
        : undefined;
    const origin =
      selectedDiscoveryItem.source === 'saved'
        ? deriveOrigin(selectedDiscoveryItem.saved)
        : null;
    const originLine = origin
      ? origin.originType === 'District'
        ? `${origin.primaryLabel} · ${origin.secondaryLabel ?? ''}`.trim()
        : origin.originType === 'City'
        ? origin.primaryLabel
        : origin.originType === 'Template'
        ? `Template · ${origin.primaryLabel}`
        : `Search · "${origin.primaryLabel}"`
      : null;
    const categoryLabel =
      useCases && useCases.length > 0
        ? labelUseCase(useCases[0])
        : selectedDiscoveryItem.source === 'saved'
        ? 'Saved place'
        : 'Place';
    const decisionHint = cost
      ? `Price: ${labelCost(cost)}`
      : timeLabel
      ? `Hours: ${timeLabel}`
      : proximity
      ? labelProximity(proximity)
      : 'Popular nearby';
    const mapsQuery = source.location ?? originLine ?? '';
    const mapsUrl = mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          mapsQuery
        )}`
      : null;
    const websiteUrl = extractWebsiteUrl(selectedDiscoveryItem) ?? extractWebsiteUrl(source) ?? null;
    return {
      title: source.name ?? 'Waypoint',
      description: source.description ?? '',
      locationLine: source.location ?? originLine ?? '',
      categoryLabel,
      decisionHint,
      mapsUrl,
      websiteUrl,
    };
  }, [selectedDiscoveryItem]);

  useEffect(() => {
    if (!selectedDiscoveryItem || !selectedDiscoveryDetail) return;
    const source =
      selectedDiscoveryItem.source === 'entity'
        ? selectedDiscoveryItem.entity
        : selectedDiscoveryItem.saved;
    const id = source?.id ?? '∅';
    const title = selectedDiscoveryDetail.title ?? '∅';
    const websiteFromDetail =
      extractWebsiteUrl(selectedDiscoveryDetail ?? null) ?? '∅';
    const websiteFromItem = extractWebsiteUrl(selectedDiscoveryItem) ?? '∅';
    const websiteFromSource = source ? extractWebsiteUrl(source) ?? '∅' : '∅';
    const websiteCandidate =
      websiteFromDetail !== '∅'
        ? websiteFromDetail
        : websiteFromItem !== '∅'
        ? websiteFromItem
        : websiteFromSource !== '∅'
        ? websiteFromSource
        : '∅';
    void id;
    void title;
    void websiteFromDetail;
    void websiteFromItem;
    void websiteFromSource;
    void websiteCandidate;
  }, [selectedDiscoveryDetail, selectedDiscoveryItem]);

  const devSharePlan = useMemo(() => {
    const base = createEmptyPlan({
      title: 'Sanity Check Plan',
      intent: 'Quick dev-only share test',
      audience: 'dev-only',
    });
    return {
      ...base,
      stops: [
        {
          id: 's1',
          name: 'Anchor activity',
          role: 'anchor' as const,
          optionality: 'required' as const,
          notes: 'Primary stop for testing.',
        },
        {
          id: 's2',
          name: 'Support stop',
          role: 'support' as const,
          optionality: 'flexible' as const,
          duration: '30-45 min',
        },
      ],
      constraints: { timeWindow: 'Evening', budgetRange: 'Under $40/person' },
      signals: { vibe: 'Relaxed', flexibility: 'Medium' },
      metadata: { createdBy: 'Dev', lastUpdated: new Date().toISOString() },
    };
  }, []);

  const shareLinks = useMemo(() => {
    const relativePath = `/plan?p=${encodeURIComponent(serializePlan(devSharePlan))}`;
    const fullUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${relativePath}`
        : relativePath;
    return { relativePath, fullUrl };
  }, [devSharePlan]);

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [selectedStarter, setSelectedStarter] = useState<v6Starters.PlanStarter | null>(null);
  const [isPromotingStarter, setIsPromotingStarter] = useState(false);
  const [pendingStarterMessage, setPendingStarterMessage] = useState<string | null>(null);
  const pendingStarterHandledRef = useRef(false);
  const isPromotingRef = useRef(false);
  const [surpriseStarter, setSurpriseStarter] = useState<PlanStarter | null>(null);
  const [surpriseMeta, setSurpriseMeta] = useState<SurpriseStarterMeta | null>(null);
  const [surprisePlan, setSurprisePlan] = useState<Plan | null>(null);
  const [surpriseError, setSurpriseError] = useState<string | null>(null);
  const [isSavingSurprisePlan, setIsSavingSurprisePlan] = useState(false);
  const [surpriseSaveError, setSurpriseSaveError] = useState<string | null>(null);
  const [isSurpriseLoading, setIsSurpriseLoading] = useState(false);
  const [surpriseNonce, setSurpriseNonce] = useState(0);

  const starterOptions = useMemo(
    () => [...v6Starters.V6_TEMPLATE_STARTERS, ...v6Starters.IDEA_DATE_IMPORTED_STARTERS],
    []
  );
  void copyStatus;
  void isPromotingStarter;
  void pendingStarterMessage;
  void starterOptions;
  const previewPlaces = useMemo(() => data.slice(0, 8), [data]);
  const resumePlan = useMemo(
    () => (recentV2Plans.length > 0 && !recentShowSavedOnly ? recentV2Plans[0] : null),
    [recentShowSavedOnly, recentV2Plans]
  );
  const moreRecentPlans = useMemo(() => {
    if (!resumePlan) return recentV2Plans.slice(0, 3);
    return recentV2Plans.filter((plan) => plan.id !== resumePlan.id).slice(0, 3);
  }, [recentV2Plans, resumePlan]);
  const experiencePreviewQueries = useMemo(
    () =>
      VENUE_EXPERIENCES_V2.flatMap((experience) =>
        buildSeededTemplatePreviewQueries(
          getTemplateSeedById(experience.id) ?? {
            id: experience.id,
            version: 1,
            kind: 'experience',
            origin: 'curated',
            title: experience.title,
            description: experience.description,
            stops: (experience.seededStops && experience.seededStops.length > 0
              ? experience.seededStops
              : experience.defaultQuery
              ? [experience.defaultQuery]
              : []
            ).map((label, index) => ({
              id: `${experience.id}-stop-${index + 1}`,
              label,
              role: index === 0 ? 'anchor' : 'support',
              placeRef: { query: label },
            })),
          },
          coords
        )
      ),
    [coords]
  );
  const templatePreviewQueries = useMemo(
    () =>
      WAYPOINT_TEMPLATES.flatMap((template) =>
        buildSeededTemplatePreviewQueries(
          getTemplateSeedById(template.id) ?? {
            id: template.id,
            version: 1,
            kind: 'pack',
            origin: 'template',
            title: template.name,
            description: template.description,
            stops: (template.intentQueryHints ?? []).map((label, index) => ({
              id: `${template.id}-stop-${index + 1}`,
              label,
              role: index === 0 ? 'anchor' : 'support',
              placeRef: { query: label },
            })),
          },
          coords
        )
      ),
    [coords]
  );
  const allPreviewQueries = useMemo(
    () => [...experiencePreviewQueries, ...templatePreviewQueries],
    [experiencePreviewQueries, templatePreviewQueries]
  );
  const targetPlanId = currentPlanId;
  const surpriseOriginLabel = useMemo(() => {
    if (!surpriseMeta) return null;
    if (surpriseMeta.origin === 'surprise') return 'Generated by Surprise';
    if (surpriseStarter?.source?.templateId || surpriseStarter?.type === 'TEMPLATE') {
      return 'From Starter';
    }
    return 'Generated starter';
  }, [surpriseMeta, surpriseStarter]);
  const surpriseWhyText = useMemo(() => {
    if (!surprisePlan) return null;
    const stopCount = surprisePlan.stops?.length ?? 0;
    const stopPhrase =
      stopCount === 1 ? 'a 1-stop plan' : stopCount > 1 ? `a ${stopCount}-stop plan` : 'a starter plan';
    const descriptors: string[] = [];
    if (surprisePlan.signals?.vibe) descriptors.push(`${surprisePlan.signals.vibe} vibe`);
    if (surprisePlan.signals?.flexibility) descriptors.push(`${surprisePlan.signals.flexibility} structure`);
    const origin = surpriseOriginLabel ?? 'Generated starter';
    const detail = descriptors.length > 0 ? ` with ${descriptors.join(' and ')}` : '';
    return `${origin}. ${stopPhrase}${detail}.`;
  }, [surpriseOriginLabel, surprisePlan]);
  const showSurprisePlan = lastResultsSource === 'surprise' && Boolean(surprisePlan);

  useEffect(() => {
    if (queryFromUrl || resultsUpdatedAt || showSurprisePlan) {
      setShowExploreMore(true);
    }
  }, [queryFromUrl, resultsUpdatedAt, showSurprisePlan]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pending = allPreviewQueries.filter(
      (query) =>
        !PLACE_PREVIEW_CACHE.has(query.key) && !PLACE_PREVIEW_INFLIGHT.has(query.key)
    );
    if (pending.length === 0) return undefined;

    let index = 0;
    let active = 0;
    const runNext = () => {
      if (cancelled) return;
      if (index >= pending.length && active === 0) return;
      while (active < PLACE_PREVIEW_MAX_CONCURRENCY && index < pending.length) {
        const query = pending[index++];
        active += 1;
        resolvePlacePreview(query, coords)
          .finally(() => {
            active -= 1;
            if (!cancelled) {
              setPreviewTick((tick) => tick + 1);
              runNext();
            }
          });
      }
    };
    runNext();
    return () => {
      cancelled = true;
    };
  }, [allPreviewQueries, coords]);

  function handleOpenSharedView() {
    router.push(shareLinks.relativePath);
  }
  void handleOpenSharedView;

  async function handleCopyLink() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLinks.fullUrl);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 1500);
    } catch {
      // Ignore copy failures in dev helper
    }
  }
  void handleCopyLink;

  function handleScrollToAuth() {
    setShowAuthPanel(true);
    if (authPanelRef.current) {
      requestAnimationFrame(() => {
        authPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function mapStarterConstraintsToPlan(
    constraints?: v6Starters.PlanStarter['constraints']
  ): Plan['constraints'] | undefined {
    if (!constraints) return undefined;
    const mapped: Plan['constraints'] = {};

    if (constraints.time) {
      const parts: string[] = [];
      if (constraints.time.start) parts.push(`Start ${constraints.time.start}`);
      if (constraints.time.end) parts.push(`End ${constraints.time.end}`);
      if (constraints.time.timezone) parts.push(constraints.time.timezone);
      if (parts.length > 0) {
        mapped.timeWindow = parts.join('  ');
      }
    }

    if (constraints.cost) {
      const { min, max, currency } = constraints.cost;
      const costParts: string[] = [];
      if (min !== undefined) costParts.push(`>= ${min}`);
      if (max !== undefined) costParts.push(`<= ${max}`);
      if (currency) costParts.push(currency);
      if (costParts.length > 0) {
        mapped.budgetRange = costParts.join(' ');
      }
    }

    if (constraints.location?.mobility) {
      mapped.mobility = constraints.location.mobility;
    }

    return Object.keys(mapped).length > 0 ? mapped : undefined;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildPlanFromStarter is intentionally defined inline
  function buildPlanFromStarter(starter: v6Starters.PlanStarter, owner?: string | null): Plan {
    const timestamp = new Date().toISOString();
    const base = createEmptyPlan({
      title: starter.intent.primary,
      intent: starter.intent.primary,
      audience: 'me-and-friends',
    });

    const stops = starter.structure.anchors.map((anchor, idx) => ({
      id: anchor.id || `anchor-${idx + 1}`,
      name: anchor.label || `Anchor ${idx + 1}`,
      role: 'anchor' as const,
      optionality: 'required' as const,
      notes: anchor.description,
    }));

    const metadata = {
      createdAt: timestamp,
      lastUpdated: timestamp,
      createdBy: owner ?? 'local-user',
      starterSourceType: starter.source.type,
      starterSourceId: starter.source.sourceId,
      starterIntentLabel: starter.intent.primary,
    } as Plan['metadata'] & {
      starterSourceType?: string;
      starterSourceId?: string;
      starterIntentLabel?: string;
    };

    const signals =
      starter.structure.flexibility?.structure || starter.structure.flexibility?.pacing
        ? {
            flexibility: starter.structure.flexibility?.structure,
            vibe: starter.structure.flexibility?.pacing,
          }
        : undefined;

    return {
      ...base,
      stops: stops.length > 0 ? stops : base.stops,
      constraints: mapStarterConstraintsToPlan(starter.constraints),
      context: starter.intent.context ? { localNote: starter.intent.context } : undefined,
      signals,
      metadata,
      ownerId: owner ?? undefined,
      originStarterId: starter.id,
    };
  }

  const startStarterDraft = useCallback(
    async (starter: v6Starters.PlanStarter) => {
      if (isPromotingRef.current) return;
      isPromotingRef.current = true;
      setIsPromotingStarter(true);
      setPendingStarterMessage(null);
      try {
        const plan = buildPlanFromStarter(starter, userId);
        const encoded = serializePlan(plan);
        setSelectedStarter(null);
        router.push(
          withPreservedModeParam(
            `/create?fromEncoded=${encodeURIComponent(encoded)}&from=home_starter`,
            searchParams
          )
        );
      } catch {
        setPendingStarterMessage('Could not start planning right now. Please try again.');
      } finally {
        setIsPromotingStarter(false);
        isPromotingRef.current = false;
      }
    },
    [buildPlanFromStarter, router, searchParams, userId]
  );

  useEffect(() => {
    if (!userId) return;
    if (pendingStarterHandledRef.current) return;
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(PENDING_STARTER_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as v6Starters.PlanStarter;
      pendingStarterHandledRef.current = true;
      window.localStorage.removeItem(PENDING_STARTER_KEY);
      if (isPromotingRef.current) return;
      setSelectedStarter(parsed);
      void startStarterDraft(parsed);
    } catch {
      window.localStorage.removeItem(PENDING_STARTER_KEY);
    }
  }, [startStarterDraft, userId]);

  function handleSelectStarter(starter: v6Starters.PlanStarter) {
    setSelectedStarter(starter);
    setPendingStarterMessage(null);
  }
  void handleSelectStarter;

  function handleStartSelectedStarter() {
    if (!selectedStarter) return;
    if (!userId) {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(PENDING_STARTER_KEY, JSON.stringify(selectedStarter));
        } catch {
          // ignore storage errors; user can try again after sign-in
        }
      }
      setPendingStarterMessage('Preview starters without an account. Sign in to save, edit, or share your plan.');
      handleScrollToAuth();
      return;
    }
    void startStarterDraft(selectedStarter);
  }
  void handleStartSelectedStarter;

  function handleClearSelectedStarter() {
    setSelectedStarter(null);
    setPendingStarterMessage(null);
  }
  void handleClearSelectedStarter;

  function handleSelectDiscoveryItem(item: DisplayWaypoint) {
    setSelectedDiscoveryItem(item);
    setAddToPlanError(null);
    setAddToPlanSuccess(null);
  }

  function scheduleAddToPlanTick() {
    if (addToPlanTickScheduledRef.current) return;
    addToPlanTickScheduledRef.current = true;
    queueMicrotask(() => {
      addToPlanTickRef.current += 1;
      addToPlanDedupeRef.current.clear();
      addToPlanTickScheduledRef.current = false;
    });
  }

  function clearAddToPlanTimeout() {
    if (addToPlanTimeoutRef.current) {
      window.clearTimeout(addToPlanTimeoutRef.current);
      addToPlanTimeoutRef.current = null;
    }
  }

  async function handleAddToCurrentPlan(item: DisplayWaypoint, planId: string) {
    if (addToPlanInFlightRef.current) return;
    const source = item.source === 'entity' ? item.entity : item.saved;
    scheduleAddToPlanTick();
    const dedupeKey = `${planId}:${source.id}`;
    if (addToPlanDedupeRef.current.has(dedupeKey)) {
      return;
    }
    addToPlanDedupeRef.current.add(dedupeKey);

    addToPlanInFlightRef.current = true;
    setIsAddingToPlan(true);
    setAddToPlanError(null);
    setAddToPlanSuccess(null);
    clearAddToPlanTimeout();

    try {
      const plan = loadSavedPlan(planId);
      if (!plan) {
        throw new Error('missing-plan');
      }
      const now = new Date().toISOString();
      const normalizedSlot = slotHint?.trim().toLowerCase() ?? '';
      const hasSlot = Boolean(normalizedSlot);
      const slotParam = searchParams.get('slot');
      let nextPlan: Plan | null = null;
      let slotFillSuccess = false;
      if (hasSlot) {
        const slotHintNormalized = normalizeLabel(slotHint ?? '');
        const placeholderIndexes = (plan.stops ?? [])
          .map((stop, index) => (stop.notes === 'Pick from search results.' ? index : -1))
          .filter((index) => index >= 0);
        let replacementIndex = -1;
        for (const index of placeholderIndexes) {
          const stop = plan.stops?.[index];
          const stopNameNormalized = normalizeLabel(stop?.name ?? '');
          if (stopNameNormalized && stopNameNormalized === slotHintNormalized) {
            replacementIndex = index;
            break;
          }
        }
        if (replacementIndex === -1) {
          for (const index of placeholderIndexes) {
            const stop = plan.stops?.[index];
            const stopNameNormalized = normalizeLabel(stop?.name ?? '');
            if (
              stopNameNormalized &&
              slotHintNormalized &&
              stopNameNormalized.startsWith(slotHintNormalized)
            ) {
              replacementIndex = index;
              break;
            }
          }
        }
        if (replacementIndex === -1) {
          for (const index of placeholderIndexes) {
            const stop = plan.stops?.[index];
            const stopNameNormalized = normalizeLabel(stop?.name ?? '');
            if (
              stopNameNormalized &&
              slotHintNormalized &&
              stopNameNormalized.includes(slotHintNormalized)
            ) {
              replacementIndex = index;
              break;
            }
          }
        }
        if (replacementIndex === -1 && placeholderIndexes.length === 1) {
          replacementIndex = placeholderIndexes[0];
        }
        if (replacementIndex !== -1) {
          const updatedStops = (plan.stops ?? []).map((stop, index) =>
            index === replacementIndex
              ? {
                  ...stop,
                  name: source.name ?? stop.name ?? 'New stop',
                  location: source.location ?? stop.location,
                  notes: source.description ?? undefined,
                }
              : stop
          );
          nextPlan = {
            ...plan,
            stops: updatedStops,
            metadata: {
              ...(plan.metadata ?? {}),
              lastUpdated: now,
            },
          };
          slotFillSuccess = true;
        }
      }
      if (!nextPlan) {
        const stopId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `stop_${Math.random().toString(36).slice(2, 8)}`;
        const nextStop: Stop = {
          id: stopId,
          name: source.name ?? 'New stop',
          role: 'support',
          optionality: 'required',
          location: source.location ?? undefined,
          notes: source.description ?? undefined,
        };
        nextPlan = {
          ...plan,
          stops: [...(plan.stops ?? []), nextStop],
          metadata: {
            ...(plan.metadata ?? {}),
            lastUpdated: now,
          },
        };
      }
      await Promise.resolve(upsertRecentPlan(nextPlan));
      const encoded = serializePlan(nextPlan);
      const nextIndexItem: PlanIndexItem = {
        id: planId,
        title: nextPlan.title || 'Waypoint',
        intent: nextPlan.intent,
        audience: nextPlan.audience || undefined,
        encoded,
        updatedAt: now,
        isSaved: false,
        isShared: isPlanShared(planId),
      };
      setRecentV2Plans((prev) => [
        nextIndexItem,
        ...prev.filter((entry) => entry.id !== planId),
      ]);
      const successLabel =
        slotFillSuccess && slotHint ? `Added to ${slotHint}` : 'Added to plan';
      setAddToPlanSuccess(successLabel);
      const successTimeoutMs = slotFillSuccess ? 3000 : 2000;
      addToPlanTimeoutRef.current = window.setTimeout(() => {
        setAddToPlanSuccess(null);
      }, successTimeoutMs);
      // no auto-scroll; CTA handles optional jump
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const planIdParam = searchParams.get('planId');
      if (slotFillSuccess && (slotParam || planIdParam)) {
        const gateKey = `slot-cleared:${planId}:${normalizedSlot || slotParam?.toLowerCase() || 'slot'}`;
        if (!addToPlanDedupeRef.current.has(gateKey)) {
          addToPlanDedupeRef.current.add(gateKey);
          const nextParams = new URLSearchParams(searchParams.toString());
          nextParams.delete('slot');
          nextParams.delete('planId');
          const nextQuery = nextParams.toString();
          const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname;
          router.replace(nextHref);
        }
      } else {
        router.push(
          withPreservedModeParam(`/plans/${encodeURIComponent(planId)}`, searchParams)
        );
      }
    } catch {
      setAddToPlanError("Couldn't add — try again or start a new plan.");
    } finally {
      addToPlanInFlightRef.current = false;
      setIsAddingToPlan(false);
    }
  }

  async function handleStartPlanFromItem(item: DisplayWaypoint) {
    if (addToPlanInFlightRef.current) return;
    const source = item.source === 'entity' ? item.entity : item.saved;
    scheduleAddToPlanTick();
    addToPlanInFlightRef.current = true;
    setIsAddingToPlan(true);
    setAddToPlanError(null);
    setAddToPlanSuccess(null);
    clearAddToPlanTimeout();

    try {
      const now = new Date().toISOString();
      const planId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `plan_${Math.random().toString(36).slice(2, 8)}`;
      const nextPlan = createEmptyPlan({
        title: source.name ?? 'New plan',
        intent: 'What do we want to accomplish?',
        audience: 'me-and-friends',
      });
      const stopId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `stop_${Math.random().toString(36).slice(2, 8)}`;
      const anchorStop: Stop = {
        id: stopId,
        name: source.name ?? 'Anchor stop',
        role: 'anchor',
        optionality: 'required',
        location: source.location ?? source.description,
        notes: source.description ?? undefined,
      };
      const placeholderStop: Stop = {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `stop_${Math.random().toString(36).slice(2, 8)}`,
        name: 'Next stop',
        role: 'support',
        optionality: 'required',
        notes: 'Pick from search results.',
      };
        const planWithStop: Plan = {
          ...nextPlan,
          id: planId,
          stops: [anchorStop, placeholderStop],
          metadata: {
            ...(nextPlan.metadata ?? {}),
            createdAt: now,
            lastUpdated: now,
          },
        };
        const encoded = serializePlan(planWithStop);
        const params = new URLSearchParams();
        params.set('fromEncoded', encoded);
        params.set('from', 'home_discovery_item');
        router.push(withPreservedModeParam(`/create?${params.toString()}`, searchParams));
      } catch {
        setAddToPlanError("Couldn't start a plan — try again.");
      } finally {
      addToPlanInFlightRef.current = false;
      setIsAddingToPlan(false);
    }
  }

  function handleUseWaypointTemplate(template: WaypointTemplate) {
    const params = new URLSearchParams();
    params.set('preset', template.id);
    params.set('from', 'home_template_packs');
    pushCreateWithParams(params);
  }

  function handleForkExperience(experience: VenueExperienceV2) {
    const seededTemplate = getTemplateSeedById(experience.id);
    if (seededTemplate && !validateTemplateSeed(seededTemplate).ok) {
      if (process.env.NODE_ENV === 'production') {
        return;
      }
    }
    const params = new URLSearchParams();
    params.set('seed', experience.id);
    params.set('from', 'home_experiences');
    pushCreateWithParams(params);
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-slate-950 text-slate-50 px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <header className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Inspire · Decide · Plan
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-50">
              Find something great nearby.
            </h1>
            <p className="text-sm text-slate-300">
              Explore a few ideas and turn the best one into a plan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                exploreSectionRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
              className={ctaClass('chip')}
            >
              Explore ideas
            </button>
            <Link href="/create" className={ctaClass('primary')}>
              Create a plan
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="uppercase tracking-wide text-slate-600">Browse by area</span>
            <Link href={cityDistrictsHref} className={ctaClass('chip')}>
              City districts
            </Link>
            <Link href={downtownDistrictHref} className={ctaClass('chip')}>
              Downtown district
            </Link>
          </div>
          {!userId && (
            <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-slate-50">Explore freely. Sign in when you want to save.</p>
                <p className="text-[12px] text-slate-400">
                  Keep browsing without an account, then sign in to sync plans across devices.
                </p>
              </div>
              <button
                type="button"
                onClick={handleScrollToAuth}
                className={ctaClass('primary')}
              >
                Sign in
              </button>
            </div>
          )}
          {userId ? (
            <div className="flex justify-end">
              <button type="button" onClick={handleScrollToAuth} className={ctaClass('chip')}>
                Account
              </button>
            </div>
          ) : null}
        </header>
        {migrationMessage ? (
          <div className="rounded-md border border-emerald-700/60 bg-emerald-900/40 px-3 py-2 text-[11px] text-emerald-100">
            {migrationMessage}
          </div>
        ) : null}
        {noticeMessage ? (
          <div className="rounded-md border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-200">
            <div className="flex items-center justify-between gap-3">
              <span>{noticeMessage}</span>
              <button
                type="button"
                onClick={() => setNoticeMessage(null)}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <section
          ref={exploreSectionRef}
          className="space-y-3 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-4"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-200">Venue experiences</h2>
            <p className="text-[11px] text-slate-500">
              Hand-picked loops with real places.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {VENUE_EXPERIENCES_V2.map((experience) => {
              const previewId = `experience:${experience.id}`;
              const seededTemplate = getTemplateSeedById(experience.id);
              const seedValidation = seededTemplate
                ? validateTemplateSeed(seededTemplate)
                : { ok: false, issues: ['Missing template seed'] };
              const isCuratedBlocked =
                !seedValidation.ok && process.env.NODE_ENV === 'production';
              const isCuratedDisabled =
                !seedValidation.ok && process.env.NODE_ENV !== 'production';
              if (isCuratedBlocked) {
                return null;
              }
              const previewQueries = seededTemplate
                ? buildSeededTemplatePreviewQueries(seededTemplate, coords)
                : buildExperiencePreviewQueries(experience, coords);
              const previewItems = getPreviewDisplay(previewQueries);
              const fallbackStops =
                seededTemplate?.stops.map((stop) => stop.label) ??
                (experience.seededStops && experience.seededStops.length > 0
                  ? experience.seededStops
                  : experience.defaultQuery
                  ? [experience.defaultQuery]
                  : []);
              const resolvedStopNames = seededTemplate
                ? buildResolvedStopNameMap(seededTemplate, coords)
                : undefined;
              const previewLabels = seededTemplate
                ? seededTemplate.stops.map((stop, index) =>
                    getTemplateStopDisplayLabel(
                      stop,
                      resolvedStopNames?.[stop.id] ?? previewItems[index]?.label
                    )
                  )
                : previewItems.length > 0
                ? previewItems.map((item) => item.label)
                : fallbackStops;
              return (
                <div
                  key={experience.id}
                  className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-3 space-y-2"
                  style={experience.accent ? { borderColor: experience.accent } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-400">
                      Curated experience
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">{experience.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {experience.venueName} · {experience.locationHint}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Ready to go · Real places included
                    </p>
                    <p className="text-[11px] text-slate-400 line-clamp-2">
                      {experience.description}
                    </p>
                  </div>
                  {previewLabels.length > 0 ? (
                    <p className="text-[11px] text-slate-500">
                      Includes:{' '}
                      {previewLabels.slice(0, 3).map((label, index) => (
                        <span
                          key={`${experience.id}-preview-${label}-${index}`}
                          title={previewItems[index]?.title}
                          className="text-slate-300"
                        >
                          {label}
                          {index < Math.min(previewLabels.length, 3) - 1 ? ' · ' : ''}
                        </span>
                      ))}
                      {previewLabels.length > 3 ? (
                        <span className="text-slate-500">
                          {' '}
                          · +{previewLabels.length - 3} more
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
                    {experience.locationHint ? (
                      <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                        {experience.locationHint}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                      {experience.defaultStopCount} stops
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleForkExperience(experience)}
                      disabled={isAddingToPlan || isCuratedDisabled}
                      className={`${ctaClass('primary')} text-[10px] ${
                        isAddingToPlan || isCuratedDisabled
                          ? 'opacity-60 cursor-not-allowed'
                          : ''
                      }`}
                      >
                        Use as seed
                      </button>
                    {isCuratedDisabled ? (
                      <span className="text-[10px] text-amber-300">
                        This curated plan needs baked placeIds (dev).
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPreviewId((prev) => (prev === previewId ? null : previewId))
                      }
                      className="text-[10px] text-slate-400 hover:text-slate-100 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-200"
                    >
                      Preview
                    </button>
                  </div>
                  {openPreviewId === previewId ? (
                    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 space-y-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Preview
                      </p>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {previewLabels.slice(0, 4).map((label, index) => (
                          <li key={`${experience.id}-${label}-${index}`}>• {label}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-200">Template packs</h2>
            <p className="text-[11px] text-slate-500">
              Starting points you can remix.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {WAYPOINT_TEMPLATES.map((template) => {
              const previewId = `pack:${template.id}`;
              const seededTemplate = getTemplateSeedById(template.id);
              const previewQueries = seededTemplate
                ? buildSeededTemplatePreviewQueries(seededTemplate, coords)
                : buildPackPreviewQueries(template, coords);
              const previewItems = getPreviewDisplay(previewQueries);
              const fallbackStops =
                seededTemplate?.stops.map((stop) => stop.label) ??
                template.intentQueryHints ??
                [];
              const resolvedStopNames = seededTemplate
                ? buildResolvedStopNameMap(seededTemplate, coords)
                : undefined;
              const previewLabels = seededTemplate
                ? seededTemplate.stops.map((stop, index) =>
                    getTemplateStopDisplayLabel(
                      stop,
                      resolvedStopNames?.[stop.id] ?? previewItems[index]?.label
                    )
                  )
                : previewItems.length > 0
                ? previewItems.map((item) => item.label)
                : fallbackStops;
              return (
                <div
                  key={template.id}
                  className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-400">
                      Template pack
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-lg">{template.icon ?? '📌'}</span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-100">
                        {template.name}
                      </p>
                      <p className="text-[11px] text-slate-400">{template.description}</p>
                      <p className="text-[10px] text-slate-500">
                        Starting point · You&apos;ll pick places
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {template.defaultStops} stops · starter kit
                      </p>
                    </div>
                  </div>
                  {previewLabels.length > 0 ? (
                    <p className="text-[11px] text-slate-500">
                      Includes:{' '}
                      {previewLabels.slice(0, 3).map((label, index) => (
                        <span
                          key={`${template.id}-preview-${label}-${index}`}
                          title={previewItems[index]?.title}
                          className="text-slate-300"
                        >
                          {label}
                          {index < Math.min(previewLabels.length, 3) - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleUseWaypointTemplate(template)}
                      className={`${ctaClass('primary')} text-[11px]`}
                      disabled={isAddingToPlan}
                      >
                        Start with this template
                      </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPreviewId((prev) => (prev === previewId ? null : previewId))
                      }
                      className="text-[10px] text-slate-400 hover:text-slate-100 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-200"
                    >
                      Preview
                    </button>
                  </div>
                  {openPreviewId === previewId ? (
                    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 space-y-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Preview
                      </p>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {previewLabels.slice(0, 4).map((label, index) => (
                          <li key={`${template.id}-${label}-${index}`}>• {label}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <div ref={authPanelRef}>{showAuthPanel ? <AuthPanel /> : null}</div>

        <section
          id="continue-section"
          className={`space-y-2 pt-4 mt-2 border-t border-slate-900/40 ${
            !resumePlan && moreRecentPlans.length === 0 ? 'opacity-90' : ''
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Continue
              </h2>
              <p className="text-[11px] text-slate-500">
                Your recent plans, ready to resume.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                userToggledContinueRef.current = true;
                setContinueCollapsed((prev) => !prev);
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              {continueCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          {!continueCollapsed && (
            <>
              <div className="space-y-3">
                {!hydrated ? (
                  <p className="text-xs text-slate-400">Loading your plans...</p>
                ) : userId && supabaseLoading ? (
                  <p className="text-xs text-slate-400">Loading your plans...</p>
                ) : !resumePlan ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-400 space-y-1">
                    <p className="text-slate-300">No plans yet.</p>
                    <p>Plans you make will show up here for quick return.</p>
                    <p className="text-slate-500">Start with the ideas above to create your first one.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Resume last plan
                      </p>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 truncate">
                            {resumePlan.title}
                          </p>
                          <p
                            className="text-[11px] text-slate-400"
                            title={new Date(resumePlan.updatedAt).toLocaleString()}
                          >
                            Updated{' '}
                            {new Date(resumePlan.updatedAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!resumePlan.encoded) return;
                              setActivePlanId(resumePlan.id);
                              router.push(
                                withPreservedModeParam(
                                  `/plans/${encodeURIComponent(resumePlan.id)}`,
                                  searchParams
                                )
                              );
                            }}
                            className={`${ctaClass('primary')} text-[11px]`}
                          >
                            Resume
                          </button>
                          {removeCandidateId === resumePlan.id ? (
                            <div className="flex items-center gap-2 text-[11px]">
                              <button
                                type="button"
                                onClick={() => handleRemoveRecentPlan(resumePlan.id)}
                                className="text-rose-300 hover:text-rose-100"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoveCandidateId(null)}
                                className="text-slate-400 hover:text-slate-200"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRemoveCandidateId(resumePlan.id)}
                              className="text-[11px] text-slate-400 hover:text-rose-200"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {moreRecentPlans.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">
                          More recent
                        </p>
                        <ul className="space-y-2">
                          {moreRecentPlans.map((plan) => (
                            <li
                              key={plan.id}
                              className="rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-slate-100 truncate">
                                  {plan.title}
                                </p>
                                <p
                                  className="text-[11px] text-slate-400"
                                  title={new Date(plan.updatedAt).toLocaleString()}
                                >
                                  Updated{' '}
                                  {new Date(plan.updatedAt).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!plan.encoded) return;
                                    setActivePlanId(plan.id);
                                    router.push(
                                      withPreservedModeParam(
                                        `/plans/${encodeURIComponent(plan.id)}`,
                                        searchParams
                                      )
                                    );
                                  }}
                                  className={`${ctaClass('chip')} text-[10px]`}
                                >
                                  Open
                                </button>
                                {removeCandidateId === plan.id ? (
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveRecentPlan(plan.id)}
                                      className="text-rose-300 hover:text-rose-100"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRemoveCandidateId(null)}
                                      className="text-slate-400 hover:text-slate-200"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setRemoveCandidateId(plan.id)}
                                    className="text-[10px] text-slate-400 hover:text-rose-200"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <section className="space-y-2 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-4">
          <div className="space-y-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Insights
            </h2>
            <p className="text-[11px] text-slate-500">Explore your plan patterns.</p>
          </div>
          <Link
            href="/insights/heatmap"
            className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2 flex items-start justify-between gap-3 text-left text-sm text-slate-200 hover:border-slate-700 hover:text-slate-100"
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-100">
                District heat map (v1)
              </p>
              <p className="text-[11px] text-slate-400">
                Your completed plans, grouped by place and time.
              </p>
            </div>
            <span className="text-[11px] text-slate-500">View</span>
          </Link>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-800/30 bg-slate-900/20 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Explore more places
              </h2>
              <p className="text-[11px] text-slate-500">
                Browse more places when you want to go off-menu.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowExploreMore((prev) => !prev)}
              className={`${ctaClass('chip')} text-[11px]`}
              aria-expanded={showExploreMore}
              aria-controls="explore-more-panel"
            >
              {showExploreMore ? 'Hide' : 'Browse'}
            </button>
          </div>
          {!showExploreMore ? (
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Popular picks
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {previewPlaces.map((place) => {
                  const costLabel = place.cost ? `Price: ${labelCost(place.cost)}` : null;
                  const timeLabel = place.timeLabel ? `Hours: ${place.timeLabel}` : null;
                  const hint = [place.location, costLabel || timeLabel || 'Popular nearby']
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <div
                      key={place.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-slate-100">{place.name}</p>
                      {hint ? (
                        <p className="text-[11px] text-slate-500">{hint}</p>
                      ) : null}
                    </div>
                  );
                })}
                {isLoading && previewPlaces.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-500">
                    Loading places...
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setShowExploreMore(true)}
                className={`${ctaClass('chip')} text-[11px]`}
              >
                Browse all places
              </button>
            </div>
          ) : (
            <div id="explore-more-panel" className="space-y-6">
        {showSurprisePlan ? (
          <section className="space-y-3">
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 ring-1 ring-emerald-500/10 shadow-md shadow-slate-950/40 px-4 py-4 space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-emerald-200/80 flex items-center gap-2">
                  <span className="text-[12px]">✦</span>
                  Surprise plan
                </p>
                <h3 className="text-lg font-semibold text-slate-100">
                  {surprisePlan?.title || 'Surprise plan'}
                </h3>
                <p className="text-[10px] text-slate-500">Ready to go</p>
                {surpriseWhyText ? (
                  <p className="text-[11px] text-slate-400">{surpriseWhyText}</p>
                ) : null}
              </div>
              <ul className="space-y-2">
                {surprisePlan?.stops?.map((stop, index) => {
                  const stopImageUrl = extractImageUrl(stop);
                  const hasStopImage = Boolean(stopImageUrl);
                  return (
                    <li
                      key={stop.id ?? `${index}`}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="h-12 w-12 shrink-0 rounded-md border border-slate-800 bg-slate-900/70 overflow-hidden">
                            {hasStopImage ? (
                              // eslint-disable-next-line @next/next/no-img-element -- small, dynamic image
                              <img
                                src={stopImageUrl ?? ''}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-full w-full bg-slate-800/60 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-300">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-700/70 text-[11px] text-slate-200">
                                  ◇
                                </span>
                                <span className="text-[9px] uppercase tracking-wide text-slate-500">
                                  Stop
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-100">
                              {stop.name || `Stop ${index + 1}`}
                            </p>
                            {stop.location ? (
                              <p className="text-[11px] text-slate-500">{stop.location}</p>
                            ) : null}
                            {stop.notes ? (
                              <p className="text-[11px] text-slate-400">{stop.notes}</p>
                            ) : null}
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          {stop.role}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {surpriseError ? (
                <p className="text-[11px] text-amber-200">{surpriseError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSurpriseMe()}
                  disabled={isSurpriseLoading || isSavingSurprisePlan}
                  className={`${ctaClass('chip')} ${
                    isSurpriseLoading || isSavingSurprisePlan
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                  }`}
                >
                  Show me something else
                </button>
                <button
                  type="button"
                  onClick={handleUseSurprisePlan}
                  disabled={isSavingSurprisePlan || isSurpriseLoading}
                  className={`${ctaClass('primary')} ${
                    isSavingSurprisePlan || isSurpriseLoading
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                  }`}
                >
                  {isSavingSurprisePlan ? 'Saving...' : 'Use this plan'}
                </button>
                <button
                  type="button"
                  onClick={handleEditSurprisePlan}
                  disabled={isSavingSurprisePlan || isSurpriseLoading}
                  className={`${ctaClass('chip')} ${
                    isSavingSurprisePlan || isSurpriseLoading
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                  }`}
                >
                  Tweak
                </button>
                <button
                  type="button"
                  onClick={handleClearSurprisePreview}
                  disabled={isSavingSurprisePlan || isSurpriseLoading}
                  className={`text-[11px] text-slate-400 hover:text-slate-200 ${
                    isSavingSurprisePlan || isSurpriseLoading
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                  }`}
                >
                  Dismiss
                </button>
              </div>
              {surpriseSaveError ? (
                <p className="text-[11px] text-amber-200">{surpriseSaveError}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Controls */}
        <section className="space-y-4 rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-4">
          {activePlanId ? (
            <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
              {currentPlan?.title?.trim()
                ? `Adding to “${currentPlan.title.trim()}” (${activePlanId.slice(0, 6)})`
                : `Adding to your current plan (${activePlanId.slice(0, 6)})`}
            </div>
          ) : null}
          {/* What + Search */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300" htmlFor="home-what">
              Search ideas
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                id="home-what"
                name="q"
                type="text"
                placeholder="Search ideas"
                value={whatInput}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setWhatInput(nextValue);
                  if (typeof window !== 'undefined' && nextValue.trim() === '') {
                    window.localStorage.removeItem(LAST_SEARCH_STORAGE_KEY);
                    setSlotHint(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    triggerSearch();
                  }
                }}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />

              <button
                type="button"
                onClick={triggerSearch}
                className="rounded-lg border border-sky-500/70 bg-sky-600/30 px-4 py-2 text-sm font-medium text-sky-50 hover:bg-sky-600/40"
              >
                Browse
              </button>
              <button
                type="button"
                onClick={() => handleSurpriseMe()}
                disabled={isSurpriseLoading}
                className={`rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 ${
                  isSurpriseLoading ? 'cursor-not-allowed opacity-60' : ''
                }`}
              >
                {isSurpriseLoading ? 'Surprising...' : 'Surprise me'}
              </button>
            </div>
          </div>

          {/* Where + Mood */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-300" htmlFor="home-where">
                Area
                <span className="ml-1 text-[10px] font-normal text-slate-500">
                  (optional)
                </span>
              </label>
              <input
                id="home-where"
                name="where"
                type="text"
                placeholder="City or neighborhood"
                value={whereInput}
                onChange={(e) => setWhereInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    triggerSearch();
                  }
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={requestLocation}
                className="self-start text-[11px] text-slate-400 hover:text-slate-200"
                disabled={locationStatus === 'requesting'}
              >
                {locationStatus === 'available'
                  ? 'Using your location'
                  : locationStatus === 'requesting'
                  ? 'Requesting location...'
                  : 'Use my location'}
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:w-40">
              <label className="text-xs font-medium text-slate-300" htmlFor="home-mood">
                Mood
              </label>
              <select
                id="home-mood"
                name="mood"
                value={moodFromUrl}
                onChange={(e) => {
                  updateSearchParams({ mood: e.target.value as Mood | 'all' });
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              >
                {MOOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'all'
                      ? 'All moods'
                      : option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">Optional vibe filter.</p>
            </div>
          </div>

          {slotHint && whatInput.trim() ? (
            <p className="text-[11px] text-slate-400">
              Aiming for: <span className="text-slate-200">{slotHint}</span>
            </p>
          ) : null}
          {railPlanId && (slotHint || planIdParam) ? (
            <div
              id="return-rail"
              className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"
            >
              {slotHint ? (
                <span>
                  Filling: <span className="text-slate-200">{slotHint}</span>
                </span>
              ) : null}
              <Link
                href={`/plans/${encodeURIComponent(railPlanId)}`}
                className={`${ctaClass('chip')} text-[10px]`}
              >
                Back to plan ({currentPlanShortId || railShortId})
              </Link>
            </div>
          ) : null}
          {railPlanId && (slotHint || planIdParam) && addToPlanSuccess ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-200">
              <span>Added — continue below</span>
              <button
                type="button"
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  const continueEl = document.getElementById('continue-section');
                  continueEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="text-[11px] text-emerald-100 hover:text-emerald-50"
              >
                Jump to Continue
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Quick picks
            </p>
            <div className="flex flex-wrap gap-2">
              {DISCOVERY_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set('preset', preset.id);
                    params.set('from', 'home_quick_picks');
                    pushCreateWithParams(params);
                  }}
                  className={`${ctaClass('chip')} text-[11px]`}
                  title={preset.hint}
                  aria-label={preset.hint ? `${preset.label} — ${preset.hint}` : preset.label}
                >
                  Start from {preset.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Waypoint view toggle + status + results */}
        <section className="space-y-2 mt-8">
          {addToPlanSuccess ? (
            <div className="sticky top-3 z-20 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-emerald-200">{addToPlanSuccess}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    const continueEl = document.getElementById('continue-section');
                    continueEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`${ctaClass('chip')} text-[10px]`}
                >
                  Jump to Continue
                </button>
                {currentPlanId ? (
                  <Link
                    href={`/plans/${encodeURIComponent(currentPlanId)}`}
                    className="text-[11px] text-emerald-100 hover:text-white"
                  >
                    Back to plan ({currentPlanId.slice(0, 6)})
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
          <div
            ref={resultsRef}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ideas
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              {resultsUpdatedAt ? <span>{resultsUpdatedAt}</span> : null}
              <button
                type="button"
                onClick={() => {
                  setResultsCleared(true);
                  setResultsUpdatedAt(null);
                  setLastResultsSource(null);
                  setSurpriseStarter(null);
                  setSurpriseMeta(null);
                  setSurprisePlan(null);
                  setSurpriseSaveError(null);
                  setIsSavingSurprisePlan(false);
                  setSelectedDiscoveryItem(null);
                  setAddToPlanError(null);
                  setAddToPlanSuccess(null);
                  setError(null);
                  if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(LAST_SEARCH_STORAGE_KEY);
                  }
                  setSlotHint(null);
                }}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                Clear results
              </button>
            </div>
          </div>
          {activePlanId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Current plan:</span>
                <span className="text-slate-200">{currentPlanLabel}</span>
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      withPreservedModeParam(
                        `/plans/${encodeURIComponent(activePlanId)}`,
                        searchParams
                      )
                    )
                  }
                  className="text-[11px] text-slate-300 hover:text-slate-100"
                >
                  View
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActivePlanId(null);
                }}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >
                Start fresh
              </button>
            </div>
          ) : null}
          {lastResultsSource === 'surprise' && hasResults && !showSurprisePlan ? (
            <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-400">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Surprise picks
              </p>
              <p className="text-[11px] text-slate-400">Not feeling it? Try again.</p>
            </div>
          ) : null}
          {/* View toggle + status row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/60 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setWaypointView('all')}
                className={`px-3 py-1 rounded-full ${
                  waypointView === 'all'
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-300 hover:text-slate-100'
                }`}
              >
                All ideas
              </button>
              <button
                type="button"
                onClick={() => setWaypointView('saved')}
                className={`px-3 py-1 rounded-full ${
                  waypointView === 'saved'
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-300 hover:text-slate-100'
                }`}
              >
                Saved ideas
              </button>
            </div>

            <div className="flex flex-col items-start sm:items-end text-[11px] text-slate-400 gap-0.5">
              <span>
                {isLoading
                  ? 'Loading ideas...'
                  : error
                  ? 'Error loading ideas.'
                  : waypointView === 'all'
                  ? `${visibleWaypoints.length} matching ideas`
                  : `${visibleWaypoints.length} saved ideas`}
              </span>
              <span>
                {locationStatus === 'available' && 'Using your location'}
                {locationStatus === 'requesting' && 'Requesting location'}
                {locationStatus === 'denied' && 'Location denied (using default area)'}
              </span>
            </div>
          </div>

          {error && !isLoading && (
            <div className="rounded-xl border border-red-600/60 bg-red-950/40 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {isLoading && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
              Loading ideas...
            </div>
          )}

          {!isLoading && !error && (
            <>
              {!showSurprisePlan ? (
                <ul className="space-y-3">
                  {visibleWaypoints.map((item) => {
                const id = item.source === 'entity' ? item.entity.id : item.saved.id;
                const name =
                  item.source === 'entity' ? item.entity.name : item.saved.name;
                const cost: CostTag | undefined =
                  item.source === 'entity'
                    ? item.entity.cost
                    : (item.saved.cost as CostTag | undefined);

                const proximity: ProximityTag | undefined =
                  item.source === 'entity'
                    ? item.entity.proximity
                    : (item.saved.proximity as ProximityTag | undefined);

                const useCases: UseCaseTag[] | undefined =
                  item.source === 'entity'
                    ? item.entity.useCases
                    : (item.saved.useCases as UseCaseTag[] | undefined);

                const sourceItem = item.source === 'entity' ? item.entity : item.saved;
                const locationHint = sourceItem.location;
                const timeLabel =
                  item.source === 'entity' ? item.entity.timeLabel : undefined;
                const imageUrl = extractImageUrl(sourceItem);
                const hasRealImage = Boolean(imageUrl);
                const fallbackLabel =
                  (useCases && useCases.length > 0 ? labelUseCase(useCases[0]) : null) ??
                  'Place';
                const decisionHint = cost
                  ? `Price: ${labelCost(cost)}`
                  : timeLabel
                  ? `Hours: ${timeLabel}`
                  : proximity
                  ? labelProximity(proximity)
                  : 'Popular nearby';
                const decisionLine = [locationHint, decisionHint].filter(Boolean).join(' · ');

                const isSaved = savedWaypoints.some((wp) => wp.id === id);

                const onToggleFavorite = () => {
                  if (item.source === 'entity') {
                    toggleSavedWaypointForEntity(item.entity);
                  } else {
                    toggleSavedWaypointById(id);
                  }
                };

                const isSelected = selectedDiscoveryItem
                  ? selectedDiscoveryItem.source === 'entity'
                    ? selectedDiscoveryItem.entity.id === id
                    : selectedDiscoveryItem.saved.id === id
                  : false;

                return (
                  <li
                    key={id}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900/70 overflow-hidden">
                          {hasRealImage ? (
                            // eslint-disable-next-line @next/next/no-img-element -- small, dynamic image
                            <img
                              src={imageUrl ?? undefined}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-full w-full bg-slate-800/60 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-300">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-700/70 text-[11px] text-slate-200">
                                ◇
                              </span>
                              <span className="px-1 text-center truncate max-w-[52px] text-[10px] text-slate-300">
                                {fallbackLabel}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-medium truncate">{name}</h2>
                          </div>
                          {(() => {
                            const blurbItemCandidate =
                              item.source === 'entity'
                                ? item.entity
                                : item.source === 'saved'
                                ? item.saved
                                : item;
                            const blurb = getResultBlurb(blurbItemCandidate);
                            const primary =
                              typeof blurb.primary === 'string' && blurb.primary.trim().length > 0
                                ? blurb.primary
                                : 'A place to consider for your plan.';
                            return (
                              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                                {primary}
                              </p>
                            );
                          })()}
                          {decisionLine ? (
                            <p className="text-[11px] text-slate-500">{decisionLine}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={onToggleFavorite}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                          aria-label={isSaved ? 'Remove from saved' : 'Save idea'}
                        >
                          {isSaved ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectDiscoveryItem(item)}
                        className="text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        Preview
                      </button>
                    </div>
                    {isSelected && selectedDiscoveryDetail ? (
                      <div className="pt-2 border-t border-slate-800/70 space-y-3">
                        {(() => {
                          const sourceForDetails =
                            selectedDiscoveryItem?.source === 'entity'
                              ? selectedDiscoveryItem.entity
                              : selectedDiscoveryItem?.saved;
                          const costValue =
                            selectedDiscoveryItem?.source === 'entity'
                              ? selectedDiscoveryItem.entity.cost
                              : (selectedDiscoveryItem?.saved.cost as CostTag | undefined);
                          const priceLabel = costValue ? labelCost(costValue) : null;
                          const fallbackPrimary = 'A place to consider for your plan.';
                          const blurbItemCandidate =
                            selectedDiscoveryDetail ??
                            (selectedDiscoveryItem as DisplayWaypoint | null) ??
                            sourceForDetails ??
                            item;
                          const blurb = getResultBlurb(blurbItemCandidate);
                          const primary =
                            typeof blurb.primary === 'string' && blurb.primary.trim().length > 0
                              ? blurb.primary
                              : fallbackPrimary;
                          const secondary =
                            blurb.secondary &&
                            (!priceLabel || !blurb.secondary.startsWith('Price:'))
                              ? blurb.secondary
                              : undefined;
                          return (
                            <>
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                    About this stop
                                  </p>
                                  <h3 className="text-lg font-semibold text-slate-100">
                                    {selectedDiscoveryDetail.title}
                                  </h3>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    {priceLabel ? (
                                      <span className="inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
                                        {priceLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedDiscoveryItem(null)}
                                  className="text-[11px] text-slate-400 hover:text-slate-200"
                                >
                                  Close
                                </button>
                              </div>
                              {selectedDiscoveryDetail.locationLine ? (
                                <p className="text-xs text-slate-500">
                                  {selectedDiscoveryDetail.locationLine}
                                </p>
                              ) : null}
                              <p className="text-[11px] text-slate-400">
                                {selectedDiscoveryDetail.decisionHint}
                              </p>
                              <div className="space-y-1">
                                <p className="text-sm text-slate-100">{primary}</p>
                                {secondary ? (
                                  <p className="text-xs text-slate-400 mt-1">{secondary}</p>
                                ) : null}
                              </div>
                            </>
                          );
                        })()}
                        {(() => {
                          const sourceForWebsite =
                            selectedDiscoveryItem?.source === 'entity'
                              ? selectedDiscoveryItem.entity
                              : selectedDiscoveryItem?.saved;
                          const websiteFromDetail =
                            extractWebsiteUrl(selectedDiscoveryDetail ?? null) ?? null;
                          const websiteFromItem =
                            extractWebsiteUrl(selectedDiscoveryItem) ?? null;
                          const websiteFromSource = sourceForWebsite
                            ? extractWebsiteUrl(sourceForWebsite)
                            : null;
                          const websiteCandidate =
                            websiteFromDetail ?? websiteFromItem ?? websiteFromSource ?? null;
                          const searchQuery = [
                            selectedDiscoveryDetail.title,
                            selectedDiscoveryDetail.locationLine,
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .trim();
                          const searchUrl = searchQuery
                            ? `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`
                            : null;
                          const canShowAddToCurrent =
                            Boolean(targetPlanId) && Boolean(selectedDiscoveryItem);
                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    {selectedDiscoveryDetail.mapsUrl ? (
                      <a
                        href={selectedDiscoveryDetail.mapsUrl}
                        target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300 hover:text-slate-100"
                                  >
                                    Open in Maps
                              </a>
                            ) : null}
                            {websiteCandidate ? (
                              <a
                                href={websiteCandidate}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300 hover:text-slate-100"
                              >
                                Website
                              </a>
                            ) : searchUrl ? (
                              <a
                                href={searchUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300 hover:text-slate-100"
                              >
                                Search web
                              </a>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleStartPlanFromItem(
                                  selectedDiscoveryItem as DisplayWaypoint
                                )
                              }
                              disabled={isAddingToPlan}
                              className={`${ctaClass('primary')} text-[11px] ${
                                isAddingToPlan ? 'opacity-60 cursor-not-allowed' : ''
                              }`}
                            >
                              Make this plan
                            </button>
                            {canShowAddToCurrent ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddToCurrentPlan(
                                    selectedDiscoveryItem as DisplayWaypoint,
                                    targetPlanId as string
                                  )
                                }
                                disabled={isAddingToPlan}
                                className={`${ctaClass('primary')} text-[11px] ${
                                  isAddingToPlan ? 'opacity-60 cursor-not-allowed' : ''
                                }`}
                              >
                                {slotHint && currentPlanId
                                  ? `Add to ${slotHint} (${currentPlanShortId || currentPlanId.slice(0, 6)})`
                                  : currentPlanId
                                  ? `Add to current plan${
                                      currentPlanShortId ? ` (${currentPlanShortId})` : ''
                                    }`
                                  : ''}
                              </button>
                            ) : null}
                          </div>
                        </>
                      );
                    })()}
                    {addToPlanSuccess ? (
                      <p className="text-[11px] text-emerald-200">{addToPlanSuccess}</p>
                    ) : null}
                        {addToPlanError ? (
                          <p className="text-[11px] text-amber-200">{addToPlanError}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}

                {visibleWaypoints.length === 0 && (
                  <li className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-xs text-slate-500">
                    {waypointView === 'saved'
                      ? 'No saved ideas yet.'
                      : 'No matches yet.'}
                  </li>
                )}
                </ul>
              ) : null}
            </>
          )}
        </section>
            </div>
          )}
        </section>

        {TEMPLATES_ENABLED ? (
          <section
            ref={templateSectionRef}
            className="space-y-3 pt-6 mt-6 border-t border-slate-900/60"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-200">Template library</h2>
              <button
                type="button"
                onClick={() => setShowTemplateExplorer((prev) => !prev)}
                className={`${ctaClass('chip')} text-[11px]`}
              >
                {showTemplateExplorer ? 'Hide templates' : 'Browse templates'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Remix a starter plan from the library.
            </p>
            {templateLoading ? (
              <p className="text-xs text-slate-400">Loading templates...</p>
            ) : templatePlans.length === 0 ? (
              <p className="text-xs text-slate-400">No templates yet.</p>
            ) : showTemplateExplorer ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Template packs</p>
                  <div className="flex flex-wrap gap-2">
                    {templatePacks.map((pack) => (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => handleSelectTemplatePack(pack.id)}
                        className={`rounded-full border px-3 py-1 text-[11px] ${
                          activeTemplatePackId === pack.id
                            ? 'border-slate-100 bg-slate-100 text-slate-900'
                            : 'border-slate-700 text-slate-300 hover:text-slate-100'
                        }`}
                      >
                        {pack.title || 'Untitled pack'} ({pack.count})
                      </button>
                    ))}
                  </div>
                  {activeTemplatePack ? (
                    <p className="text-[11px] text-slate-500">
                      {activeTemplatePack.description || 'Choose a template to make your own.'}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                      {activeTemplatePack ? activeTemplatePack.title : 'All templates'}
                    </p>
                    {activeTemplatePackId ? (
                      <button
                        type="button"
                        onClick={() => setActiveTemplatePackId(null)}
                        className="text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        Clear pack
                      </button>
                    ) : null}
                  </div>
                  {templatesInActivePack.length === 0 ? (
                    <p className="text-xs text-slate-500">No templates in this pack yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {templatesInActivePack.map((template) => (
                        <li
                          key={template.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="space-y-0.5 min-w-0 w-full">
                            <p
                              className="font-medium text-slate-100 truncate"
                              title={template.templateTitle || template.title || 'Untitled template'}
                            >
                              {template.templateTitle || template.title || 'Untitled template'}
                            </p>
                            <div
                              className="flex items-center gap-2 text-[11px] text-slate-400 truncate"
                              title={new Date(template.updatedAt).toLocaleString()}
                            >
                              <span>Updated {new Date(template.updatedAt).toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end w-full sm:w-auto">
                            <button
                              type="button"
                              onClick={() => handleOpenTemplatePreview(template)}
                              className="text-[10px] text-slate-400 hover:text-slate-100 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-200"
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUseTemplate(template)}
                              className={`${ctaClass('primary')} shrink-0 text-[10px]`}
                            >
                              Make this plan
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                              router.push(
                                  withPreservedModeParam(
                                    `/create?planId=${encodeURIComponent(template.id)}&editTemplate=1&returnTo=${encodeURIComponent(returnTo)}`,
                                    searchParams
                                  )
                                )
                              }
                              className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                              disabled={!userId}
                            >
                              Edit template
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Browse template packs to remix a plan.
              </p>
            )}
          </section>
        ) : null}

        {selectedTemplate ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-950 px-4 py-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Template preview</p>
                  <p className="text-[11px] text-slate-400">Read-only preview</p>
                  <h3 className="text-lg font-semibold text-slate-100">
                    {selectedTemplate.templateTitle ||
                      selectedTemplate.title ||
                      'Untitled template'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Pack: {selectedTemplate.packTitle || 'Templates'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseTemplatePreview}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-400">Stops</p>
                {selectedTemplatePlan?.stops?.length ? (
                  <ol className="space-y-2">
                    {selectedTemplatePlan.stops.map((stop) => (
                      <li key={stop.id} className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
                        <div className="text-sm text-slate-100">{stop.name}</div>
                        {stop.notes ? (
                          <div className="text-[11px] text-slate-400">{stop.notes}</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-slate-500">No stops yet.</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleUseTemplate(selectedTemplate);
                    setSelectedTemplate(null);
                  }}
                  className={`${ctaClass('primary')} text-[11px]`}
                >
                  Edit this plan
                </button>
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      withPreservedModeParam(
                        `/create?planId=${encodeURIComponent(selectedTemplate.id)}&editTemplate=1&returnTo=${encodeURIComponent(returnTo)}`,
                        searchParams
                      )
                    )
                  }
                  className={`${ctaClass('primary')} text-[11px]`}
                  disabled={!userId}
                >
                  Edit this template
                </button>
                <button
                  type="button"
                  onClick={handleCloseTemplatePreview}
                  className={`${ctaClass('chip')} text-[11px]`}
                >
                  Back to templates
                </button>
                {userId ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteTemplate(selectedTemplate)}
                    className={`${ctaClass('danger')} text-[11px]`}
                  >
                    Delete template
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

      </div>
    </main>
  );
}







