'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  PLAN_VERSION,
  type Plan,
  type ShareMode,
  type Stop as PlanStop,
} from '../plan-engine';
import type { PlanSignals } from '../plan-engine';
import {
  clearCloudPlanIdForDraft,
  getCloudPlanIdForDraft,
  setCloudPlanIdForDraft,
  setSavedById,
  upsertRecentPlan,
  updatePlanSentiment,
} from '../utils/planStorage';
import { useSession } from '../auth/SessionProvider';
import {
  buildDraftFromPlan as buildDraftFromPlanRepo,
  buildPlanFromDraft as buildPlanFromDraftRepo,
  forkPlan,
  loadPlan,
  savePlan,
  type PlanDraft as RepositoryPlanDraft,
  type PlanRepositorySource,
} from '../lib/planRepository';
import { logEvent } from '../lib/planEvents';
import { withPreservedModeParam } from '../lib/entryMode';
import { generateId } from '../plan-engine/defaults';
import { resolvePlanTemplate } from '../lib/verticals/resolvePlanTemplate';
import { buildVerticalGuidance } from '../lib/verticals/guidance/buildVerticalGuidance';
import { initVerticals } from '../lib/verticals/init';
import { listTemplateIds } from '../lib/verticals/registry/templateRegistry';
import { VerticalIdentityHeader } from '../components/VerticalIdentityHeader';
import { resolveStopTypeLabel, StopTypeBadge } from '../components/StopTypeBadge';
import { logPlanSignal } from '../lib/planSignals';
import { getRecentCompletedPlans } from '../lib/planRecall';
import { getChosenNotCompletedPlans, getMostRevisitedPlans } from '../lib/planReflection';
import { getSecondStopRecommendation } from '../lib/recommendations/structuralPatterns';
import {
  buildV52CoachSuggestions,
} from '../lib/recommendations/v52Recommendations';
import {
  getExperiencePackSummary,
  type ExperiencePackSummary,
} from '../lib/packs/experiencePackQueries';
import {
  buildExperiencePackDraft,
  buildPreviewExperiencePackDraft,
  type ExperiencePackDraft,
} from '../lib/packs/experiencePackDraft';
import {
  getSeasonalContextSummary,
  type SeasonalContextSummary,
} from '../lib/seasonality/seasonalContext';
import type { Entity } from '@/data/entities';
import { fetchEntities } from '@/lib/entitySource';
import { getTemplateV2ById, TEMPLATES_V2 } from '@/app/lib/templatesV2';
import { getDiscoveryPresetV2ById } from '@/app/lib/discoveryPresetsV2';
import { getVenueExperienceV2ById } from '@/lib/venueExperiencesV2';
import { getPlaceFallbackImage } from '@/shared/placeFallbacks';
import {
  getStopAddress,
  getStopCanonicalPlaceId,
  getStopMapHref,
  getStopMapTarget,
  getStopWebsiteHref,
  normalizeStop,
  normalizeStops,
} from '@/lib/stopLocation';
import { hydrateStopsPlaceLite } from '@/lib/hydratePlaceLite';
import { encodePlanBase64Url } from '@/lib/encodedPlan';
import { extractCity } from '../lib/geo/extractCity';
import { extractDistrict } from '../lib/geo/extractDistrict';

type Stop = {
  id: string;
  label: string;
  notes?: string;
  time?: string;
  stop_type_id?: string;
  placeRef?: {
    provider?: 'google';
    placeId?: string;
    latLng?: { lat: number; lng: number };
    mapsUrl?: string;
    websiteUrl?: string;
    query?: string;
    label?: string;
  };
  placeLite?: PlaceLite;
  resolve?: {
    q?: string;
    near?: string;
    placeholder?: boolean;
  };
};

type PlanDraft = {
  title: string;
  date: string;
  time: string;
  whenText?: string;
  district?: string;
  template_id?: string;
  attendees: string;
  notes: string;
  stops: Stop[];
  planSignals: PlanSignals;
};


type StopMeta = {
  name?: string;
  role?: 'anchor' | 'support' | 'optional';
  location?: string;
  address?: string;
  formatted_address?: string;
  vicinity?: string;
  duration?: string;
  cost?: 'Free' | '$' | '$$' | '$$$';
  proximity?: 'nearby' | 'short-drive' | 'worth-it';
  timeLabel?: string;
  category?: string;
  categoryLabel?: string;
  type?: string;
  imageUrl?: string;
  photoUrl?: string | null;
  image?: string;
  place?: {
    formatted_address?: string;
    vicinity?: string;
    geometry?: {
      location?: {
        lat?: number | (() => number);
        lng?: number | (() => number);
      };
    };
  };
  entity?: {
    address?: string;
    location?: string;
    formatted_address?: string;
  };
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  coordinates?: {
    lat?: number;
    lng?: number;
  };
  placeRef?: {
    provider?: 'google';
    placeId?: string;
    latLng?: { lat: number; lng: number };
    mapsUrl?: string;
    websiteUrl?: string;
    query?: string;
    label?: string;
  };
  placeLite?: PlaceLite;
};

type PlaceLite = {
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

type ResolveCandidate = {
  stopId: string;
  key: string;
  query: string;
  city?: string;
};

const PLACE_DETAILS_CACHE = new Map<string, PlaceLite>();
const PLACE_DETAILS_INFLIGHT = new Map<string, Promise<void>>();
const PLACE_DETAILS_CACHE_LIMIT = 200;
const PLACE_DETAILS_MAX_CONCURRENCY = 4;
const PLACE_RESOLVE_CACHE = new Map<string, string | null>();
const PLACE_RESOLVE_INFLIGHT = new Map<string, Promise<void>>();
const PLACE_RESOLVE_CACHE_LIMIT = 200;
const PLACE_RESOLVE_MAX_CONCURRENCY = 2;

function labelCost(cost: StopMeta['cost']): string {
  if (cost === 'Free') return 'Free';
  if (cost === '$') return '$';
  if (cost === '$$') return '$$';
  if (cost === '$$$') return '$$$';
  return String(cost ?? '');
}

function labelProximity(p: StopMeta['proximity']): string {
  if (p === 'nearby') return 'Close by';
  if (p === 'short-drive') return 'Short drive';
  return p ? 'Worth the trip' : '';
}

const PLACEHOLDER_NOTE = 'Pick from search results.';

function isPlaceholderStop(stop: Stop): boolean {
  return stop.notes === PLACEHOLDER_NOTE;
}

type StopLocationCandidate = Stop &
  Partial<StopMeta> & {
    place?: {
      formatted_address?: string;
      vicinity?: string;
      geometry?: {
        location?: {
          lat?: number | (() => number);
          lng?: number | (() => number);
        };
      };
    };
    entity?: {
      address?: string;
      location?: string;
      formatted_address?: string;
    };
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    coordinates?: {
      lat?: number;
      lng?: number;
    };
  };

function getStopLocationLine(stop: StopLocationCandidate): string | null {
  const candidates = [
    stop.location,
    stop.address,
    stop.formatted_address,
    stop.place?.formatted_address,
    stop.place?.vicinity,
    stop.entity?.formatted_address,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function getStopStatus(stop: Stop): 'placeholder' | 'filled' {
  return isPlaceholderStop(stop) ? 'placeholder' : 'filled';
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[().,:;\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function formatTypeLabel(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function summarizeTypes(types?: string[] | null): string | null {
  if (!types || types.length === 0) return null;
  const cleaned = types
    .map((type) => formatTypeLabel(type))
    .filter((value): value is string => Boolean(value));
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 3).join(' · ');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'function') {
    try {
      const result = value();
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRating(obj: unknown): { rating?: number; count?: number } {
  if (!obj || typeof obj !== 'object') return {};
  const record = obj as Record<string, unknown>;
  const rating = readNumber(record.rating) ?? undefined;
  const count =
    readNumber(record.ratingCount) ??
    readNumber(record.user_ratings_total) ??
    readNumber(record.userRatingsTotal) ??
    undefined;
  return { rating, count };
}

function normalizePrice(obj: unknown): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const numeric =
    readNumber(record.price_level) ??
    readNumber(record.priceLevel) ??
    (typeof record.cost === 'number' ? record.cost : null);
  if (typeof numeric === 'number') {
    return Math.max(0, Math.min(4, Math.round(numeric)));
  }
  const costString = readString(record.cost) ?? readString(record.price);
  if (costString) {
    if (costString.toLowerCase() === 'free') return 0;
    if (costString.startsWith('$')) {
      return Math.max(1, Math.min(4, costString.length));
    }
  }
  return null;
}

function priceToDollars(n: number): string {
  const clamped = Math.max(1, Math.min(4, Math.round(n)));
  return '$'.repeat(clamped);
}

function normalizeOpenNow(obj: unknown): boolean | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  if (typeof record.open_now === 'boolean') return record.open_now;
  if (typeof record.openNow === 'boolean') return record.openNow;
  return null;
}

function getBestAddress(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  return (
    readString(record.vicinity) ||
    readString(record.formatted_address) ||
    readString(record.address) ||
    readString(record.locationLine) ||
    readString(record.location) ||
    null
  );
}

function getPlaceId(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const placeRef = record.placeRef as { placeId?: unknown } | undefined;
  return (
    readString(record.place_id) ||
    readString(record.placeId) ||
    readString(record.googlePlaceId) ||
    readString(placeRef?.placeId) ||
    null
  );
}

function getLatLng(obj: unknown): { lat: number; lng: number } | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const lat =
    readNumber(record.lat) ??
    readNumber(record.latitude) ??
    readNumber((record.coordinates as { lat?: unknown } | undefined)?.lat) ??
    readNumber(
      (record.place as { geometry?: { location?: { lat?: unknown } } } | undefined)
        ?.geometry?.location?.lat
    );
  const lng =
    readNumber(record.lng) ??
    readNumber(record.longitude) ??
    readNumber((record.coordinates as { lng?: unknown } | undefined)?.lng) ??
    readNumber(
      (record.place as { geometry?: { location?: { lng?: unknown } } } | undefined)
        ?.geometry?.location?.lng
    );
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }
  return null;
}

function getWebsite(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const candidate =
    readString(record.website) ||
    readString(record.websiteUrl) ||
    readString(record.url) ||
    null;
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) return null;
  return candidate;
}

function buildMapsUrl(input: {
  placeId: string | null;
  latlng: { lat: number; lng: number } | null;
  fallbackQuery: string | null;
}): string | null {
  if (input.placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(input.placeId)}`;
  }
  if (input.latlng) {
    return `https://www.google.com/maps/search/?api=1&query=${input.latlng.lat},${input.latlng.lng}`;
  }
  if (input.fallbackQuery && input.fallbackQuery.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      input.fallbackQuery.trim()
    )}`;
  }
  return null;
}

function getPlaceQuery(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const placeRef = record.placeRef as { query?: unknown } | undefined;
  return readString(placeRef?.query) || null;
}

function getResolveMeta(obj: unknown): { q?: string | null; near?: string | null; placeholder?: boolean } {
  if (!obj || typeof obj !== 'object') return {};
  const record = obj as Record<string, unknown>;
  const resolve = record.resolve as
    | { q?: unknown; near?: unknown; placeholder?: unknown }
    | undefined;
  return {
    q: readString(resolve?.q) ?? null,
    near: readString(resolve?.near) ?? null,
    placeholder: typeof resolve?.placeholder === 'boolean' ? resolve.placeholder : undefined,
  };
}

function isGenericQuery(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const banned = new Set(['food', 'drinks', 'coffee', 'park', 'museum', 'street food']);
  return banned.has(normalized);
}

async function fetchPlaceDetails(placeId: string): Promise<PlaceLite | null> {
  try {
    const params = new URLSearchParams({ placeId });
    const res = await fetch(`/api/places/details?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { place?: PlaceLite | null };
    if (!data?.place) return null;
    return data.place;
  } catch {
    return null;
  }
}

async function fetchPlaceResolve(query: string, city?: string | null): Promise<PlaceLite | null> {
  try {
    const params = new URLSearchParams({ q: query });
    if (city) params.set('city', city);
    const res = await fetch(`/api/places/resolve?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { place?: PlaceLite | null };
    if (!data?.place) return null;
    return data.place;
  } catch {
    return null;
  }
}

function hasAnyPlacesSignal(obj: unknown): boolean {
  const address = getBestAddress(obj);
  const placeId = getPlaceId(obj);
  const latlng = getLatLng(obj);
  const website = getWebsite(obj);
  const rating = normalizeRating(obj);
  const price = normalizePrice(obj);
  const openNow = normalizeOpenNow(obj);
  return Boolean(
    address ||
      placeId ||
      latlng ||
      website ||
      rating.rating ||
      rating.count ||
      price !== null ||
      openNow !== null
  );
}

function renderPlacesCapsule(input: {
  sourceObj: unknown;
  fallbackQuery: string | null;
}) {
  const { sourceObj, fallbackQuery } = input;
  if (!hasAnyPlacesSignal(sourceObj)) return null;
  const rating = normalizeRating(sourceObj);
  const price = normalizePrice(sourceObj);
  const openNow = normalizeOpenNow(sourceObj);
  const address = getBestAddress(sourceObj);
  const placeId = getPlaceId(sourceObj);
  const latlng = getLatLng(sourceObj);
  const website = getWebsite(sourceObj);
  const mapsUrl = buildMapsUrl({ placeId, latlng, fallbackQuery });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[9px] uppercase tracking-wide text-slate-300">
          Google Places
        </span>
        {rating.rating !== undefined ? (
          <span>
            * {rating.rating.toFixed(1)}
            {rating.count ? ` (${rating.count.toLocaleString()})` : ''}
          </span>
        ) : null}
        {price !== null ? (
          <span>{price === 0 ? 'Free' : priceToDollars(price)}</span>
        ) : null}
        {openNow === null ? null : <span>{openNow ? 'Open now' : 'Closed'}</span>}
        {address ? (
          <span className="truncate max-w-60" title={address}>
            {address}
          </span>
        ) : null}
      </div>
      {mapsUrl || website ? (
        <div className="flex items-center gap-2">
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-teal-200 hover:text-teal-100"
            >
              Map
            </a>
          ) : null}
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="text-teal-200 hover:text-teal-100"
            >
              Website
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Helper to create a new stop with a unique-ish id
function createStop(label: string = 'Main stop', stopTypeId?: string): Stop {
  return {
    id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    label,
    notes: '',
    time: '',
    stop_type_id: stopTypeId,
  };
}

function generateShareToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `share_${Math.random().toString(36).slice(2, 12)}`;
}

function buildSharePlanFromDraft(draft: PlanDraft, planId: string, sourcePlan?: Plan | null): Plan {
  const sourceStopsById = new Map<string, PlanStop>();
  sourcePlan?.stops?.forEach((stop) => {
    if (stop.id) sourceStopsById.set(stop.id, stop);
  });
  const stops: PlanStop[] = draft.stops.map((stop, index) => {
    const existing = sourceStopsById.get(stop.id);
    const baseStop: PlanStop = {
      id: stop.id || `${planId}-stop-${index + 1}`,
      name: stop.label || `Stop ${index + 1}`,
      role: existing?.role ?? (index === 0 ? 'anchor' : 'support'),
      optionality: existing?.optionality ?? 'required',
      notes: stop.notes || undefined,
      duration: stop.time || undefined,
      stop_type_id: stop.stop_type_id ?? existing?.stop_type_id,
      placeRef: stop.placeRef ?? (existing?.placeRef ? { ...existing.placeRef } : undefined),
      placeLite: stop.placeLite ?? (existing?.placeLite ? { ...existing.placeLite } : undefined),
      resolve: stop.resolve ?? existing?.resolve,
    };
    return normalizeStop(baseStop).stop;
  });

  const defaultShareModes: ShareMode[] = ['link', 'qr', 'embed'];
  const basePresentation = sourcePlan?.presentation
    ? {
        ...sourcePlan.presentation,
        shareModes: sourcePlan.presentation.shareModes ?? defaultShareModes,
      }
    : { shareModes: defaultShareModes };

  return {
    id: planId,
    version: PLAN_VERSION,
    title: draft.title || 'Untitled plan',
    intent: draft.notes || '',
    audience: draft.attendees || '',
    stops,
    origin: sourcePlan?.origin ?? sourcePlan?.meta?.origin,
    brand: sourcePlan?.brand ? { ...sourcePlan.brand } : undefined,
    presentation: basePresentation,
    createdFrom: sourcePlan?.createdFrom,
    templateMeta: sourcePlan?.templateMeta,
  };
}

const DEFAULT_PLAN_SIGNALS: PlanSignals = {
  chosen: false,
  chosenAt: null,
  completed: false,
  completedAt: null,
  skipped: false,
  skippedAt: null,
  revisitedCount: 0,
  revisitedAt: [],
  sentiment: null,
  sentimentAt: undefined,
  feedbackNotes: null,
};
const ACTIVE_PLAN_STORAGE_KEY = 'waypoint.activePlanId';
const PLANS_INDEX_STORAGE_KEY = 'waypoint.v2.plansIndex';
const RECENT_PLANS_PULSE_KEY = 'waypoint.recentPlansPulse';
const RECENT_PLANS_PULSE_EVENT = 'waypoint:recentPlansPulse';
const EMPTY_STOPS: Stop[] = [];

function coalesceAnchor(prev: string | undefined, next: string | undefined): string {
  const p = (prev ?? '').trim();
  const n = (next ?? '').trim();
  return p.length ? prev ?? '' : n.length ? next ?? '' : '';
}

function getHourBinFromTimeInput(timeRaw?: string | null): string | null {
  const value = (timeRaw ?? '').trim();
  if (!value) return null;
  const hourRaw = value.split(':')[0];
  const hour = Number.parseInt(hourRaw ?? '', 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (hour < 6) return '0-6';
  if (hour < 9) return '6-9';
  if (hour < 12) return '9-12';
  if (hour < 15) return '12-15';
  if (hour < 18) return '15-18';
  if (hour < 21) return '18-21';
  return '21-24';
}

function getDayOfWeekFromDateInput(dateRaw?: string | null): number | null {
  const value = (dateRaw ?? '').trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed.getDay();
}

function getSeasonLabelFromMonth(monthIndex: number): 'Winter' | 'Spring' | 'Summer' | 'Fall' {
  if (monthIndex === 11 || monthIndex <= 1) return 'Winter';
  if (monthIndex >= 2 && monthIndex <= 4) return 'Spring';
  if (monthIndex >= 5 && monthIndex <= 7) return 'Summer';
  return 'Fall';
}

function formatSnapshotDate(dateRaw?: string | null): string | null {
  const value = (dateRaw ?? '').trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatSnapshotTime(timeRaw?: string | null): string | null {
  const value = (timeRaw ?? '').trim();
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const parsed = new Date(1970, 0, 1, hour, minute);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizePlanSignals(input?: PlanSignals | null): PlanSignals {
  return {
    ...DEFAULT_PLAN_SIGNALS,
    ...(input ?? {}),
  };
}

function buildDraftFromPlan(
  plan: Plan,
  fallbackStopLabel: string,
  defaultStopTypeId?: string
): PlanDraft {
  const draft = buildDraftFromPlanRepo(plan, fallbackStopLabel, defaultStopTypeId);
  return {
    ...draft,
    template_id: plan.template_id ?? undefined,
    date: draft.date ?? '',
    time: draft.time ?? '',
    whenText: draft.whenText ?? '',
    district: draft.district ?? '',
    planSignals: normalizePlanSignals(draft.planSignals),
  };
}

function buildPlanFromDraft(
  draft: PlanDraft,
  base: Plan | null,
  planId: string
): Plan {
  const nextPlan = buildPlanFromDraftRepo(draft as RepositoryPlanDraft, base, planId);
  const rawTemplateId = (draft.template_id ?? '').trim();
  const templateId = rawTemplateId && rawTemplateId !== 'generic' ? rawTemplateId : undefined;
  return {
    ...nextPlan,
    template_id: templateId,
  };
}

type PlanPageProps = {
  planId?: string | null;
  mode?: 'new' | 'existing';
};

export default function PlanPage(props: PlanPageProps = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const routeParams = useParams<{ planId?: string }>();
  const { user } = useSession();
  const userId = user?.id ?? null;

  const routePlanId =
    props.planId ??
    (typeof routeParams?.planId === 'string' ? routeParams.planId : null);
  const workspaceMode = props.mode ?? (routePlanId ? 'existing' : 'new');
  const shouldAutoMigrateLocalDraft = workspaceMode !== 'new';
  const urlPlanId =
    workspaceMode === 'new' ? null : params.get('planId') ?? routePlanId;
  const waypointName = params.get('name') ?? '';

  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [planSource, setPlanSource] = useState<Plan | null>(null);
  const [planSourceType, setPlanSourceType] = useState<PlanRepositorySource | null>(null);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);
  const draftMigrationRef = useRef<{
    draftId: string | null;
    status: 'idle' | 'checking' | 'migrating' | 'done';
  }>({ draftId: null, status: 'idle' });
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [storedActivePlanId, setStoredActivePlanId] = useState<string | null>(null);
  const SHARE_ENABLED = false;
  const loggedRouteRef = useRef(false);
  const loggedPlanRef = useRef<string | null>(null);
  const loggedOriginPlanRef = useRef<string | null>(null);
  const loggedViewRef = useRef<string | null>(null);
  const revisitedRef = useRef<string | null>(null);
  const loggedAnchorHydrationRef = useRef(false);
  const normalizedPlanIdsRef = useRef<Set<string>>(new Set());
  const isSavedPlanRoute = Boolean(routePlanId);
  const activePlanId = planSource?.id ?? planId ?? routePlanId ?? null;
  const isActivePlan = !!activePlanId && storedActivePlanId === activePlanId;
  const planOwnerId = planSource?.owner?.id ?? planSource?.ownerId ?? null;
  const editPolicy = planSource?.editPolicy ?? 'owner_only';
  const isOwner = !!userId && !!planOwnerId && planOwnerId === userId;
  const canEdit = !planSource
    ? true
    : editPolicy === 'owner_only'
      ? isOwner || !planOwnerId
      : isOwner;
  const isReadOnly = !canEdit;
  const isDraftMode = !userId && planSourceType === 'local';
  const signInHref = useMemo(() => {
    const returnTo =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}${window.location.hash ?? ''}`
        : activePlanId
          ? `/plans/${activePlanId}`
          : '/';
    const nextParams = new URLSearchParams();
    nextParams.set('auth', '1');
    if (returnTo) nextParams.set('returnTo', returnTo);
    return withPreservedModeParam(`/?${nextParams.toString()}`, params);
  }, [activePlanId, params]);

  const stopMetaById = useMemo(() => {
    const map = new Map<string, StopMeta>();
    planSource?.stops?.forEach((stop) => {
      if (stop?.id) {
        map.set(stop.id, stop as StopMeta);
      }
    });
    return map;
  }, [planSource]);

  // Validation state
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const stops = plan?.stops ?? EMPTY_STOPS;
  const placeholderStops = useMemo(() => stops.filter(isPlaceholderStop), [stops]);
  const stopCount = stops.length;
  const mapPreviewStops = useMemo(() => {
    return stops
      .map((stop, index) => {
        if (getStopStatus(stop) === 'placeholder') return null;
        const meta = stopMetaById.get(stop.id) as StopMeta | undefined;
        const locationLine = getStopLocationLine({ ...stop, ...meta });
        if (!locationLine) return null;
        return {
          id: stop.id,
          title: stop.label || meta?.name || `Stop ${index + 1}`,
          locationLine,
        };
      })
      .filter((stop): stop is { id: string; title: string; locationLine: string } => !!stop);
  }, [stops, stopMetaById]);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreResults, setExploreResults] = useState<Entity[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const exploreSectionRef = useRef<HTMLDivElement | null>(null);
  const [fillStopId, setFillStopId] = useState<string | null>(null);
  const [fillStopIndex, setFillStopIndex] = useState<number | null>(null);
  const [fillLabel, setFillLabel] = useState<string | null>(null);
  const [exploreSuccessMessage, setExploreSuccessMessage] = useState<string | null>(null);
  const [exploreCollapsed, setExploreCollapsed] = useState(false);
  const [openDetailsStopId, setOpenDetailsStopId] = useState<string | null>(null);
  const [loadingPlaceIds, setLoadingPlaceIds] = useState<Set<string>>(() => new Set());
  const resolvedPlaceIdsRef = useRef<Map<string, string>>(new Map());
  const resolvedStopKeysRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const resolveQueueRef = useRef<ResolveCandidate[]>([]);
  const resolveQueuedKeysRef = useRef<Set<string>>(new Set());
  const resolvePumpActiveRef = useRef(false);
  const resolveActiveRef = useRef(0);
  const detailsQueueRef = useRef<string[]>([]);
  const detailsQueuedRef = useRef<Set<string>>(new Set());
  const detailsInFlightRef = useRef<Set<string>>(new Set());
  const detailsCompletedRef = useRef<Set<string>>(new Set());
  const [recentActivity, setRecentActivity] = useState<
    { planId: string; title: string | null; completedAt: string; sentiment: string | null }[]
  >([]);
  const [hasLoadedRecentActivity, setHasLoadedRecentActivity] = useState(false);
  const [chosenNotCompleted, setChosenNotCompleted] = useState<
    { planId: string; title: string | null; chosenAt: string; sentiment: string | null }[]
  >([]);
  const [mostRevisited, setMostRevisited] = useState<
    { planId: string; title: string | null; viewCount: number; lastViewedAt: string }[]
  >([]);
  const [hasLoadedReflection, setHasLoadedReflection] = useState(false);
  const [secondStopRecommendation, setSecondStopRecommendation] = useState<{
    shouldRecommend: boolean;
    explanation: string;
  } | null>(null);
  const [experiencePackSummary, setExperiencePackSummary] = useState<ExperiencePackSummary | null>(
    null
  );
  const [hasLoadedExperiencePack, setHasLoadedExperiencePack] = useState(false);
  const [experiencePackPreviewReason, setExperiencePackPreviewReason] = useState<
    'no_city' | 'below_threshold' | 'no_data'
  >('no_data');
  const [seasonalContextSummary, setSeasonalContextSummary] = useState<SeasonalContextSummary | null>(
    null
  );
  const [hasLoadedSeasonalContext, setHasLoadedSeasonalContext] = useState(false);
  const [isPackDraftDismissed, setIsPackDraftDismissed] = useState(false);
  const [recentlyAddedStopIds, setRecentlyAddedStopIds] = useState<string[]>([]);
  const [justAppliedPack, setJustAppliedPack] = useState(false);
  const [isApplyingPack, setIsApplyingPack] = useState(false);
  const [packCoachNudge, setPackCoachNudge] = useState<string | null>(null);
  const [secondStopDismissed, setSecondStopDismissed] = useState(false);
  const [selectedStarterPackId, setSelectedStarterPackId] = useState('');
  const [dismissedCoachSuggestionIds, setDismissedCoachSuggestionIds] = useState<string[]>([]);
  const detailsPumpActiveRef = useRef(false);
  const detailsActiveRef = useRef(0);
  const [resolvedPlaceIdsVersion, setResolvedPlaceIdsVersion] = useState(0);
  const stopsSig = useMemo(() => {
    if (!plan?.stops) return '';
    return plan.stops
      .map((stop) => {
        const placeId = stop.placeRef?.placeId ?? '';
        const resolveQ = stop.resolve?.q ?? '';
        return `${stop.id}:${placeId}:${resolveQ}`;
      })
      .join('|');
  }, [plan?.stops]);
  const selectedTemplateId = (plan?.template_id ?? planSource?.template_id ?? '').trim();
  const verticalTemplate = useMemo(
    () =>
      selectedTemplateId
        ? resolvePlanTemplate({ template_id: selectedTemplateId })
        : undefined,
    [selectedTemplateId]
  );
  const toolkitOptions = useMemo(() => {
    initVerticals();
    const preferredOrder = [
      'idea-date',
      'restaurants-hospitality',
      'events-festivals',
      'tourism-dmo',
      'community-org',
    ];
    const registeredIds = listTemplateIds();
    const orderedIds = [
      ...preferredOrder.filter((id) => registeredIds.includes(id)),
      ...registeredIds.filter((id) => !preferredOrder.includes(id)),
    ];
    return orderedIds.map((id) => ({
      id,
      label: resolvePlanTemplate({ template_id: id })?.name ?? id,
    }));
  }, []);
  const toolkitSelectValue = selectedTemplateId || 'generic';
  const supportsStarterPacks = toolkitSelectValue === 'idea-date';
  const shouldShowStarterPackStep = toolkitSelectValue !== 'generic' && supportsStarterPacks;
  const starterPackOptions = supportsStarterPacks ? TEMPLATES_V2 : [];
  const defaultStopTypeId = useMemo(
    () =>
      verticalTemplate?.editorGuidance?.suggestedOrder?.[0] ??
      verticalTemplate?.stopTypes?.[0]?.id,
    [verticalTemplate]
  );
  const planOriginSource = useMemo(() => {
    const origin = planSource?.origin ?? planSource?.meta?.origin;
    const candidate = origin?.source ?? origin?.kind ?? 'unknown';
    if (
      candidate === 'curated' ||
      candidate === 'template' ||
      candidate === 'search' ||
      candidate === 'surprise' ||
      candidate === 'unknown'
    ) {
      return candidate;
    }
    return 'unknown';
  }, [planSource]);
  const debugEnabled = params.get('debug') === '1';
  const verticalDebugEnabled = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
  const placeIdsToHydrate = useMemo(() => {
    if (!plan?.stops) return [];
    return Array.from(
      new Set(
        plan.stops
          .map((stop) => getStopCanonicalPlaceId(stop))
          .filter((pid): pid is string => Boolean(pid))
          .filter((pid) => {
            const st = plan.stops.find(
              (s) => getStopCanonicalPlaceId(s) === pid
            );
            if (!st) return false;
            const lite = st.placeLite;
            if (!lite) return true;
            const hasPhoto = Boolean(lite.photoUrl);
            const hasAddress = Boolean(lite.formattedAddress);
            const hasRating = typeof lite.rating === 'number';
            return !(hasPhoto && hasAddress && hasRating);
          })
      )
    );
  }, [plan?.stops]);
  const hydrateKey = placeIdsToHydrate.join('|');
  const isSeedHelperEnabled =
    process.env.NODE_ENV !== 'production' || params.get('debug') === '1';
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const exploreSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packAppliedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packScrollRafRef = useRef<number | null>(null);
  const debugPlan = useMemo(() => {
    if (!debugEnabled || !plan) return null;
    const activeId = planSource?.id ?? planId ?? routePlanId ?? 'debug';
    return buildPlanFromDraft(plan, planSource, activeId);
  }, [debugEnabled, plan, planId, planSource, routePlanId]);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (packAppliedTimeoutRef.current) {
        clearTimeout(packAppliedTimeoutRef.current);
        packAppliedTimeoutRef.current = null;
      }
      if (packHighlightTimeoutRef.current) {
        clearTimeout(packHighlightTimeoutRef.current);
        packHighlightTimeoutRef.current = null;
      }
      if (packScrollRafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(packScrollRafRef.current);
        packScrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRecentActivity() {
      const { data } = await getRecentCompletedPlans();
      if (cancelled) return;
      if (!data || data.length === 0) {
        setRecentActivity([]);
        setHasLoadedRecentActivity(true);
        return;
      }
      setRecentActivity(
        data.map((row) => ({
          planId: row.plan_id,
          title: row.title ?? null,
          completedAt: row.completed_at,
          sentiment: row.sentiment ?? null,
        }))
      );
      setHasLoadedRecentActivity(true);
    }
    void loadRecentActivity();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadReflection() {
      const [chosenResponse, revisitedResponse] = await Promise.all([
        getChosenNotCompletedPlans(),
        getMostRevisitedPlans(),
      ]);
      if (cancelled) return;
      setChosenNotCompleted(
        (chosenResponse.data ?? []).map((row) => ({
          planId: row.plan_id,
          title: row.title ?? null,
          chosenAt: row.chosen_at,
          sentiment: row.sentiment ?? null,
        }))
      );
      setMostRevisited(
        (revisitedResponse.data ?? []).map((row) => ({
          planId: row.plan_id,
          title: row.title ?? null,
          viewCount: row.view_count,
          lastViewedAt: row.last_viewed_at,
        }))
      );
      setHasLoadedReflection(true);
    }
    void loadReflection();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges || typeof window === 'undefined') return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const placeLiteHydratingRef = useRef(false);

  useEffect(() => {
    if (!verticalDebugEnabled) return;
    if (!plan) return;
    if (planSourceType === 'cloud' && (planSource?.stops?.length ?? 0) > 0) return;
    const logPlanId = planSource?.id ?? planId ?? routePlanId ?? 'unknown';
    if (verticalDebugEnabled && debugEnabled) {
      console.info('[PlanPage] hydrate candidates', logPlanId, placeIdsToHydrate);
    }
    if (placeIdsToHydrate.length === 0) return;
    if (placeLiteHydratingRef.current) return;
    placeLiteHydratingRef.current = true;
    let cancelled = false;
    (async () => {
      const hydratedStops = await hydrateStopsPlaceLite(plan.stops, {
        debug: debugEnabled,
        forcePlaceIds: placeIdsToHydrate,
        maxConcurrency: 4,
      });
      if (cancelled || hydratedStops === plan.stops) return;
      setPlan((prev) => (prev ? { ...prev, stops: hydratedStops } : prev));
      const activePlanId = planSource?.id ?? planId ?? routePlanId;
      if (!activePlanId) return;
      const nextDraft = { ...plan, stops: hydratedStops };
      const nextPlan = buildPlanFromDraft(nextDraft, planSource, activePlanId);
      const nextPlanWithMeta: Plan = {
        ...nextPlan,
        stops: nextPlan.stops.map((stop) => {
          const meta = stopMetaById.get(stop.id);
          return meta ? ({ ...stop, ...meta } as PlanStop) : stop;
        }),
      };
      setPlanSource(nextPlanWithMeta);
      upsertRecentPlan(nextPlanWithMeta);
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(PLANS_INDEX_STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : null;
          if (Array.isArray(parsed)) {
            const idx = parsed.findIndex(
              (item: { id?: string }) => item?.id === nextPlanWithMeta.id
            );
            if (idx >= 0) {
              parsed[idx] = {
                ...parsed[idx],
                encoded: encodePlanBase64Url(nextPlanWithMeta),
                updatedAt: new Date().toISOString(),
              };
              window.localStorage.setItem(
                PLANS_INDEX_STORAGE_KEY,
                JSON.stringify(parsed)
              );
            }
          }
        } catch {
          // ignore storage failures
        }
      }
    })().finally(() => {
      placeLiteHydratingRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [
    debugEnabled,
    hydrateKey,
    plan,
    planId,
    planSource,
    planSourceType,
    routePlanId,
    stopMetaById,
    placeIdsToHydrate,
    verticalDebugEnabled,
  ]);

  async function runExploreSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      setExploreResults([]);
      setExploreError(null);
      return;
    }
    setExploreLoading(true);
    setExploreError(null);
    try {
      const results = await fetchEntities({ query: trimmed });
      setExploreResults(results);
    } catch {
      setExploreError('Failed to search right now.');
    } finally {
      setExploreLoading(false);
    }
  }

  // 🔄 Initialize from:
  // - existing plan (edit flow, via ?planId=...)
  // - or new plan with waypoint name as title
  useEffect(() => {
    if (initialized) return;
    let cancelled = false;

    const run = async () => {
      if (urlPlanId) {
        const result = await loadPlan(urlPlanId, { userId });
        if (cancelled) return;
        if (result.ok) {
          const savedPlan = result.plan;
          const normalizedStops = normalizeStops(savedPlan.stops ?? []);
          const normalizedPlan =
            normalizedStops === savedPlan.stops
              ? savedPlan
              : { ...savedPlan, stops: normalizedStops };
          const normalizedStopsJson = JSON.stringify(normalizedStops ?? []);
          const savedStopsJson = JSON.stringify(savedPlan.stops ?? []);
          const didNormalize = normalizedStopsJson !== savedStopsJson;
          if (didNormalize && !normalizedPlanIdsRef.current.has(savedPlan.id)) {
            normalizedPlanIdsRef.current.add(savedPlan.id);
            upsertRecentPlan(normalizedPlan);
          }
          setPlanId(normalizedPlan.id);
          setPlanSource(normalizedPlan);
          setPlanSourceType(result.source);
          const draft = buildDraftFromPlan(
            normalizedPlan,
            waypointName || 'Main stop',
            defaultStopTypeId
          );
          if (
            verticalDebugEnabled &&
            process.env.NODE_ENV !== 'production' &&
            !loggedAnchorHydrationRef.current
          ) {
            loggedAnchorHydrationRef.current = true;
            const loaded = normalizedPlan as Plan & {
              date?: string;
              time?: string;
              whenText?: string;
            };
            console.log('[plan] loaded anchors', {
              date: loaded.date,
              time: loaded.time,
              whenText: loaded.whenText,
            });
            console.log('[plan] draft anchors', {
              date: draft.date,
              time: draft.time,
              whenText: draft.whenText,
            });
          }
          setPlan({
            ...draft,
            date: draft.date ?? '',
            time: draft.time ?? '',
            whenText: draft.whenText ?? '',
          });
          setInitialized(true);
          return;
        }

        if (routePlanId) {
          setNotFound(true);
          setPlanSourceType(null);
          setInitialized(true);
          return;
        }
      }

      // New plan case
      const localDraftId = generateId();
      setPlanId(localDraftId);
      setPlan((prev) => ({
        title: waypointName || '',
        date: coalesceAnchor(prev?.date, ''),
        time: coalesceAnchor(prev?.time, ''),
        whenText: coalesceAnchor(prev?.whenText, ''),
        template_id: prev?.template_id?.trim() || undefined,
        attendees: '',
        notes: '',
        planSignals: normalizePlanSignals(),
        // Auto-fill Stop #1 label with selected entity name (or fallback)
        stops: [createStop(waypointName || 'Main stop')],
      }));
      setPlanSourceType('local');
      setInitialized(true);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [initialized, routePlanId, urlPlanId, userId, waypointName, defaultStopTypeId, verticalDebugEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
    setStoredActivePlanId(stored && stored.trim() ? stored : null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!activePlanId) return;
    window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, activePlanId);
    setStoredActivePlanId(activePlanId);
  }, [activePlanId]);

  useEffect(() => {
    if (!verticalDebugEnabled) return;
    if (loggedRouteRef.current) return;
    loggedRouteRef.current = true;
    console.log('[origin2] plan route mounted', {
      pathname: typeof window !== 'undefined' ? window.location.pathname : '/plan',
      searchParams: params.toString(),
      planId: urlPlanId ?? null,
    });
  }, [params, urlPlanId, verticalDebugEnabled]);

  useEffect(() => {
    if (!verticalDebugEnabled) return;
    if (!plan) return;
    const logKey = planId ?? 'new';
    if (loggedPlanRef.current === logKey) return;
    loggedPlanRef.current = logKey;
    const planAny = plan as unknown as { meta?: { origin?: unknown }; origin?: unknown };
    console.log('[origin2] editor loaded plan', {
      planId: planId ?? null,
      origin: planAny.meta?.origin ?? planAny.origin ?? null,
    });
  }, [plan, planId, verticalDebugEnabled]);

  useEffect(() => {
    if (!plan) return;
    const logKey = planId ?? 'new';
    if (loggedOriginPlanRef.current === logKey) return;
    loggedOriginPlanRef.current = logKey;
    const planAny = plan as unknown as {
      meta?: { origin?: unknown };
      origin?: unknown;
    };
    console.log('[origin2] editor loaded', {
      planId: planId ?? null,
      origin: planAny.meta?.origin ?? planAny.origin ?? null,
    });
  }, [plan, planId, verticalDebugEnabled]);

  useEffect(() => {
    if (!planSource?.id) return;
    if (planSourceType !== 'cloud') return;
    if (loggedViewRef.current === planSource.id) return;
    loggedViewRef.current = planSource.id;
    void logEvent('plan_viewed', {
      planId: planSource.id,
      templateId: planSource.template_id ?? null,
      payload: { editPolicy: planSource.editPolicy ?? null },
    });
  }, [planSource, planSourceType]);

  useEffect(() => {
    if (!shouldAutoMigrateLocalDraft) return;
    if (!userId) return;
    if (!plan) return;
    if (!activePlanId) return;
    if (planSourceType !== 'local') return;
    const migrationState = draftMigrationRef.current;
    if (migrationState.draftId !== activePlanId) {
      draftMigrationRef.current = { draftId: activePlanId, status: 'idle' };
    }

    const migrate = async () => {
      if (draftMigrationRef.current.status === 'migrating') return;
      draftMigrationRef.current.status = 'migrating';
      try {
        const basePlan = buildPlanFromDraft(plan, planSource, activePlanId);
        const cloudPlanId = generateId();
        const cloudPlan: Plan = { ...basePlan, id: cloudPlanId };
        const savedResult = await savePlan(cloudPlan, { userId });
        if (!savedResult.ok || savedResult.source !== 'cloud') {
          draftMigrationRef.current.status = 'idle';
          return;
        }
        const finalPlan = savedResult.plan;
        setCloudPlanIdForDraft(activePlanId, finalPlan.id);
        setPlanSource(finalPlan);
        setPlanId(finalPlan.id);
        setPlanSourceType(savedResult.source);
        upsertRecentPlan(finalPlan);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, finalPlan.id);
          setStoredActivePlanId(finalPlan.id);
        }
        draftMigrationRef.current.status = 'done';
        router.push(`/plans/${encodeURIComponent(finalPlan.id)}`);
      } catch {
        draftMigrationRef.current.status = 'idle';
      }
    };

    const mappedCloudId = getCloudPlanIdForDraft(activePlanId);
    if (mappedCloudId) {
      if (draftMigrationRef.current.status === 'checking') return;
      draftMigrationRef.current.status = 'checking';
      void (async () => {
        const mappedResult = await loadPlan(mappedCloudId, { userId });
        if (mappedResult.ok && mappedResult.source === 'cloud') {
          draftMigrationRef.current.status = 'done';
          if (routePlanId !== mappedCloudId) {
            router.push(`/plans/${encodeURIComponent(mappedCloudId)}`);
          }
          return;
        }
        clearCloudPlanIdForDraft(activePlanId);
        draftMigrationRef.current.status = 'idle';
        void migrate();
      })();
      return;
    }
    void migrate();
  }, [
    activePlanId,
    plan,
    planSource,
    planSourceType,
    routePlanId,
    router,
    shouldAutoMigrateLocalDraft,
    userId,
  ]);

  const pumpResolveQueue = useCallback(() => {
    if (resolvePumpActiveRef.current) return;
    resolvePumpActiveRef.current = true;

    const runNext = () => {
      while (
        resolveActiveRef.current < PLACE_RESOLVE_MAX_CONCURRENCY &&
        resolveQueueRef.current.length > 0
      ) {
        const current = resolveQueueRef.current.shift();
        if (!current) break;
        resolveQueuedKeysRef.current.delete(current.key);
        resolveActiveRef.current += 1;
        const task = (async () => {
          const resolved = await fetchPlaceResolve(current.query, current.city);
          if (!isMountedRef.current) return;
          if (resolved?.placeId) {
            PLACE_RESOLVE_CACHE.set(current.key, resolved.placeId);
            resolvedPlaceIdsRef.current.set(current.stopId, resolved.placeId);
            resolvedStopKeysRef.current.add(`${current.stopId}|${current.key}`);
            setPlan((prev) => {
              if (!prev) return prev;
              let changed = false;
              const nextStops = prev.stops.map((s) => {
                if (s.id !== current.stopId) return s;
                if (s.placeRef?.placeId === resolved.placeId) return s;
                changed = true;
                return {
                  ...s,
                  placeRef: {
                    ...(s.placeRef ?? {}),
                    placeId: resolved.placeId,
                  },
                };
              });
              return changed ? { ...prev, stops: nextStops } : prev;
            });
            setResolvedPlaceIdsVersion((prev) => prev + 1);
          } else {
            PLACE_RESOLVE_CACHE.set(current.key, null);
            resolvedStopKeysRef.current.add(`${current.stopId}|${current.key}`);
          }
          if (PLACE_RESOLVE_CACHE.size > PLACE_RESOLVE_CACHE_LIMIT) {
            PLACE_RESOLVE_CACHE.clear();
          }
        })();
        PLACE_RESOLVE_INFLIGHT.set(current.key, task);
        task.finally(() => {
          PLACE_RESOLVE_INFLIGHT.delete(current.key);
          resolveActiveRef.current -= 1;
          if (resolveQueueRef.current.length > 0) {
            runNext();
          } else if (resolveActiveRef.current === 0) {
            resolvePumpActiveRef.current = false;
          }
        });
      }

      if (resolveQueueRef.current.length === 0 && resolveActiveRef.current === 0) {
        resolvePumpActiveRef.current = false;
      }
    };

    runNext();
  }, []);

  const pumpDetailsQueue = useCallback(() => {
    if (detailsPumpActiveRef.current) return;
    detailsPumpActiveRef.current = true;

    const runNext = () => {
      while (
        detailsActiveRef.current < PLACE_DETAILS_MAX_CONCURRENCY &&
        detailsQueueRef.current.length > 0
      ) {
        const placeId = detailsQueueRef.current.shift();
        if (!placeId) break;
        detailsQueuedRef.current.delete(placeId);
        detailsActiveRef.current += 1;
        detailsInFlightRef.current.add(placeId);
        const task = (async () => {
          const lite = await fetchPlaceDetails(placeId);
          if (!isMountedRef.current || !lite) return;
          PLACE_DETAILS_CACHE.set(placeId, lite);
          detailsCompletedRef.current.add(placeId);
          if (PLACE_DETAILS_CACHE.size > PLACE_DETAILS_CACHE_LIMIT) {
            PLACE_DETAILS_CACHE.clear();
            detailsCompletedRef.current.clear();
          }
        })();
        PLACE_DETAILS_INFLIGHT.set(placeId, task);
        task.finally(() => {
          PLACE_DETAILS_INFLIGHT.delete(placeId);
          detailsInFlightRef.current.delete(placeId);
          detailsActiveRef.current -= 1;
          if (isMountedRef.current) {
            setLoadingPlaceIds((prev) => {
              if (!prev.has(placeId)) return prev;
              const next = new Set(prev);
              next.delete(placeId);
              return next;
            });
          }
          if (detailsQueueRef.current.length > 0) {
            runNext();
          } else if (detailsActiveRef.current === 0) {
            detailsPumpActiveRef.current = false;
          }
        });
      }

      if (detailsQueueRef.current.length === 0 && detailsActiveRef.current === 0) {
        detailsPumpActiveRef.current = false;
      }
    };

    runNext();
  }, []);

  const kickoffResolveAndDetails = useCallback(() => {
    if (!plan) return;
    if (planSourceType === 'cloud' && (planSource?.stops?.length ?? 0) > 0) return;
    if (stops.length === 0) return;
    const shouldResolve =
      planOriginSource === 'search' || planOriginSource === 'unknown';
    const city =
      planSource?.context?.district?.cityName ??
      planSource?.context?.district?.label ??
      null;

    const cachedResolved = new Map<string, string>();
    let resolvedBump = 0;
    const resolveSeen = new Set<string>();
    const resolveCandidates: ResolveCandidate[] = [];

    if (shouldResolve) {
      for (const stop of stops) {
        if (getStopStatus(stop) === 'placeholder') continue;
        const meta = stopMetaById.get(stop.id) as StopMeta | undefined;
        const existingPlaceId = getPlaceId({ ...(meta ?? {}), ...stop });
        if (existingPlaceId) continue;
        const resolveMeta = getResolveMeta({ ...(meta ?? {}), ...stop });
        if (resolveMeta.placeholder) continue;
        if (resolvedPlaceIdsRef.current.has(stop.id)) continue;
        const query = resolveMeta.q || getPlaceQuery(meta ?? {}) || stop.label;
        if (!query || query.trim().length < 4) continue;
        if (!resolveMeta.q && isGenericQuery(query)) continue;
        const nearHint = resolveMeta.near || city || '';
        const key = `${query.trim().toLowerCase()}|${nearHint.trim().toLowerCase()}`;
        const stopKey = `${stop.id}|${key}`;
        if (resolvedStopKeysRef.current.has(stopKey)) continue;
        if (PLACE_RESOLVE_CACHE.has(key)) {
          const cached = PLACE_RESOLVE_CACHE.get(key);
          resolvedStopKeysRef.current.add(stopKey);
          if (cached) {
            resolvedPlaceIdsRef.current.set(stop.id, cached);
            cachedResolved.set(stop.id, cached);
            resolvedBump += 1;
          }
          continue;
        }
        if (PLACE_RESOLVE_INFLIGHT.has(key)) continue;
        if (resolveQueuedKeysRef.current.has(key)) continue;
        if (resolveSeen.has(key)) continue;
        resolveSeen.add(key);
        resolveCandidates.push({ stopId: stop.id, key, query, city: nearHint || undefined });
      }
    }

    if (cachedResolved.size > 0) {
      setPlan((prev) => {
        if (!prev) return prev;
        let changed = false;
        const nextStops = prev.stops.map((s) => {
          const placeId = cachedResolved.get(s.id);
          if (!placeId) return s;
          if (s.placeRef?.placeId === placeId) return s;
          changed = true;
          return {
            ...s,
            placeRef: {
              ...(s.placeRef ?? {}),
              placeId,
            },
          };
        });
        return changed ? { ...prev, stops: nextStops } : prev;
      });
      setResolvedPlaceIdsVersion((prev) => prev + resolvedBump);
    }

    if (resolveCandidates.length > 0) {
      for (const candidate of resolveCandidates) {
        resolveQueueRef.current.push(candidate);
        resolveQueuedKeysRef.current.add(candidate.key);
      }
    }

    const detailCandidates: string[] = [];
    const detailSeen = new Set<string>();

    for (const stop of stops) {
      if (getStopStatus(stop) === 'placeholder') continue;
      const meta = stopMetaById.get(stop.id) as StopMeta | undefined;
      const placeId =
        getPlaceId({ ...(meta ?? {}), ...stop }) ??
        resolvedPlaceIdsRef.current.get(stop.id) ??
        null;
      if (!placeId) continue;
      if (PLACE_DETAILS_CACHE.has(placeId)) {
        detailsCompletedRef.current.add(placeId);
        continue;
      }
      if (detailsCompletedRef.current.has(placeId)) continue;
      if (PLACE_DETAILS_INFLIGHT.has(placeId)) continue;
      if (detailsInFlightRef.current.has(placeId)) continue;
      if (detailsQueuedRef.current.has(placeId)) continue;
      if (meta && hasAnyPlacesSignal(meta)) continue;
      if (detailSeen.has(placeId)) continue;
      detailSeen.add(placeId);
      detailCandidates.push(placeId);
    }

    if (detailCandidates.length > 0) {
      for (const placeId of detailCandidates) {
        detailsQueueRef.current.push(placeId);
        detailsQueuedRef.current.add(placeId);
      }
      setLoadingPlaceIds((prev) => {
        const next = new Set(prev);
        for (const placeId of detailCandidates) {
          next.add(placeId);
        }
        return next;
      });
    }

    if (resolveCandidates.length > 0) {
      pumpResolveQueue();
    }
    if (detailCandidates.length > 0) {
      pumpDetailsQueue();
    }
  }, [
    plan,
    stops,
    stopMetaById,
    planSource,
    planSourceType,
    planOriginSource,
    pumpDetailsQueue,
    pumpResolveQueue,
  ]);

  useEffect(() => {
    if (!plan) return;
    kickoffResolveAndDetails();
  }, [planId, stopsSig, resolvedPlaceIdsVersion, kickoffResolveAndDetails, plan]);

function persistDraft(nextDraft: PlanDraft) {
  const activePlanId = planSource?.id ?? planId ?? routePlanId;
  if (!activePlanId) return;
  const nextPlan = buildPlanFromDraft(nextDraft, planSource, activePlanId);
  const nextPlanWithMeta: Plan = {
    ...nextPlan,
    stops: nextPlan.stops.map((stop) => {
      const meta = stopMetaById.get(stop.id);
      return meta ? ({ ...stop, ...meta } as PlanStop) : stop;
    }),
  };
  setPlanSource(nextPlanWithMeta);
  upsertRecentPlan(nextPlanWithMeta);
}

  useEffect(() => {
    if (!isSavedPlanRoute || !routePlanId || !plan) return;
    if (revisitedRef.current === routePlanId) return;
    revisitedRef.current = routePlanId;
    const timestamp = new Date().toISOString();
    setPlan((prev) => {
      if (!prev) return prev;
      const nextDraft = {
        ...prev,
        planSignals: {
          ...prev.planSignals,
          revisitedCount: prev.planSignals.revisitedCount + 1,
          revisitedAt: [...prev.planSignals.revisitedAt, timestamp],
        },
      };
      persistDraft(nextDraft);
      return nextDraft;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persistDraft should not retrigger on identity changes
  }, [isSavedPlanRoute, plan, routePlanId]);

  function updateField<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setPlan((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function getStopTypeIdForEvent(stop: Stop | undefined | null): string | null {
    if (!stop) return null;
    return stop.stop_type_id ?? null;
  }

  function logStopEvent(
    eventType: string,
    stopTypeId: string | null,
    payload?: Record<string, unknown>
  ) {
    if (!activePlanId) return;
    void logEvent(eventType, {
      planId: activePlanId,
      userId,
      templateId: planSource?.template_id ?? null,
      stopTypeId: stopTypeId ?? null,
      payload: payload ?? undefined,
    });
  }

  function updateStop(stopId: string, partial: Partial<Stop>) {
    let beforeType: string | null = null;
    let afterType: string | null = null;
    setHasUnsavedChanges(true);
    setPlan((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            stops: prev.stops.map((stop) => {
              if (stop.id !== stopId) return stop;
              beforeType = getStopTypeIdForEvent(stop);
              const nextStop = { ...stop, ...partial };
              afterType = getStopTypeIdForEvent(nextStop);
              return nextStop;
            }),
          }
    );
    if (beforeType !== afterType) {
      logStopEvent('stop_type_changed', afterType ?? null);
    }
  }

  function addStop() {
    let newStopType: string | null = null;
    setHasUnsavedChanges(true);
    setPlan((prev) => {
      if (!prev) return prev;
      const newStop = createStop(`Stop ${prev.stops.length + 1}`, defaultStopTypeId);
      newStopType = getStopTypeIdForEvent(newStop);
      return {
        ...prev,
        stops: [...prev.stops, newStop],
      };
    });
    logStopEvent('stop_added', newStopType);
  }

  function buildPackPlaceholderStop(
    index: number,
    stopTypeId?: string,
    isFirst?: boolean
  ): Stop {
    return {
      ...createStop(`Suggested stop ${index + 1}`, stopTypeId),
      notes: PLACEHOLDER_NOTE,
      resolve: { placeholder: true },
      ...(isFirst ? { time: '' } : {}),
    };
  }

  function applyExperiencePackDraft(draft: ExperiencePackDraft) {
    if (isApplyingPack) return;
    setIsApplyingPack(true);
    let nextCoachMessage: string | null = null;
    let changed = false;
    const newlyAddedStopIds: string[] = [];
    setPlan((prev) => {
      if (!prev) return prev;
      const sequence = draft.commonStopSequence ?? [];
      const nextStops = [...prev.stops];
      const startedEmpty = nextStops.length === 0;

      if (startedEmpty && sequence.length > 0) {
        sequence.forEach((stopTypeId, index) => {
          const newStop = buildPackPlaceholderStop(index, stopTypeId || undefined, index === 0);
          nextStops.push(newStop);
          newlyAddedStopIds.push(newStop.id);
        });
      }

      const targetCount =
        typeof draft.typicalStopsCount === 'number' && draft.typicalStopsCount > 0
          ? draft.typicalStopsCount
          : 0;
      while (nextStops.length < targetCount) {
        const seqType = sequence[nextStops.length] ?? undefined;
        const newStop = buildPackPlaceholderStop(nextStops.length, seqType, false);
        nextStops.push(newStop);
        newlyAddedStopIds.push(newStop.id);
      }

      if (nextStops.length === prev.stops.length) {
        return prev;
      }

      changed = true;
      const hasDateAnchor = Boolean(prev.date?.trim()) && Boolean(prev.time?.trim());
      const hasWhenAnchor = Boolean(prev.whenText?.trim());
      if (!hasDateAnchor && !hasWhenAnchor && draft.typicalHourBin) {
        nextCoachMessage = `Packs often work best in ${draft.typicalHourBin}. Add a time anchor if you want.`;
      } else {
        nextCoachMessage = null;
      }

      return {
        ...prev,
        stops: nextStops,
      };
    });
    if (changed) {
      setHasUnsavedChanges(true);
    }
    setPackCoachNudge(nextCoachMessage);
    if (packAppliedTimeoutRef.current) {
      clearTimeout(packAppliedTimeoutRef.current);
      packAppliedTimeoutRef.current = null;
    }
    setJustAppliedPack(true);
    packAppliedTimeoutRef.current = setTimeout(() => {
      setJustAppliedPack(false);
      packAppliedTimeoutRef.current = null;
    }, 1500);
    if (newlyAddedStopIds.length > 0) {
      setRecentlyAddedStopIds(newlyAddedStopIds);
      if (packHighlightTimeoutRef.current) {
        clearTimeout(packHighlightTimeoutRef.current);
        packHighlightTimeoutRef.current = null;
      }
      packHighlightTimeoutRef.current = setTimeout(() => {
        setRecentlyAddedStopIds([]);
        packHighlightTimeoutRef.current = null;
      }, 2500);
      const firstNewStopId = newlyAddedStopIds[0];
      if (packScrollRafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(packScrollRafRef.current);
        packScrollRafRef.current = null;
      }
      if (typeof window !== 'undefined') {
        packScrollRafRef.current = window.requestAnimationFrame(() => {
          const target = document.getElementById(`stop-${firstNewStopId}`);
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          packScrollRafRef.current = null;
        });
      }
    }
    setIsApplyingPack(false);
  }

  function removeStop(stopId: string) {
    let removedType: string | null = null;
    setHasUnsavedChanges(true);
    setPlan((prev) => {
      if (!prev) return prev;
      const remaining = prev.stops.filter((s) => {
        if (s.id !== stopId) return true;
        removedType = getStopTypeIdForEvent(s);
        return false;
      });
      return {
        ...prev,
        stops:
          remaining.length > 0
            ? remaining
            : [createStop(waypointName || 'Main stop', defaultStopTypeId)],
      };
    });
    logStopEvent('stop_removed', removedType);
  }

  function moveStop(stopId: string, direction: 'up' | 'down') {
    let movedType: string | null = null;
    let didMove = false;
    let fromIndex: number | null = null;
    let toIndex: number | null = null;
    setPlan((prev) => {
      if (!prev) return prev;

      const index = prev.stops.findIndex((s) => s.id === stopId);
      if (index === -1) return prev;

      const newStops = [...prev.stops];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newStops.length) return prev;

      movedType = getStopTypeIdForEvent(newStops[index]);
      fromIndex = index;
      toIndex = targetIndex;
      const temp = newStops[index];
      newStops[index] = newStops[targetIndex];
      newStops[targetIndex] = temp;
      didMove = true;

      return { ...prev, stops: newStops };
    });
    if (didMove) {
      setHasUnsavedChanges(true);
      logStopEvent('stop_reordered', movedType, {
        from_index: fromIndex,
        to_index: toIndex,
      });
    }
  }

  function setOutcome(next: 'completed' | 'skipped' | 'clear') {
    const now = new Date().toISOString();
    setPlan((prev) => {
      if (!prev) return prev;
      const nextDraft = {
        ...prev,
        planSignals: {
          ...prev.planSignals,
          completed: next === 'completed',
          completedAt: next === 'completed' ? now : null,
          skipped: next === 'skipped',
          skippedAt: next === 'skipped' ? now : null,
        },
      };
      persistDraft(nextDraft);
      return nextDraft;
    });
  }

  function setSentiment(next: PlanSignals['sentiment']) {
    if (!plan) return;
    const now = new Date().toISOString();
    const nextSentiment = plan.planSignals.sentiment === next ? null : next;
    const nextSentimentAt = nextSentiment ? now : undefined;
    const activePlanId = planSource?.id ?? planId ?? routePlanId;
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            planSignals: {
              ...prev.planSignals,
              sentiment: nextSentiment,
              sentimentAt: nextSentimentAt,
            },
          }
        : prev
    );
    if (planSource) {
      setPlanSource({
        ...planSource,
        planSignals: {
          ...normalizePlanSignals(planSource.planSignals),
          sentiment: nextSentiment,
          sentimentAt: nextSentimentAt,
        },
      });
    }
    if (activePlanId) {
      updatePlanSentiment(activePlanId, nextSentiment);
    }
  }

  const templateIdFromPlan =
    planSource?.createdFrom?.kind === 'template' ? planSource.createdFrom.templateId : null;
  const experienceIdFromPlan =
    planSource?.createdFrom?.kind === 'experience' ? planSource.createdFrom.experienceId : null;
  const templateIdFromStorage =
    !templateIdFromPlan && activePlanId && typeof window !== 'undefined'
      ? window.localStorage.getItem(`plan-template:${activePlanId}`)?.trim() || null
      : null;
  const effectiveTemplateId = templateIdFromPlan ?? templateIdFromStorage;
  const templateV2 = getTemplateV2ById(effectiveTemplateId);
  const guidance = buildVerticalGuidance({ template: verticalTemplate, planLike: plan });
  const experiencePackTemplateId = selectedTemplateId || '';
  const experiencePackDistrict = useMemo(() => {
    const stops = plan?.stops ?? [];
    for (const stop of stops) {
      const formattedAddress = stop.placeLite?.formattedAddress;
      if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) continue;
      const derived = extractDistrict(formattedAddress);
      if (derived) return derived;
    }
    return '';
  }, [plan?.stops]);
  const experiencePackCity = useMemo(() => {
    const stops = plan?.stops ?? [];
    for (const stop of stops) {
      const formattedAddress = stop.placeLite?.formattedAddress;
      if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) continue;
      const derived = extractCity(formattedAddress);
      if (derived) return derived;
    }
    return '';
  }, [plan?.stops]);
  const derivedDistrictOrCity = experiencePackDistrict || experiencePackCity || null;
  const experiencePackLocation = derivedDistrictOrCity ?? 'Unknown';
  const experiencePackDayOfWeek = useMemo(() => {
    const dayOfWeek = getDayOfWeekFromDateInput(plan?.date);
    return typeof dayOfWeek === 'number' ? dayOfWeek : undefined;
  }, [plan?.date]);
  const experiencePackHourBin = useMemo(() => {
    const hourBin = getHourBinFromTimeInput(plan?.time);
    return hourBin ?? undefined;
  }, [plan?.time]);
  const experiencePackMinDistinctPlans = process.env.NODE_ENV === 'development' ? 1 : 3;
  const shouldLogVerticalDebug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';
  const experiencePackLocationKnown =
    experiencePackLocation.trim().length > 0 &&
    experiencePackLocation.trim().toLowerCase() !== 'unknown';
  const templateStopTypeIds = useMemo(
    () =>
      (verticalTemplate?.stopTypes ?? [])
        .map((stopType) => stopType.id)
        .filter((stopTypeId): stopTypeId is string => Boolean(stopTypeId?.trim())),
    [verticalTemplate]
  );
  const earnedExperiencePackDraft = useMemo<ExperiencePackDraft | null>(() => {
    if (!experiencePackSummary || !experiencePackTemplateId) return null;
    return buildExperiencePackDraft(experiencePackSummary, {
      templateId: experiencePackTemplateId,
      city: experiencePackLocation || null,
    });
  }, [experiencePackLocation, experiencePackSummary, experiencePackTemplateId]);
  const previewExperiencePackDraft = useMemo<ExperiencePackDraft | null>(() => {
    if (!experiencePackTemplateId) return null;
    return buildPreviewExperiencePackDraft({
      templateId: experiencePackTemplateId,
      city: experiencePackLocation || null,
      templateStopTypeIds,
    });
  }, [experiencePackLocation, experiencePackTemplateId, templateStopTypeIds]);
  const packMode: 'earned' | 'preview' = earnedExperiencePackDraft ? 'earned' : 'preview';
  const experiencePackDraft =
    packMode === 'earned' ? earnedExperiencePackDraft : previewExperiencePackDraft;
  useEffect(() => {
    if (!shouldLogVerticalDebug) return;
    console.log('[pack]', {
      templateId: experiencePackTemplateId || null,
      derivedDistrictOrCity,
      packMode,
    });
  }, [derivedDistrictOrCity, experiencePackTemplateId, packMode, shouldLogVerticalDebug]);
  const discoveryPresetV2 = getDiscoveryPresetV2ById(templateV2?.discoveryPresetId);
  const templateDefaultQuery = discoveryPresetV2?.defaultQuery ?? '';
  const experienceV2 = getVenueExperienceV2ById(experienceIdFromPlan);
  const experienceDefaultQuery = experienceV2?.defaultQuery ?? '';
  const queryParam = params.get('q')?.trim() ?? '';
  const planTitleHint = plan?.title?.trim() || '';
  const planIntentHint =
    plan?.notes?.trim() && plan?.notes?.trim() !== 'What do we want to accomplish?'
      ? plan.notes.trim()
      : '';
  const planWhenHint = plan?.whenText?.trim() || '';
  const organicDefaultQuery =
    queryParam || planTitleHint || planIntentHint || planWhenHint || '';
  const shouldShowSecondStopRecommendation =
    Boolean(secondStopRecommendation?.shouldRecommend) && !secondStopDismissed;

  useEffect(() => {
    setSecondStopDismissed(false);
  }, [activePlanId, effectiveTemplateId]);

  useEffect(() => {
    setIsPackDraftDismissed(false);
    setPackCoachNudge(null);
  }, [experiencePackLocation, experiencePackTemplateId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSecondStopRecommendation() {
      if (!activePlanId || !effectiveTemplateId) {
        setSecondStopRecommendation(null);
        return;
      }
      if (stopCount >= 2) {
        setSecondStopRecommendation(null);
        return;
      }
      const result = await getSecondStopRecommendation(
        activePlanId,
        effectiveTemplateId,
        stopCount
      );
      if (cancelled) return;
      setSecondStopRecommendation(result);
    }
    void loadSecondStopRecommendation();
    return () => {
      cancelled = true;
    };
  }, [activePlanId, effectiveTemplateId, stopCount]);

  useEffect(() => {
    let cancelled = false;
    async function loadExperiencePack() {
      if (!planSource || !experiencePackTemplateId) {
        if (!cancelled) {
          setExperiencePackSummary(null);
          setHasLoadedExperiencePack(false);
          setExperiencePackPreviewReason('no_data');
          if (shouldLogVerticalDebug) {
            console.log('[experience-pack:plan]', {
              templateId: experiencePackTemplateId || null,
              derivedLocation: experiencePackLocation || null,
              minDistinctPlans: experiencePackMinDistinctPlans,
              evidence: null,
            });
          }
        }
        return;
      }
      if (!experiencePackLocationKnown) {
        if (!cancelled) {
          setExperiencePackSummary(null);
          setHasLoadedExperiencePack(true);
          setExperiencePackPreviewReason('no_city');
          if (shouldLogVerticalDebug) {
            console.log('[experience-pack:plan]', {
              templateId: experiencePackTemplateId || null,
              derivedLocation: experiencePackLocation || null,
              minDistinctPlans: experiencePackMinDistinctPlans,
              evidence: null,
              mode: 'preview',
              reason: 'no_city',
            });
          }
        }
        return;
      }
      if (!cancelled) {
        setHasLoadedExperiencePack(false);
      }
      const earnedResult = await getExperiencePackSummary({
        templateId: experiencePackTemplateId,
        location: experiencePackLocation,
        dayOfWeek: experiencePackDayOfWeek,
        hourBin: experiencePackHourBin,
        limitPlans: 50,
        minDistinctPlans: experiencePackMinDistinctPlans,
      });
      if (cancelled) return;
      if (shouldLogVerticalDebug) {
        const evidence =
          earnedResult.data?.evidence
            ? {
                distinctPlans: earnedResult.data.evidence.count ?? null,
                totalSignals:
                  (earnedResult.data.evidence as { totalSignals?: number | null }).totalSignals ??
                  null,
              }
            : null;
        console.log('[experience-pack:plan]', {
          templateId: experiencePackTemplateId || null,
          derivedLocation: experiencePackLocation || null,
          minDistinctPlans: experiencePackMinDistinctPlans,
          evidence,
        });
      }
      if (earnedResult.error) {
        setExperiencePackSummary(null);
        setHasLoadedExperiencePack(true);
        setExperiencePackPreviewReason('no_data');
        return;
      }
      if (earnedResult.data) {
        setExperiencePackSummary(earnedResult.data);
        setHasLoadedExperiencePack(true);
        setExperiencePackPreviewReason('no_data');
        return;
      }

      const probeResult = await getExperiencePackSummary({
        templateId: experiencePackTemplateId,
        location: experiencePackLocation,
        dayOfWeek: experiencePackDayOfWeek,
        hourBin: experiencePackHourBin,
        limitPlans: 50,
        minDistinctPlans: 1,
      });
      if (cancelled) return;
      if (probeResult.error) {
        setExperiencePackSummary(null);
        setHasLoadedExperiencePack(true);
        setExperiencePackPreviewReason('no_data');
        return;
      }
      const probeDistinctPlans = probeResult.data?.evidence?.count ?? 0;
      const reason =
        probeResult.data && probeDistinctPlans < experiencePackMinDistinctPlans
          ? 'below_threshold'
          : 'no_data';
      setExperiencePackSummary(null);
      setHasLoadedExperiencePack(true);
      setExperiencePackPreviewReason(reason);
    }
    void loadExperiencePack();
    return () => {
      cancelled = true;
    };
  }, [
    experiencePackLocation,
    experiencePackDayOfWeek,
    experiencePackHourBin,
    experiencePackMinDistinctPlans,
    experiencePackTemplateId,
    experiencePackLocationKnown,
    planSource,
    shouldLogVerticalDebug,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadSeasonalContext() {
      if (!planSource || !experiencePackTemplateId) {
        if (!cancelled) {
          setSeasonalContextSummary(null);
          setHasLoadedSeasonalContext(false);
        }
        return;
      }
      if (!experiencePackLocationKnown) {
        if (!cancelled) {
          setSeasonalContextSummary(null);
          setHasLoadedSeasonalContext(true);
        }
        return;
      }

      if (!cancelled) {
        setHasLoadedSeasonalContext(false);
      }
      const result = await getSeasonalContextSummary({
        templateId: experiencePackTemplateId,
        location: experiencePackLocation,
        minDistinctPlans: experiencePackMinDistinctPlans,
      });
      if (cancelled) return;
      if (result.error || !result.data) {
        setSeasonalContextSummary(null);
        setHasLoadedSeasonalContext(true);
        return;
      }
      setSeasonalContextSummary(result.data);
      setHasLoadedSeasonalContext(true);
    }
    void loadSeasonalContext();
    return () => {
      cancelled = true;
    };
  }, [
    experiencePackLocation,
    experiencePackLocationKnown,
    experiencePackMinDistinctPlans,
    experiencePackTemplateId,
    planSource,
  ]);

  const stopTypeLabelById = (() => {
    const lookup = new Map<string, string>();
    (verticalTemplate?.stopTypes ?? []).forEach((stopType) => {
      if (!stopType?.id) return;
      lookup.set(stopType.id, stopType.label ?? stopType.id);
    });
    return lookup;
  })();
  const experienceSequenceLabels =
    !experiencePackDraft || (experiencePackDraft.commonStopSequence ?? []).length === 0
      ? 'No common typed sequence yet.'
      : (experiencePackDraft.commonStopSequence ?? [])
          .map((stopTypeId) => stopTypeLabelById.get(stopTypeId) ?? stopTypeId)
          .join(' -> ');

  if (notFound) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-300">Plan not found.</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Back to home
          </button>
        </div>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading plan…</p>
      </main>
    );
  }

  // ✅ Derived validation flags
  const isDateValid = plan.date.trim().length > 0;
  const isTimeValid = plan.time.trim().length > 0;
  const isCoreInfoValid = isDateValid && isTimeValid;
  const hasOutcomePrompt = isSavedPlanRoute && plan.planSignals.chosen;
  const hasSentimentPrompt =
    isSavedPlanRoute &&
    (plan.planSignals.completed === true || plan.planSignals.skipped === true);
  const outcomeValue = plan.planSignals.completed
    ? 'completed'
    : plan.planSignals.skipped
    ? 'skipped'
    : 'clear';

  function mergeSavedPlanMetadata(nextPlan: Plan, savedPlan: Plan | null | undefined): Plan {
    if (!savedPlan) return nextPlan;
    return {
      ...nextPlan,
      id: savedPlan.id || nextPlan.id,
      version: savedPlan.version || nextPlan.version,
      owner: savedPlan.owner ?? nextPlan.owner,
      ownerId: savedPlan.ownerId ?? nextPlan.ownerId,
      editPolicy: savedPlan.editPolicy ?? nextPlan.editPolicy,
      template_id: savedPlan.template_id ?? nextPlan.template_id,
      isTemplate: savedPlan.isTemplate ?? nextPlan.isTemplate,
      createdFrom: savedPlan.createdFrom ?? nextPlan.createdFrom,
      origin: savedPlan.origin ?? nextPlan.origin,
      state: savedPlan.state ?? nextPlan.state,
      metadata: {
        ...(nextPlan.metadata ?? {}),
        ...(savedPlan.metadata ?? {}),
      },
      presentation: {
        ...(nextPlan.presentation ?? {}),
        ...(savedPlan.presentation ?? {}),
        shareToken:
          savedPlan.presentation?.shareToken ?? nextPlan.presentation?.shareToken,
      },
      brand: savedPlan.brand ?? nextPlan.brand,
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setHasTriedSubmit(true);

    // ✅ Guard: prevents TS null errors AND runtime weirdness
    if (!plan) return;
    if (isReadOnly) return;

    if (!isCoreInfoValid) return;

    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = null;
    }
    setSaveStatus('saving');
    setIsSaving(true);

      let activePlanId = planSource?.id ?? planId ?? routePlanId;
      if (!activePlanId && workspaceMode === 'new') {
        activePlanId = generateId();
        setPlanId(activePlanId);
      }
      if (!activePlanId) {
        setIsSaving(false);
        setSaveStatus('error');
        saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimeoutRef.current = null;
      }, 2500);
        return;
      }
      try {
        if (verticalDebugEnabled && process.env.NODE_ENV !== 'production') {
          console.log('[plan] save payload', {
            id: activePlanId,
            date: plan.date,
            time: plan.time,
            whenText: plan.whenText,
          });
        }
        const nextPlan = buildPlanFromDraft(plan, planSource, activePlanId);
        const savedResult = await savePlan(nextPlan, { userId });
        const finalPlan = savedResult.ok
          ? mergeSavedPlanMetadata(nextPlan, savedResult.plan)
          : nextPlan;
        if (verticalDebugEnabled) {
          const savedAnchors = savedResult.ok
            ? (savedResult.plan as Plan & { date?: string; time?: string; whenText?: string })
            : null;
          const mergedAnchors = finalPlan as Plan & {
            date?: string;
            time?: string;
            whenText?: string;
          };
          const nextAnchors = nextPlan as Plan & {
            date?: string;
            time?: string;
            whenText?: string;
          };
          console.log('[plan] save anchor merge', {
            nextPlan: {
              date: nextAnchors.date ?? null,
              time: nextAnchors.time ?? null,
              whenText: nextAnchors.whenText ?? null,
            },
            savedResultPlan: savedAnchors
              ? {
                  date: savedAnchors.date ?? null,
                  time: savedAnchors.time ?? null,
                  whenText: savedAnchors.whenText ?? null,
                }
              : null,
            finalPlan: {
              date: mergedAnchors.date ?? null,
              time: mergedAnchors.time ?? null,
              whenText: mergedAnchors.whenText ?? null,
            },
          });
        }
        upsertRecentPlan(finalPlan);
        if (savedResult.ok) {
          setPlanSourceType(savedResult.source);
        }
        setSavedById(finalPlan.id, true);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(RECENT_PLANS_PULSE_KEY, String(Date.now()));
          window.dispatchEvent(
            new CustomEvent(RECENT_PLANS_PULSE_EVENT, { detail: { planId: finalPlan.id } })
          );
        }
        setPlanSource(finalPlan);
        setPlanId(finalPlan.id);
        setHasUnsavedChanges(false);
        if (workspaceMode === 'new' && !routePlanId) {
          router.push(`/plans/${encodeURIComponent(finalPlan.id)}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 150));

        setIsSaving(false);
      setSaveStatus('saved');
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimeoutRef.current = null;
      }, 2200);
    } catch {
      setIsSaving(false);
      setSaveStatus('error');
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimeoutRef.current = null;
      }, 2500);
    }
  }

  async function handleShareClick() {
    setHasTriedSubmit(true);

    if (!plan) return;

    if (!isCoreInfoValid) {
      window.alert('Please set a date and time before sharing this plan.');
      return;
    }
    if (!userId) {
      window.alert('Please sign in to share this plan.');
      return;
    }

    setIsSaving(true);

    const activePlanId = planSource?.id ?? planId ?? routePlanId;
    if (!activePlanId) {
      setIsSaving(false);
      return;
    }
    const nextPlan = buildPlanFromDraft(plan, planSource, activePlanId);
    const shareToken =
      nextPlan.presentation?.shareToken ??
      planSource?.presentation?.shareToken ??
      generateShareToken();
    const sharePlan = buildSharePlanFromDraft(plan, nextPlan.id, planSource);
    const planWithShareToken: Plan = {
      ...sharePlan,
      presentation: {
        ...sharePlan.presentation,
        shareToken,
      },
    };
    const savedResult = await savePlan(planWithShareToken, { userId });
    const finalPlan = savedResult.ok ? savedResult.plan : planWithShareToken;
    upsertRecentPlan(finalPlan);
    if (savedResult.ok) {
      setPlanSourceType(savedResult.source);
    }
    setPlanSource(finalPlan);
    setPlanId(finalPlan.id);

    const sharePath = `/share/${encodeURIComponent(finalPlan.id)}?t=${encodeURIComponent(
      shareToken
    )}`;
    const shareUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // ignore clipboard errors
    }

    setIsSaving(false);
    router.push(sharePath);
  }

  async function handleCopyToEdit() {
    if (!planSource?.id) return;
    if (!userId) {
      if (!plan) return;
      const localPlanId = generateId();
      const localPlan = buildPlanFromDraft(plan, planSource, localPlanId);
      const savedResult = await savePlan(localPlan, { userId: null });
      const finalPlan = savedResult.ok ? savedResult.plan : localPlan;
      setPlanSource(finalPlan);
      setPlanId(finalPlan.id);
      setPlanSourceType('local');
      upsertRecentPlan(finalPlan);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, finalPlan.id);
        setStoredActivePlanId(finalPlan.id);
      }
      router.push(`/plans/${encodeURIComponent(finalPlan.id)}`);
      return;
    }
    const result = await forkPlan(planSource.id, { userId });
    if (!result.ok) return;
    void logEvent('plan_forked', {
      planId: result.plan.id,
      templateId: result.plan.template_id ?? planSource.template_id ?? null,
      payload: { sourcePlanId: planSource.id },
    });
    router.push(`/plans/${encodeURIComponent(result.plan.id)}`);
  }

  const getSlotQuery = (label: string): string | null => {
    const normalized = label.toLowerCase();
    if (normalized === 'dinner') return 'dinner';
    if (normalized === 'a drink') return 'cocktail bar';
    if (normalized === 'something after') return 'dessert';
    if (normalized === 'main activity') return 'fun activity';
    if (normalized === 'snack/meal') return 'casual food';
    if (normalized === 'wind-down stop') return 'coffee';
    if (normalized === 'pre-game food') return 'food near venue';
    if (normalized === 'the venue') return 'parking';
    if (normalized === 'post-game drink') return 'bar';
    return null;
  };

  function scrollToStopsSection() {
    if (typeof document === 'undefined') return;
    document
      .getElementById('stops-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pulseElementById(elementId: string, durationMs = 1200) {
    if (typeof document === 'undefined') return;
    const element = document.getElementById(elementId);
    if (!element) return;
    const pulseClasses = [
      'ring-2',
      'ring-teal-400/60',
      'bg-teal-500/5',
      'transition-colors',
      'duration-700',
    ];
    pulseClasses.forEach((className) => element.classList.add(className));
    window.setTimeout(() => {
      pulseClasses.forEach((className) => element.classList.remove(className));
    }, durationMs);
  }

  function handleStorylineFlowClick() {
    scrollToStopsSection();
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      pulseElementById('stops-section');
    });
  }

  function focusStorylineAnchors() {
    if (typeof document === 'undefined') return;
    const dateInput = document.getElementById('date') as HTMLInputElement | null;
    const timeInput = document.getElementById('time') as HTMLInputElement | null;
    const target = dateInput ?? timeInput;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
    const highlightClasses = ['ring-2', 'ring-teal-400/70', 'border-teal-400'];
    [dateInput, timeInput].forEach((input) => {
      if (!input) return;
      highlightClasses.forEach((className) => input.classList.add(className));
    });
    window.setTimeout(() => {
      [dateInput, timeInput].forEach((input) => {
        if (!input) return;
        highlightClasses.forEach((className) => input.classList.remove(className));
      });
    }, 1200);
  }

  function scrollToDistrictIntelligenceSection() {
    if (typeof document === 'undefined') return;
    document
      .getElementById('district-intelligence-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      pulseElementById('district-intelligence-section');
    });
  }

  function handleDistrictPulseBusiestDayClick() {
    if (typeof document === 'undefined') return;
    document
      .getElementById('plan-intelligence-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      pulseElementById('plan-intelligence-section');
    });
  }

  function handleDistrictPulseTypicalPlanClick() {
    handleStorylineFlowClick();
  }

  function getCoachPrimaryChipLabel(suggestion: {
    id: string;
    title: string;
    mode: 'earned' | 'preview';
  }): string {
    if (suggestion.id === 'plan_strength_fragility') {
      return suggestion.title.toLowerCase().includes('dense') ? 'Trim or group stops' : 'Add 1 more stop';
    }
    if (suggestion.id === 'stop_type_delta') {
      const match = suggestion.title.match(/consider adding:\s*(.+?)\.?$/i);
      const stopTypeLabel = match?.[1]?.trim();
      return stopTypeLabel ? `Add a ${stopTypeLabel} stop` : 'Add a missing stop type';
    }
    if (suggestion.id === 'day_weekend_suitability') {
      const normalizedTitle = suggestion.title.toLowerCase();
      if (normalizedTitle.includes('weekends')) return 'Weekend works best';
      if (normalizedTitle.includes('weekdays')) return 'Weekday works best';
      return 'Set a date anchor';
    }
    if (suggestion.id === 'seasonal_shift_hint') {
      return 'This district shifts seasonally';
    }
    return suggestion.title;
  }

  function getCoachWhyChipLabel(suggestion: { id: string; mode: 'earned' | 'preview' }): string {
    if (suggestion.mode === 'preview') return 'Why: Typical for this toolkit';
    if (suggestion.id === 'day_weekend_suitability' || suggestion.id === 'seasonal_shift_hint') {
      return 'Why: Pattern in this district';
    }
    return 'Why: Based on completions here';
  }

  function handleCoachSuggestionPrimaryClick(suggestion: {
    id: string;
    title: string;
    mode: 'earned' | 'preview';
  }) {
    if (suggestion.id === 'plan_strength_fragility' || suggestion.id === 'stop_type_delta') {
      handleStorylineFlowClick();
      return;
    }
    if (suggestion.id === 'day_weekend_suitability') {
      if (suggestion.mode === 'preview' || suggestion.title.toLowerCase().includes('set a date')) {
        focusStorylineAnchors();
        return;
      }
      scrollToDistrictIntelligenceSection();
      return;
    }
    if (suggestion.id === 'seasonal_shift_hint') {
      scrollToDistrictIntelligenceSection();
      return;
    }
    handleStorylineFlowClick();
  }

  function showExploreSuccess(message: string) {
    if (exploreSuccessTimeoutRef.current) {
      clearTimeout(exploreSuccessTimeoutRef.current);
      exploreSuccessTimeoutRef.current = null;
    }
    setExploreSuccessMessage(message);
    exploreSuccessTimeoutRef.current = setTimeout(() => {
      setExploreSuccessMessage(null);
      exploreSuccessTimeoutRef.current = null;
    }, 3200);
  }

  function handleFindForStop(stop: Stop, index: number) {
    setFillStopId(stop.id);
    setFillStopIndex(index);
    setFillLabel(stop.label?.trim() ? stop.label.trim() : null);
    const query = stop.label ? getSlotQuery(stop.label) : null;
    const prefill = (query ?? stop.label ?? '').trim();
    setExploreQuery(prefill);
    if (prefill) {
      void runExploreSearch(prefill);
    } else {
      setExploreResults([]);
      setExploreError(null);
    }
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        exploreSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }
  }

  function resolveReplacementIndex(nextStops: Stop[]): number | null {
    const placeholderCandidates = nextStops
      .map((stop, index) => (isPlaceholderStop(stop) ? { stop, index } : null))
      .filter((candidate): candidate is { stop: Stop; index: number } => !!candidate);

    if (fillStopId) {
      const byIdIndex = nextStops.findIndex((stop) => stop.id === fillStopId);
      if (byIdIndex < 0) return null;
      return isPlaceholderStop(nextStops[byIdIndex]) ? byIdIndex : null;
    }

    if (typeof fillStopIndex === 'number') {
      if (fillStopIndex < 0 || fillStopIndex >= nextStops.length) return null;
      return isPlaceholderStop(nextStops[fillStopIndex]) ? fillStopIndex : null;
    }

    const normalizedFillLabel = normalizeLabel(fillLabel);
    if (normalizedFillLabel) {
      const matchIndices = (predicate: (label: string) => boolean) =>
        placeholderCandidates
          .filter(({ stop }) => predicate(normalizeLabel(stop.label)))
          .map(({ index }) => index);

      const exactMatches = matchIndices((label) => label === normalizedFillLabel);
      if (exactMatches.length === 1) return exactMatches[0];
      if (exactMatches.length > 1) return null;

      const startsWithMatches = matchIndices((label) => label.startsWith(normalizedFillLabel));
      if (startsWithMatches.length === 1) return startsWithMatches[0];
      if (startsWithMatches.length > 1) return null;

      const containsMatches = matchIndices((label) => label.includes(normalizedFillLabel));
      if (containsMatches.length === 1) return containsMatches[0];
      if (containsMatches.length > 1) return null;
    }

    return placeholderCandidates.length === 1 ? placeholderCandidates[0].index : null;
  }

  function addExploreResult(entity: Entity) {
    if (!plan) return;
    const activePlanId = planSource?.id ?? planId ?? routePlanId;
    if (!activePlanId) return;

    const nextStops = [...plan.stops];
    const replacementIndex = resolveReplacementIndex(nextStops);

    let targetStopId: string;
    let didReplace = false;

    if (replacementIndex !== null && replacementIndex >= 0 && replacementIndex < nextStops.length) {
      const prevStop = nextStops[replacementIndex];
      if (isPlaceholderStop(prevStop)) {
        targetStopId = prevStop.id;
        nextStops[replacementIndex] = {
          ...prevStop,
          label: entity.name,
          notes: '',
        };
        didReplace = true;
      }
    }

    if (!didReplace) {
      const newStop = createStop(entity.name);
      newStop.notes = '';
      nextStops.push(newStop);
      targetStopId = newStop.id;
    }

    const nextDraft: PlanDraft = { ...plan, stops: nextStops };
    const basePlan = buildPlanFromDraft(nextDraft, planSource, activePlanId);
    const entityMeta: StopMeta = {
      name: entity.name,
      location: entity.location,
      timeLabel: entity.timeLabel,
      cost: entity.cost,
      proximity: entity.proximity,
      lat: entity.lat,
      lng: entity.lng,
      entity: entity.location
        ? { location: entity.location, formatted_address: entity.location }
        : undefined,
    };
    const mergedStops = basePlan.stops.map((stop) => {
      const meta = stopMetaById.get(stop.id);
      return meta ? ({ ...stop, ...meta } as PlanStop) : stop;
    });
    const targetIndex = mergedStops.findIndex((stop) => stop.id === targetStopId);
    if (targetIndex >= 0) {
      mergedStops[targetIndex] = {
        ...mergedStops[targetIndex],
        ...entityMeta,
        name: entity.name,
        location: entity.location,
        notes: undefined,
      } as PlanStop;
    }
    const nextPlan: Plan = { ...basePlan, stops: mergedStops };

    setPlan((prev) => ({
      ...nextDraft,
      date: coalesceAnchor(prev?.date, nextDraft.date),
      time: coalesceAnchor(prev?.time, nextDraft.time),
      whenText: coalesceAnchor(prev?.whenText, nextDraft.whenText),
    }));
    setPlanId(activePlanId);
    setPlanSource(nextPlan);
    upsertRecentPlan(nextPlan);

    const successMessage = didReplace && fillLabel ? `Added to ${fillLabel}` : 'Added to plan';
    showExploreSuccess(successMessage);
    setExploreCollapsed(true);

    // Auto-advance fill context only after a safe replacement; otherwise clear.
    if (didReplace && replacementIndex !== null) {
      const nextIndex = nextStops.findIndex(
        (stop, idx) => idx > replacementIndex && isPlaceholderStop(stop)
      );
      if (nextIndex >= 0) {
        const nextStop = nextStops[nextIndex];
        setFillStopId(nextStop.id);
        setFillStopIndex(nextIndex);
        setFillLabel(nextStop.label?.trim() ? nextStop.label.trim() : null);
        return;
      }
    }
    setFillStopId(null);
    setFillStopIndex(null);
    setFillLabel(null);
  }

  const fillActionLabel = fillLabel?.trim() ? fillLabel.trim() : null;
  const hasFillContext =
    Boolean(fillStopId) ||
    typeof fillStopIndex === 'number' ||
    Boolean(fillActionLabel);
  const saveStatusLabel =
    saveStatus === 'saving'
      ? 'Saving...'
      : saveStatus === 'saved'
      ? 'Saved ✓'
      : saveStatus === 'error'
      ? "Couldn't save"
      : null;
  const saveStatusTone =
    saveStatus === 'error'
      ? 'text-amber-200'
      : saveStatus === 'saved'
      ? 'text-emerald-200'
      : 'text-slate-400';
  const placeholderEntries = stops
    .map((stop, index) => (isPlaceholderStop(stop) ? { stop, index } : null))
    .filter((entry): entry is { stop: Stop; index: number } => !!entry);
  const placeholderCount = placeholderEntries.length;
  const pickedStopsCount = stops.filter((stop) => getStopStatus(stop) === 'filled').length;
  const nextPlaceholderEntry = placeholderEntries[0] ?? null;
  const nextPlaceholderLabel = nextPlaceholderEntry?.stop.label?.trim() || 'Next stop';
  const nextPlaceholderAnchorId = nextPlaceholderEntry
    ? nextPlaceholderEntry.stop.id
      ? `stop-${nextPlaceholderEntry.stop.id}`
      : `stop-idx-${nextPlaceholderEntry.index}`
    : null;
  const shouldTightenPlanDetails =
    Boolean(plan?.title?.trim()) && Boolean(plan?.whenText?.trim() || plan?.notes?.trim());
  function handleJumpToNextPlaceholder() {
    if (!nextPlaceholderAnchorId || typeof document === 'undefined') return;
    document.getElementById(nextPlaceholderAnchorId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }

  const onTrackLines =
    guidance.affirmations.length > 0
      ? guidance.affirmations
      : ['Open canvas — add a few stops and I’ll help shape the flow.'];
  const hasDateAnchor = Boolean(plan?.date?.trim()) && Boolean(plan?.time?.trim());
  const hasWhenAnchor = Boolean(plan?.whenText?.trim());
  const isMissingAnchor = !hasDateAnchor && !hasWhenAnchor;
  const hasAnyStops = stops.length > 0;
  const hasAnyPlaceLite = stops.some((stop) => Boolean(stop.placeLite));
  const noSavedPlaces = hasAnyStops && !hasAnyPlaceLite;
  const completedSingleStop =
    plan?.planSignals.completed === true &&
    stops.length === 1 &&
    !shouldShowSecondStopRecommendation;
  const watchOutLines = [
    ...guidance.warnings,
    ...(isMissingAnchor ? ['Pick a date/time so the plan has an anchor.'] : []),
  ];
  const ideaCandidates = [
    ...guidance.suggestions,
    ...(noSavedPlaces
      ? ['Use Explore to collect options, then pick winners so Stops have real places.']
      : []),
    ...(completedSingleStop
      ? ['Next time, consider adding a second stop to make the plan feel complete.']
      : []),
    ...(packCoachNudge ? [packCoachNudge] : []),
  ];
  const ideaLines =
    ideaCandidates.length > 0
      ? ideaCandidates
      : ['I can suggest a flow once there are a few stops.'];
  const guidanceBulletLines = [
    ...onTrackLines.map((line) => `On track: ${line}`),
    ...watchOutLines.map((line) => `Watch: ${line}`),
    ...ideaLines.map((line) => `Try: ${line}`),
  ];
  const visibleGuidanceBulletLines = guidanceBulletLines.slice(0, 3);
  const hiddenGuidanceBulletLines = guidanceBulletLines.slice(3);
  const comparisonLocation =
    experiencePackLocation && experiencePackLocation.trim().toLowerCase() !== 'unknown'
      ? experiencePackLocation
      : null;
  const summaryWithMedian = experiencePackSummary as (ExperiencePackSummary & {
    median_stop_count?: number;
  }) | null;
  const nowForSeasonalContext = new Date();
  const currentMonthName = nowForSeasonalContext.toLocaleString(undefined, { month: 'long' });
  const currentSeasonLabel = getSeasonLabelFromMonth(nowForSeasonalContext.getMonth());
  const topDayNameByIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hasEarnedSeasonalContext = Boolean(seasonalContextSummary);
  const seasonalMode: 'earned' | 'preview' = hasEarnedSeasonalContext ? 'earned' : 'preview';
  const seasonalTrendWord = !seasonalContextSummary
    ? 'flat'
    : seasonalContextSummary.monthOverMonthDelta > 0
      ? 'up'
      : seasonalContextSummary.monthOverMonthDelta < 0
        ? 'down'
        : 'flat';
  const seasonalTopDayIndex =
    typeof seasonalContextSummary?.topDay === 'number' ? seasonalContextSummary.topDay : null;
  const seasonalTopDayName =
    typeof seasonalTopDayIndex === 'number' ? topDayNameByIndex[seasonalTopDayIndex] ?? null : null;
  const currentStopCount = stops.length;
  const currentStopTypeIds = stops
    .map((stop) => (typeof stop.stop_type_id === 'string' ? stop.stop_type_id.trim() : ''))
    .filter((stopTypeId) => stopTypeId.length > 0);
  const rawCoachSuggestions = buildV52CoachSuggestions({
    templateId: experiencePackTemplateId,
    locationLabel: comparisonLocation,
    hasAnchorDate: Boolean(plan?.date?.trim()),
    topDayOfWeek: seasonalContextSummary?.topDay ?? null,
    monthOverMonthDelta: seasonalContextSummary?.monthOverMonthDelta ?? null,
    currentStopCount,
    currentStopTypeIds,
    verticalStopTypes: (verticalTemplate?.stopTypes ?? []).map((stopType) => ({
      id: stopType.id,
      label: stopType.label ?? stopType.id,
    })),
    earnedSummary: packMode === 'earned' ? summaryWithMedian : null,
  });
  const coachSuggestions = rawCoachSuggestions
    .filter((suggestion, index, list) => list.findIndex((item) => item.id === suggestion.id) === index)
    .filter((suggestion) => {
      if (!shouldShowSecondStopRecommendation) return true;
      if (suggestion.id !== 'plan_strength_fragility') return true;
      return !suggestion.title.toLowerCase().includes('support stop');
    })
    .slice(0, 2);
  const visibleCoachSuggestions = coachSuggestions.filter(
    (suggestion) => !dismissedCoachSuggestionIds.includes(suggestion.id)
  );
  const hasPreviewCoachSuggestion = visibleCoachSuggestions.some(
    (suggestion) => suggestion.mode === 'preview'
  );
  const shouldShowExperiencePackCard = Boolean(planSource) && !isPackDraftDismissed;
  const shouldShowCoachSuggestionsCard = visibleCoachSuggestions.length > 0;
  const shouldShowSeasonalContextCard = Boolean(planSource) && Boolean(experiencePackTemplateId);
  const shouldShowComparisonCard = Boolean(planSource) && Boolean(experiencePackTemplateId);
  const shouldShowPlanIntelligence =
    shouldShowSecondStopRecommendation ||
    shouldShowExperiencePackCard ||
    shouldShowCoachSuggestionsCard ||
    shouldShowSeasonalContextCard ||
    shouldShowComparisonCard;
  const shouldShowReflection =
    hasLoadedReflection && (chosenNotCompleted.length > 0 || mostRevisited.length > 0);
  const storylineTypicalStops =
    typeof experiencePackDraft?.typicalStopsCount === 'number' ? experiencePackDraft.typicalStopsCount : 0;
  const storylineShouldEmphasizeTypical =
    storylineTypicalStops > 0 && currentStopCount < storylineTypicalStops;
  const storylineHasFlow = Boolean(
    experiencePackDraft && (experiencePackDraft.commonStopSequence ?? []).length > 0
  );
  const storylineFlowLabel = storylineHasFlow
    ? (() => {
        const labels = (experiencePackDraft?.commonStopSequence ?? [])
          .map((stopTypeId) => stopTypeLabelById.get(stopTypeId) ?? stopTypeId)
          .slice(0, 3);
        const hasMore = (experiencePackDraft?.commonStopSequence ?? []).length > 3;
        return hasMore ? `${labels.join(' -> ')} -> ...` : labels.join(' -> ');
      })()
    : 'Not enough data yet';
  const storylineHourBin = experiencePackDraft?.typicalHourBin ?? null;
  const storylineDistinctPlans = experiencePackDraft?.evidence.distinctPlans ?? 0;
  const comparisonLocationLabel = comparisonLocation ?? 'this location';
  const typicalStopsRaw =
    summaryWithMedian?.median_stop_count ?? summaryWithMedian?.recommended_stop_count ?? null;
  const typicalStops =
    typeof typicalStopsRaw === 'number' && Number.isFinite(typicalStopsRaw)
      ? Math.round(typicalStopsRaw)
      : null;
  const districtPulsePreviewTypicalStops =
    packMode === 'preview' && storylineTypicalStops > 0 ? storylineTypicalStops : null;
  const districtPulseHasPreview =
    !hasEarnedSeasonalContext ||
    typeof typicalStops !== 'number' ||
    !seasonalTopDayName ||
    typeof seasonalContextSummary?.monthOverMonthDelta !== 'number';
  const districtPulseThisMonthValue = hasEarnedSeasonalContext
    ? String(seasonalContextSummary?.currentMonthCount ?? 0)
    : '—';
  const districtPulseMoMValue = hasEarnedSeasonalContext
    ? `${(seasonalContextSummary?.monthOverMonthDelta ?? 0) >= 0 ? '+' : ''}${seasonalContextSummary?.monthOverMonthDelta ?? 0}`
    : '—';
  const districtPulseBusiestDayValue = hasEarnedSeasonalContext
    ? (seasonalTopDayName ?? '—')
    : '—';
  const districtPulseTypicalPlanValue =
    typeof typicalStops === 'number'
      ? `${typicalStops}`
      : typeof districtPulsePreviewTypicalStops === 'number'
        ? `${districtPulsePreviewTypicalStops}`
        : '—';
  const districtPulseInsightLine = !hasEarnedSeasonalContext
    ? 'More signal will appear as plans complete.'
    : (seasonalContextSummary?.monthOverMonthDelta ?? 0) >= 2
      ? 'Picking up this month.'
      : (seasonalContextSummary?.monthOverMonthDelta ?? 0) <= -2
        ? 'Cooling off this month.'
        : 'Stable lately.';
  const coachSuggestionDebugLine =
    visibleCoachSuggestions.length > 0
      ? visibleCoachSuggestions.map((suggestion) => `${suggestion.id}:${suggestion.mode}`).join(', ')
      : 'none';
  const snapshotTitle = plan.title.trim();
  const snapshotDistrict = plan.district?.trim() ?? '';
  const snapshotWhenText = plan.whenText?.trim() ?? '';
  const snapshotDate = formatSnapshotDate(plan.date);
  const snapshotTime = formatSnapshotTime(plan.time);
  const hasAnySnapshotFields = Boolean(
    snapshotTitle || snapshotDistrict || snapshotDate || snapshotTime || snapshotWhenText
  );
  const snapshotParts: string[] = [];
  if (!hasAnySnapshotFields) {
    snapshotParts.push('Draft plan - add a place and a time.');
  } else {
    snapshotParts.push(snapshotTitle || 'Untitled plan');
    if (snapshotDistrict) snapshotParts.push(`in ${snapshotDistrict}`);
    if (snapshotDate && snapshotTime) {
      snapshotParts.push(`on ${snapshotDate} at ${snapshotTime}`);
    } else if (snapshotDate && snapshotWhenText) {
      snapshotParts.push(`on ${snapshotDate} ${snapshotWhenText}`);
    } else if (snapshotDate) {
      snapshotParts.push(`on ${snapshotDate}`);
    } else if (snapshotTime) {
      snapshotParts.push(`at ${snapshotTime}`);
    } else if (snapshotWhenText) {
      snapshotParts.push(snapshotWhenText);
    }
  }
  const planSnapshotLine = hasAnySnapshotFields
    ? snapshotParts.join(', ')
    : snapshotParts[0];
  const guidanceBlock = (
    <section className="space-y-2 rounded-md bg-slate-950/25 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Guidance</h2>
        {guidance.hasTemplate ? (
          <span className="text-[10px] text-slate-500">{guidance.templateName}</span>
        ) : (
          <span className="text-[10px] text-slate-600">Generic</span>
        )}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-300">
        {visibleGuidanceBulletLines.map((line, index) => (
          <li key={`guidance-line-${index}`}>{line}</li>
        ))}
      </ul>
      {hiddenGuidanceBulletLines.length > 0 ? (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer font-medium text-slate-400 hover:text-slate-200">
            More
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-300">
            {hiddenGuidanceBulletLines.map((line, index) => (
              <li key={`guidance-line-hidden-${index}`}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );

  return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
          {/* Top nav */}
          <header className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="text-sm text-slate-300 hover:text-teal-300"
            >
              Back to home
            </button>
            <span className="text-xs text-slate-500">Waypoint - Plan</span>
          </header>

          {isReadOnly ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3">
              <div>Read-only. Copy to edit your own version.</div>
              <button
                type="button"
                onClick={handleCopyToEdit}
                className="inline-flex items-center justify-center rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold text-amber-100 hover:text-amber-50"
              >
                Copy to edit
              </button>
            </div>
          ) : null}

          {isDraftMode && !draftBannerDismissed ? (
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div>
                  You&apos;re planning in draft mode. Sign in to save and access this plan
                  anywhere.
                </div>
                <div className="text-[11px] text-slate-400">
                  You may briefly land on Home while signing in, then we&apos;ll return you
                  here.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push(signInHref)}
                  className="inline-flex items-center justify-center rounded-full bg-teal-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-teal-400"
                >
                  Sign in to save
                </button>
                <button
                  type="button"
                  onClick={() => setDraftBannerDismissed(true)}
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300 hover:text-slate-100"
                >
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-800/90 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-4 space-y-3 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.08)]">
            <header className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">Plan</h1>
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  Add another stop
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 uppercase tracking-wide text-slate-400">
                  {isReadOnly ? 'Read-only' : 'Editing'}
                </span>
                {experienceV2 ? (
                  <span className="text-slate-400">Experience: {experienceV2.title}</span>
                ) : null}
                <span className="text-slate-600">&middot;</span>
                <span className="text-slate-400">
                  Plan: {plan.title?.trim() ? plan.title : 'Name your plan'}
                </span>
              </div>
              {isActivePlan ? (
                <div className="text-[11px] text-slate-400">
                  <span className="uppercase tracking-wide text-slate-500">Active plan</span>
                  <span className="mx-2 text-slate-600">&middot;</span>
                  <span>This is the plan you&apos;re adding to from Home.</span>
                </div>
              ) : null}
            </header>

            <VerticalIdentityHeader verticalTemplate={verticalTemplate} />
            <p className="text-[11px] text-slate-400/90">{planSnapshotLine}</p>
            {guidanceBlock}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-200">Choose a toolkit</h2>
              <p className="text-xs text-slate-400">
                This changes guidance and storyline defaults for this plan.
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                  Guidance
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                  Storyline
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                  Signals
                </span>
              </div>
            </div>
            <div className="max-w-md space-y-1">
              <label
                htmlFor="plan-toolkit-select"
                className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Toolkit
              </label>
              <select
                id="plan-toolkit-select"
                value={toolkitSelectValue}
                disabled={isReadOnly}
                onChange={(event) => {
                  const raw = event.target.value;
                  const nextTemplateId = raw === 'generic' ? undefined : raw;
                  setSelectedStarterPackId('');
                  setHasUnsavedChanges(true);
                  updateField('template_id', nextTemplateId);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 focus-visible:ring-2 focus-visible:ring-teal-400/70 disabled:opacity-60"
              >
                <option value="generic">Generic</option>
                {toolkitOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {shouldShowStarterPackStep ? (
              <div className="ml-2 max-w-md space-y-1 border-l border-slate-800/80 pl-3">
                <label
                  htmlFor="plan-starter-pack-select"
                  className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  Starter pack (Idea-Date)
                </label>
                <select
                  id="plan-starter-pack-select"
                  value={selectedStarterPackId}
                  disabled={isReadOnly}
                  onChange={(event) => {
                    setSelectedStarterPackId(event.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 focus-visible:ring-2 focus-visible:ring-teal-400/70 disabled:opacity-60"
                >
                  <option value="">None</option>
                  {starterPackOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>

        {false ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">
              {packMode === 'preview'
                ? 'Experience Pack Draft (Preview)'
                : 'Experience pack draft'}
            </h2>
            {packMode === 'earned' && comparisonLocation ? (
              <p className="text-xs text-slate-400">
                Based on recently completed plans of this toolkit in {comparisonLocation}.
              </p>
            ) : null}
            {packMode === 'preview' ? (
              <div className="space-y-1 text-xs text-slate-400">
                <p>Not enough completed plans yet to assemble a reliable pack.</p>
                <p>
                  This starter structure is based on the toolkit template and will improve as more
                  plans are completed.
                </p>
              </div>
            ) : null}
            {!hasLoadedExperiencePack && packMode === 'preview' && experiencePackLocationKnown ? (
              <p className="text-xs text-slate-500">Loading pack...</p>
            ) : null}
            {!experiencePackDraft ? (
              <p className="text-xs text-slate-400">
                Pack draft is unavailable for this toolkit.
              </p>
            ) : (
              <div className="space-y-2 text-sm text-slate-300">
                <p>Usually {experiencePackDraft?.typicalStopsCount ?? 0} stops</p>
                <p>Common sequence: {experienceSequenceLabels}</p>
                {experiencePackDraft?.typicalHourBin ? (
                  <p>Often {experiencePackDraft?.typicalHourBin}</p>
                ) : null}
                {packMode === 'earned' ? (
                  <p className="text-xs text-slate-400">
                    Based on {experiencePackDraft?.evidence.distinctPlans ?? 0} completed plan(s) in{' '}
                    {experiencePackDraft?.city ?? comparisonLocation}.
                  </p>
                ) : null}
                <ul className="space-y-1 text-xs text-slate-400">
                  {(experiencePackDraft?.notes ?? []).map((note, index) => (
                    <li key={`plan-pack-note-${index}`}>• {note}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (experiencePackDraft) applyExperiencePackDraft(experiencePackDraft);
                    }}
                    disabled={isApplyingPack}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    {isApplyingPack ? 'Applying...' : justAppliedPack ? 'Applied ✓' : 'Apply draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPackDraftDismissed(true)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    Dismiss
                  </button>
                </div>
                {shouldLogVerticalDebug ? (
                  <p className="text-[10px] text-slate-500">
                    pack_mode: '{packMode}' | reason: '{experiencePackPreviewReason}' |
                    flip_condition: 'distinctCompletedPlans &gt;= 3 AND cityKnown'
                  </p>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {false ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">Coach suggestions</h2>
            <div className="space-y-2">
              {coachSuggestions.map((suggestion, index) => (
                <div
                  key={`${suggestion.id}-${index}`}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-slate-200">{suggestion.title}</p>
                    {suggestion.mode === 'preview' ? (
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
                        Preview
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-400">{suggestion.why}</p>
                </div>
              ))}
            </div>
            {shouldLogVerticalDebug ? (
              <p className="text-[10px] text-slate-500">
                recs: {coachSuggestionDebugLine} | derivedLocation: {comparisonLocation ?? 'unknown'} |
                template_id: {experiencePackTemplateId || 'unknown'}
              </p>
            ) : null}
          </section>
        ) : null}

        {false ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-200">Seasonal context</h2>
              <p className="text-xs text-slate-400">
                {currentMonthName} ({currentSeasonLabel})
              </p>
            </div>
            {!hasLoadedSeasonalContext ? (
              <p className="text-xs text-slate-500">Loading seasonal context...</p>
            ) : null}
            {hasLoadedSeasonalContext ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-slate-300">
                    {seasonalMode === 'earned'
                      ? `This month, completions for this toolkit in ${comparisonLocation ?? experiencePackLocation} are ${seasonalTrendWord} vs last month.`
                      : 'Seasonal trends will appear once more plans are completed.'}
                  </p>
                  {seasonalMode === 'earned' ? (
                    <p className="text-[11px] text-slate-500">
                      Why: based on completed plans for this toolkit in {comparisonLocation ?? experiencePackLocation}.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">Preview</p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-300">
                    {seasonalMode === 'earned' && seasonalTopDayName
                      ? `Most completions happen on ${seasonalTopDayName}.`
                      : 'Weekly patterns will appear once more plans are completed.'}
                  </p>
                  {seasonalMode === 'earned' ? (
                    <p className="text-[11px] text-slate-500">
                      Why: based on completed plans for this toolkit in {comparisonLocation ?? experiencePackLocation}.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">Preview</p>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Event overlay (Preview): Event overlays (festivals/holidays) will appear here once event sources are connected.
                </p>
                {shouldLogVerticalDebug ? (
                  <p className="text-[10px] text-slate-500">
                    template_id: {experiencePackTemplateId || 'unknown'} | derivedLocation:{' '}
                    {comparisonLocation ?? 'unknown'} | distinctPlans:{' '}
                    {seasonalContextSummary?.distinctPlans ?? 0} | currentMonthCount:{' '}
                    {seasonalContextSummary?.currentMonthCount ?? 0} | previousMonthCount:{' '}
                    {seasonalContextSummary?.previousMonthCount ?? 0} | topDay:{' '}
                    {typeof seasonalTopDayIndex === 'number'
                      ? (topDayNameByIndex[seasonalTopDayIndex as number] ?? seasonalTopDayIndex)
                      : 'none'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {false ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">Comparisons (Preview/Earned)</h2>
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-1">
                <p className="text-xs text-slate-300">
                  {typeof typicalStops === 'number'
                    ? `This plan vs typical: ${currentStopCount} stops vs usually ${typicalStops}.`
                    : 'This plan vs typical: appears once enough completed plans exist for this toolkit.'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {typeof typicalStops === 'number'
                    ? `Why: based on completed-plan stop-count signals in ${comparisonLocationLabel}.`
                    : 'Preview'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-1">
                <p className="text-xs text-slate-300">
                  This plan vs last time: appears once you&apos;ve completed 2+ plans of this
                  toolkit.
                </p>
                <p className="text-[11px] text-slate-500">Preview</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-1">
                <p className="text-xs text-slate-300">
                  {hasEarnedSeasonalContext
                    ? `This district vs baseline: ${comparisonLocationLabel} has ${seasonalContextSummary?.currentMonthCount ?? 0} completions this month vs ${seasonalContextSummary?.previousMonthCount ?? 0} last month.`
                    : !hasLoadedSeasonalContext
                      ? 'This district vs baseline: loading seasonal context...'
                      : 'This district vs baseline: appears once more plans are completed.'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {hasEarnedSeasonalContext
                    ? `Why: based on month-level completion signals in ${comparisonLocationLabel}.`
                    : 'Preview'}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {isSavedPlanRoute && plan ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-200">
                Close the loop (optional)
              </h2>
              <p className="text-[11px] text-slate-400">
                This helps Waypoint learn what worked so it can recommend better plans.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextChosen = !plan.planSignals.chosen;
                  const nextChosenAt = nextChosen ? new Date().toISOString() : null;
                  if (nextChosen && activePlanId) {
                    void logPlanSignal({
                      planId: activePlanId,
                      actorId: userId ?? undefined,
                      signalType: 'plan_chosen',
                      signalValue: null,
                    });
                  }
                  setPlan((prev) => {
                    if (!prev) return prev;
                    const nextDraft = {
                      ...prev,
                      planSignals: {
                        ...prev.planSignals,
                        chosen: nextChosen,
                        chosenAt: nextChosenAt,
                      },
                    };
                    persistDraft(nextDraft);
                    return nextDraft;
                  });
                }}
                aria-pressed={plan.planSignals.chosen}
                className={`rounded-full border px-3 py-1 text-[11px] transition ${
                  plan.planSignals.chosen
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Chosen
              </button>
              {hasOutcomePrompt ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500">Did this happen?</span>
                  <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/70 p-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        (() => {
                          const nextOutcome =
                            outcomeValue === 'completed' ? 'clear' : 'completed';
                          setOutcome(nextOutcome);
                          if (nextOutcome === 'completed' && activePlanId) {
                            void logPlanSignal({
                              planId: activePlanId,
                              actorId: userId ?? undefined,
                              signalType: 'plan_completed',
                              signalValue: null,
                            });
                          }
                        })()
                      }
                      aria-pressed={outcomeValue === 'completed'}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        outcomeValue === 'completed'
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        (() => {
                          const nextOutcome = outcomeValue === 'skipped' ? 'clear' : 'skipped';
                          setOutcome(nextOutcome);
                          if (nextOutcome === 'skipped' && activePlanId) {
                            void logPlanSignal({
                              planId: activePlanId,
                              actorId: userId ?? undefined,
                              signalType: 'plan_skipped',
                              signalValue: null,
                            });
                          }
                        })()
                      }
                      aria-pressed={outcomeValue === 'skipped'}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        outcomeValue === 'skipped'
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>
              ) : null}
              {hasSentimentPrompt ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500">How was it?</span>
                  <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/70 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const nextSentiment =
                          plan.planSignals.sentiment === 'positive' ? null : 'positive';
                        setSentiment(nextSentiment);
                        if (activePlanId) {
                          void logPlanSignal({
                            planId: activePlanId,
                            actorId: userId ?? undefined,
                            signalType: 'plan_sentiment',
                            signalValue: nextSentiment === 'positive' ? 'good' : null,
                          });
                        }
                      }}
                      aria-pressed={plan.planSignals.sentiment === 'positive'}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        plan.planSignals.sentiment === 'positive'
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Good
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSentiment =
                          plan.planSignals.sentiment === 'neutral' ? null : 'neutral';
                        setSentiment(nextSentiment);
                        if (activePlanId) {
                          void logPlanSignal({
                            planId: activePlanId,
                            actorId: userId ?? undefined,
                            signalType: 'plan_sentiment',
                            signalValue: nextSentiment === 'neutral' ? 'ok' : null,
                          });
                        }
                      }}
                      aria-pressed={plan.planSignals.sentiment === 'neutral'}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        plan.planSignals.sentiment === 'neutral'
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSentiment =
                          plan.planSignals.sentiment === 'negative' ? null : 'negative';
                        setSentiment(nextSentiment);
                        if (activePlanId) {
                          void logPlanSignal({
                            planId: activePlanId,
                            actorId: userId ?? undefined,
                            signalType: 'plan_sentiment',
                            signalValue: nextSentiment === 'negative' ? 'bad' : null,
                          });
                        }
                      }}
                      aria-pressed={plan.planSignals.sentiment === 'negative'}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        plan.planSignals.sentiment === 'negative'
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Bad
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {false ? (
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" open={false}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-200">
              Recent activity ({recentActivity.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              {recentActivity.map((row) => {
                const dateLabel = row.completedAt
                  ? new Date(row.completedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Unknown date';
                const sentimentLabel =
                  row.sentiment === 'positive'
                    ? 'Good'
                    : row.sentiment === 'neutral'
                      ? 'OK'
                      : row.sentiment === 'negative'
                        ? 'Bad'
                        : row.sentiment === 'good'
                          ? 'Good'
                          : row.sentiment === 'ok'
                            ? 'OK'
                            : row.sentiment === 'bad'
                              ? 'Bad'
                              : null;
                return (
                  <li
                    key={`${row.planId}-${row.completedAt}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-100">
                        {row.title ?? 'Untitled plan'}
                      </span>
                      <span className="text-[11px] text-slate-400">Completed {dateLabel}</span>
                    </div>
                    {sentimentLabel ? (
                      <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
                        {sentimentLabel}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}

        {false ? (
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" open={false}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-200">
              Reflection ({chosenNotCompleted.length + mostRevisited.length})
            </summary>
            <div className="mt-3 space-y-4">
            {chosenNotCompleted.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  Chosen, not completed
                </p>
                <ul className="space-y-2 text-sm text-slate-200">
                  {chosenNotCompleted.map((row) => {
                    const dateLabel = row.chosenAt
                      ? new Date(row.chosenAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Unknown date';
                    const sentimentLabel =
                      row.sentiment === 'positive'
                        ? 'Good'
                        : row.sentiment === 'neutral'
                          ? 'OK'
                          : row.sentiment === 'negative'
                            ? 'Bad'
                            : row.sentiment === 'good'
                              ? 'Good'
                              : row.sentiment === 'ok'
                                ? 'OK'
                                : row.sentiment === 'bad'
                                  ? 'Bad'
                                  : null;
                    return (
                      <li
                        key={`${row.planId}-${row.chosenAt}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-100">
                            {row.title ?? 'Untitled plan'}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Chosen {dateLabel}
                          </span>
                        </div>
                        {sentimentLabel ? (
                          <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
                            {sentimentLabel}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {mostRevisited.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  Most revisited
                </p>
                <ul className="space-y-2 text-sm text-slate-200">
                  {mostRevisited.map((row) => {
                    const dateLabel = row.lastViewedAt
                      ? new Date(row.lastViewedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Unknown date';
                    return (
                      <li
                        key={`${row.planId}-${row.lastViewedAt}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-100">
                            {row.title ?? 'Untitled plan'}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Views: {row.viewCount} · Last viewed {dateLabel}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            </div>
          </details>
        ) : null}

        <section
          className={`space-y-3 rounded-xl border bg-slate-900/60 ${
            shouldTightenPlanDetails ? 'border-slate-800/70 p-2.5' : 'border-slate-800 p-3'
          }`}
        >
          <div className="space-y-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Plan details
            </h2>
            {!shouldTightenPlanDetails ? (
              <p className="text-[11px] text-slate-400">
                Build your plan here - search and fill stops without leaving the page.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="title">
              Plan name
            </label>
            <input
              id="title"
              name="title"
              form="plan-form"
              type="text"
              value={plan.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Date night, Birthday dinner, Anniversary..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="when-text">
                When?
              </label>
              <input
                id="when-text"
                name="when-text"
                form="plan-form"
                type="text"
                value={plan.whenText ?? ''}
                onChange={(e) => updateField('whenText', e.target.value)}
                placeholder="This weekend, Friday night, Surprise me..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="notes">
                Intent (optional)
              </label>
              <textarea
                id="notes"
                name="notes"
                form="plan-form"
                value={plan.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="Quick night out, celebrate a birthday, show a friend around..."
                className="w-full min-h-[72px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>
        </section>

        <div className="grid gap-3 lg:gap-4 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="order-1 lg:order-2">
            <section
              className={`space-y-3 rounded-xl border p-4 ${
                hasFillContext
                  ? 'border-teal-400/60 bg-teal-500/10'
                  : 'border-slate-800 bg-slate-900/50'
              } ${hasFillContext ? 'lg:sticky lg:top-6 lg:self-start' : ''}`}
            >
              <section ref={exploreSectionRef} className="space-y-3">
            <div className="h-px bg-slate-800/80" aria-hidden />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-100">Explore</h2>
                <p className="text-[11px] text-slate-400">Search without leaving this plan.</p>
              </div>
            </div>
          {fillActionLabel ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-teal-400/60 bg-teal-500/15 px-3 py-2 text-xs text-teal-100">
              <span className="truncate">Filling: {fillActionLabel}</span>
              <button
                type="button"
                onClick={() => {
                  setFillStopId(null);
                  setFillStopIndex(null);
                  setFillLabel(null);
                }}
                className="inline-flex items-center justify-center rounded-md border border-teal-300/40 px-2 py-0.5 text-[11px] font-semibold text-teal-100 hover:border-teal-200 hover:bg-teal-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
              >
                Clear
              </button>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={exploreQuery}
              onChange={(e) => {
                setExploreCollapsed(false);
                setExploreQuery(e.target.value);
              }}
              onFocus={() => {
                if (fillActionLabel) return;
                const defaultQuery =
                  experienceDefaultQuery || templateDefaultQuery || organicDefaultQuery;
                if (!exploreQuery.trim() && defaultQuery) {
                  setExploreCollapsed(false);
                  setExploreQuery(defaultQuery);
                }
              }}
              placeholder="Search for a place..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
            />
            <button
              type="button"
              onClick={() => {
                setExploreCollapsed(false);
                const queryToRun =
                  exploreQuery.trim() ||
                  experienceDefaultQuery ||
                  templateDefaultQuery ||
                  organicDefaultQuery;
                if (!exploreQuery.trim() && queryToRun) {
                  setExploreQuery(queryToRun);
                }
                void runExploreSearch(queryToRun);
              }}
              disabled={exploreLoading}
              className="inline-flex items-center justify-center rounded-lg border border-teal-400/60 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-200 hover:border-teal-300 hover:text-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exploreLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {exploreSuccessMessage ? (
            <div className="flex flex-col gap-2 rounded-lg border border-teal-400/40 bg-teal-500/10 px-3 py-2 text-xs text-teal-100 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-medium">{exploreSuccessMessage}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={scrollToStopsSection}
                  className="inline-flex items-center justify-center rounded-md border border-teal-300/60 px-2.5 py-1 text-[11px] font-semibold text-teal-100 hover:border-teal-200 hover:bg-teal-400/10"
                >
                  Continue
                </button>
                {placeholderCount > 0 && nextPlaceholderEntry ? (
                  <button
                    type="button"
                    onClick={() => handleFindForStop(nextPlaceholderEntry.stop, nextPlaceholderEntry.index)}
                    className="inline-flex items-center justify-center rounded-md border border-teal-300/40 px-2.5 py-1 text-[11px] font-semibold text-teal-100 hover:border-teal-200 hover:bg-teal-400/10"
                  >
                    Find next placeholder
                  </button>
                ) : null}
              </div>
            </div>
          ) : placeholderCount > 0 && nextPlaceholderEntry && nextPlaceholderAnchorId ? (
            <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-slate-200">
                Needs selection: {placeholderCount}
                <span className="ml-2 text-slate-400">Next: {nextPlaceholderLabel}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleFindForStop(nextPlaceholderEntry.stop, nextPlaceholderEntry.index)}
                  className="inline-flex items-center justify-center rounded-md border border-teal-400/60 bg-teal-500/10 px-2.5 py-1 text-[11px] font-semibold text-teal-200 hover:border-teal-300 hover:text-teal-100"
                >
                  Find for this
                </button>
                <button
                  type="button"
                  onClick={handleJumpToNextPlaceholder}
                  className="inline-flex items-center justify-center rounded-md border border-slate-600 px-2.5 py-1 text-[11px] font-semibold text-slate-100 hover:border-slate-500 hover:bg-slate-800/60"
                >
                  Jump to next
                </button>
              </div>
            </div>
          ) : null}
          {experienceV2 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
              <span>Experience: {experienceV2.title}</span>
              {experienceDefaultQuery ? (
                <>
                  <span className="text-slate-600">&middot;</span>
                  <span>Try: &apos;{experienceDefaultQuery}&apos;</span>
                </>
              ) : null}
            </div>
          ) : templateV2 && discoveryPresetV2 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
              <span>Template: {templateV2.name}</span>
              <span className="text-slate-600">&middot;</span>
              <span>Try: &apos;{templateDefaultQuery}&apos;</span>
            </div>
          ) : organicDefaultQuery ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
              <span>Try: &apos;{organicDefaultQuery}&apos;</span>
            </div>
          ) : null}
          {exploreCollapsed ? <div className="border-t border-slate-800/80 pt-1" /> : null}
          {exploreError ? <p className="text-xs text-amber-200">{exploreError}</p> : null}
          {exploreResults.length > 0 && !exploreCollapsed ? (
            <ul className="space-y-2">
              {exploreResults.slice(0, 6).map((result) => (
                <li
                  key={result.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {result.name}
                    </p>
                    {(() => {
                      const typeLabel = formatTypeLabel(result.tags?.[0]);
                      const address = getBestAddress(result);
                      if (!typeLabel && !address) return null;
                      return (
                        <p className="truncate text-[11px] text-slate-400">
                          {[typeLabel, address].filter(Boolean).join(' · ')}
                        </p>
                      );
                    })()}
                    {(() => {
                      const description = readString(result.description);
                      if (!description) return null;
                      const normalizedDescription = normalizeLabel(description);
                      const normalizedName = normalizeLabel(result.name);
                      const normalizedAddress = normalizeLabel(getBestAddress(result) || '');
                      if (
                        !normalizedDescription ||
                        normalizedDescription === normalizedName ||
                        normalizedDescription === normalizedAddress ||
                        normalizedName.includes(normalizedDescription) ||
                        normalizedDescription.includes(normalizedName)
                      ) {
                        return null;
                      }
                      return (
                        <p className="truncate text-[11px] text-slate-500">
                          {description}
                        </p>
                      );
                    })()}
                    {renderPlacesCapsule({
                      sourceObj: result,
                      fallbackQuery: (() => {
                        const address = getBestAddress(result);
                        return address ? `${result.name} ${address}` : result.name;
                      })(),
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addExploreResult(result)}
                    className="inline-flex shrink-0 items-center justify-center rounded-md border border-teal-400/70 bg-teal-500/10 px-2.5 py-1 text-[11px] font-semibold text-teal-200 hover:border-teal-300 hover:text-teal-100"
                  >
                    {fillActionLabel ? `Add to ${fillActionLabel}` : 'Add to plan'}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
              </section>

              {placeholderStops.length > 0 ? (
                <section className="space-y-2 pt-3 border-t border-slate-800/70">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Next stops
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {placeholderStops.map((stop, index) => (
                      <div
                        key={stop.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-100">
                            {stop.label || `Stop ${index + 1}`}
                          </p>
                          {stop.notes ? (
                            <p className="text-[11px] text-slate-400">{stop.notes}</p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleFindForStop(stop, index)}
                            className="text-[11px] font-semibold text-teal-200 hover:text-teal-100"
                          >
                            Find for this
                          </button>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                          {index === 0 ? 'anchor' : 'support'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </section>
          </div>

          <div className="order-2 lg:order-1 space-y-3 lg:space-y-4">

        {/* Validation banner */}
        {hasTriedSubmit && !isCoreInfoValid && (
          <div className="rounded-lg border border-amber-500/70 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            To save or share this plan, please add both a{' '}
            <span className="font-semibold">date</span> and{' '}
            <span className="font-semibold">time</span>.
          </div>
        )}


        <form id="plan-form" onSubmit={handleSave} className="space-y-6">
          <fieldset
            disabled={isReadOnly}
            className={isReadOnly ? 'opacity-70 pointer-events-none' : undefined}
          >
          {/* Core details */}
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="date">
                  Date <span className="text-xs text-slate-500">(required)</span>
                </label>
                <input
                  id="date"
                  type="date"
                  value={plan.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  required
                  style={{ colorScheme: 'dark' }} // ✅ makes picker icon visible
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 bg-slate-950 text-slate-100 ${
                    hasTriedSubmit && !isDateValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400'
                      : 'border-slate-700 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                />
                {hasTriedSubmit && !isDateValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a date for this plan.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="time">
                  Time <span className="text-xs text-slate-500">(required)</span>
                </label>
                <input
                  id="time"
                  type="time"
                  value={plan.time}
                  onChange={(e) => updateField('time', e.target.value)}
                  required
                  style={{ colorScheme: 'dark' }} // ✅ makes picker icon visible
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 bg-slate-950 text-slate-100 ${
                    hasTriedSubmit && !isTimeValid
                      ? 'border-red-500 focus:border-red-400 focus:ring-red-400'
                      : 'border-slate-700 focus:border-teal-400 focus:ring-teal-400'
                  }`}
                />
                {hasTriedSubmit && !isTimeValid && (
                  <p className="text-[11px] text-red-300">
                    Please choose a time for this plan.
                  </p>
                )}
              </div>
            </div>

            {/* Map preview */}
            <div className="space-y-2 pt-1">
              <h2 className="text-sm font-semibold text-slate-100">Map Preview</h2>
              {mapPreviewStops.length > 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <ul className="space-y-2">
                    {mapPreviewStops.slice(0, 3).map((stop) => (
                      <li key={stop.id} className="text-xs text-slate-300">
                        <span className="font-medium text-slate-200">
                          {stop.title}
                        </span>
                        <span className="text-slate-500"> — {stop.locationLine}</span>
                      </li>
                    ))}
                  </ul>
                  {mapPreviewStops.length > 3 ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      +{mapPreviewStops.length - 3} more
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No location available for map preview yet.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="attendees">
                Who’s coming? (optional)
              </label>
              <input
                id="attendees"
                type="text"
                value={plan.attendees}
                onChange={(e) => updateField('attendees', e.target.value)}
                placeholder="Alex, Sam, Taylor..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </section>

          {/* Stops */}
          <section
            id="stops-section"
            className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Stops</h2>
                <p className="text-xs text-slate-400">
                  Break the night into simple stops: drinks, dinner, dessert, scenic walk...
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                    {stops.length} stops
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                    {pickedStopsCount} places picked
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={addStop}
                className="inline-flex items-center rounded-lg border border-teal-500/70 bg-teal-500/10 px-3 py-2 text-xs font-medium text-teal-300 hover:bg-teal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
              >
                + Add stop
              </button>
            </div>

            <div className="space-y-2">
              {plan.stops.map((stop, index) => {
                const status = getStopStatus(stop);
                const isRecentlyAddedStop = recentlyAddedStopIds.includes(stop.id);
                const isActiveFillTarget =
                  status === 'placeholder' &&
                  ((fillStopId && stop.id === fillStopId) ||
                    (typeof fillStopIndex === 'number' && fillStopIndex === index));
                return (
                <div
                  key={stop.id}
                  id={stop.id ? `stop-${stop.id}` : `stop-idx-${index}`}
                  className={`space-y-3 rounded-lg border p-3 ${
                    status === 'placeholder'
                      ? 'border-dashed border-slate-700/70 bg-slate-950/25'
                      : 'border-slate-700 bg-slate-950/60'
                  } ${isActiveFillTarget ? 'border-teal-400/70 bg-teal-500/10' : ''} ${
                    isRecentlyAddedStop
                      ? 'ring-2 ring-slate-300/70 bg-slate-800/70 animate-pulse transition-all duration-500'
                      : ''
                  }`}
                >
                  {(() => {
                    const meta = stopMetaById.get(stop.id) as StopMeta | undefined;
                    const title = stop.label || meta?.name || `Stop ${index + 1}`;
                    const statusLabel =
                      status === 'placeholder' ? 'Needs selection' : 'Selected';
                    const timeLabel = meta?.timeLabel || meta?.duration || stop.time || '';
                    const decisionHint = meta?.cost
                      ? `Price: ${labelCost(meta.cost)}`
                      : timeLabel
                      ? `Hours: ${timeLabel}`
                      : meta?.proximity
                      ? labelProximity(meta.proximity)
                      : 'Popular nearby';
                    const locationLine =
                      status === 'filled' ? getStopLocationLine({ ...stop, ...meta }) : null;
                    const placeId =
                      status === 'filled'
                        ? stop.placeRef?.placeId ?? resolvedPlaceIdsRef.current.get(stop.id) ?? null
                        : null;
                    const placeQuery =
                      status === 'filled'
                        ? getPlaceQuery(meta ?? {}) || [title, locationLine].filter(Boolean).join(' ')
                        : null;
                    const placeLite = stop.placeLite ?? null;
                    const imageUrl =
                      placeLite?.photoUrl ?? meta?.imageUrl ?? meta?.photoUrl ?? meta?.image ?? undefined;
                    const hasRealImage = Boolean(imageUrl && imageUrl.trim().length > 0);
                    const fallbackImage = getPlaceFallbackImage({
                      types: placeLite?.types ?? null,
                      label: title,
                      category: meta?.categoryLabel ?? meta?.category ?? meta?.type ?? null,
                    });
                    const displayImage = hasRealImage ? imageUrl : fallbackImage;
                    const peekSummary =
                      placeLite?.editorialSummary?.trim() ||
                      summarizeTypes(placeLite?.types ?? null);
                    const peekOpenNow =
                      typeof placeLite?.openingHours?.openNow === 'boolean'
                        ? placeLite.openingHours.openNow
                        : null;
                    const hasPeekPhoto = Boolean(placeLite?.photoUrl);
                    const hasPeek = Boolean(
                      hasPeekPhoto || peekSummary || peekOpenNow !== null
                    );
                    const rating = placeLite?.rating;
                    const ratingCount = placeLite?.userRatingsTotal;
                    const priceLevel = placeLite?.priceLevel ?? null;
                    const costLabel =
                      meta?.cost
                        ? labelCost(meta.cost)
                        : priceLevel !== null
                        ? priceLevel === 0
                          ? 'Free'
                          : priceToDollars(priceLevel)
                        : null;
                    const addressLine = getStopAddress(stop) ?? null;
                    const website = getStopWebsiteHref(stop);
                    const mapUrl = getStopMapHref(stop);
                    const googlePlacesUrl =
                      placeLite?.googleMapsUrl?.trim() ? placeLite.googleMapsUrl : null;
                    const hasDetails =
                      Boolean(addressLine) ||
                      Boolean(costLabel) ||
                      rating !== undefined ||
                      Boolean(mapUrl) ||
                      Boolean(googlePlacesUrl) ||
                      Boolean(website);
                    const isDetailsLoading =
                      status === 'filled' &&
                      Boolean(placeId) &&
                      !hasDetails &&
                      loadingPlaceIds.has(placeId ?? '');
                    const categoryChip =
                      meta?.categoryLabel || meta?.category || meta?.type || '';
                    const rawLocationChip = meta?.location || '';
                    const normalizedLocationLine = normalizeLabel(locationLine || '');
                    const normalizedLocationChip = normalizeLabel(rawLocationChip || '');
                    const locationChip =
                      status === 'filled' ||
                      (normalizedLocationLine &&
                        normalizedLocationLine === normalizedLocationChip)
                        ? ''
                        : rawLocationChip;
                    const chips = [categoryChip, locationChip].filter(Boolean).slice(0, 2);
                    return (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="h-12 w-12 shrink-0 rounded-md border border-slate-800 bg-slate-900/70 overflow-hidden">
                            {displayImage ? (
                              // eslint-disable-next-line @next/next/no-img-element -- small, dynamic image
                              <img
                                src={displayImage}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-full w-full bg-slate-800/60 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-400">
                                <span className="text-[11px]">◆</span>
                                <span className="px-1 text-center truncate max-w-11">
                                  {categoryChip || 'Place'}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-sm font-semibold text-slate-100 truncate">
                                {title}
                              </p>
                              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-400">
                                {statusLabel}
                              </span>
                              {isActiveFillTarget ? (
                                <span className="inline-flex items-center rounded-full border border-teal-400/60 bg-teal-500/10 px-2 py-0.5 text-[9px] font-semibold text-teal-200 uppercase tracking-wide">
                                  Filling now
                                </span>
                              ) : null}
                              {status === 'filled' && mapUrl ? (
                                <a
                                  href={mapUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] font-semibold text-teal-200 hover:text-teal-100"
                                >
                                  Map
                                </a>
                              ) : null}
                            </div>
                            {status === 'placeholder' ? (
                              <p className="text-[11px] italic text-slate-500 truncate">
                                Placeholder - pick a place from Explore.
                              </p>
                            ) : null}
                            {status === 'placeholder' && stop.notes ? (
                              <p className="text-[11px] text-slate-500 truncate">
                                {stop.notes}
                              </p>
                            ) : null}
                            {status === 'placeholder' ? (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => handleFindForStop(stop, index)}
                                  className="text-[11px] font-semibold text-teal-200 hover:text-teal-100"
                                >
                                  Find for this
                                </button>
                              </div>
                            ) : null}
                            {locationLine ? (
                              <p className="text-[11px] text-slate-500 truncate">
                                {locationLine}
                              </p>
                            ) : null}
                            {status === 'filled' && (addressLine || rating !== undefined) ? (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                {rating !== undefined ? (
                                  <span>
                                    Rating {rating.toFixed(1)}
                                    {ratingCount ? ` (${ratingCount.toLocaleString()})` : ''}
                                  </span>
                                ) : null}
                                {addressLine ? (
                                  <span className="truncate">{addressLine}</span>
                                ) : null}
                              </div>
                            ) : null}
                            {chips.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {chips.map((chip) => (
                                  <span
                                    key={chip}
                                    className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300 truncate max-w-40"
                                    title={chip}
                                  >
                                    {chip}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <p className="text-[11px] text-slate-500">{decisionHint}</p>
                            {status === 'filled' && hasPeek ? (
                              <div className="flex items-start gap-2 text-[11px] text-slate-400">
                                {(placeLite?.photoUrl || fallbackImage) ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- small, optional thumbnail
                                  <img
                                    src={placeLite?.photoUrl ?? fallbackImage}
                                    alt=""
                                    className="h-10 w-10 rounded-md border border-slate-800 object-cover"
                                    loading="lazy"
                                  />
                                ) : null}
                                <div className="space-y-0.5">
                                  {peekSummary ? (
                                    <p className="text-slate-300 line-clamp-1">
                                      {peekSummary}
                                    </p>
                                  ) : null}
                                  {peekOpenNow !== null ? (
                                    <p className="text-[10px] text-slate-500">
                                      {peekOpenNow ? 'Open now' : 'Closed now'}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                            {isDetailsLoading ? (
                              <p className="text-[11px] text-slate-500">Loading details...</p>
                            ) : null}
                            {status === 'filled' && hasDetails ? (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenDetailsStopId((prev) =>
                                      prev === stop.id ? null : stop.id
                                    )
                                  }
                                  aria-expanded={openDetailsStopId === stop.id}
                                  aria-controls={`stop-details-${stop.id}`}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-slate-100"
                                >
                                  Details
                                  <span className="text-[10px]">
                                    {openDetailsStopId === stop.id ? '▲' : '▼'}
                                  </span>
                                </button>
                                {openDetailsStopId === stop.id ? (
                                  <div
                                    id={`stop-details-${stop.id}`}
                                    className="mt-2 space-y-1 text-[11px] text-slate-400"
                                  >
                                    {addressLine ? (
                                      <p className="text-slate-300">{addressLine}</p>
                                    ) : null}
                                    {costLabel ? <p>Price: {costLabel}</p> : null}
                                    {rating !== undefined ? (
                                      <p>
                                        Rating: {rating.toFixed(1)}
                                        {ratingCount ? ` (${ratingCount})` : ''}
                                      </p>
                                    ) : null}
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      {googlePlacesUrl ? (
                                        <a
                                          href={googlePlacesUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-teal-200 hover:text-teal-100"
                                        >
                                          Google Places
                                        </a>
                                      ) : null}
                                      {mapUrl ? (
                                        <a
                                          href={mapUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-teal-200 hover:text-teal-100"
                                        >
                                          Map
                                        </a>
                                      ) : null}
                                      {website ? (
                                        <a
                                          href={website}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-teal-200 hover:text-teal-100"
                                        >
                                          Website
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {status === 'filled'
                              ? (() => {
                                  if (!placeLite) return null;
                                  return renderPlacesCapsule({
                                    sourceObj: {
                                      place_id: placeLite.placeId,
                                      name: placeLite.name,
                                      formatted_address: placeLite.formattedAddress,
                                      rating: placeLite.rating,
                                      user_ratings_total: placeLite.userRatingsTotal,
                                      price_level: placeLite.priceLevel,
                                      url: placeLite.googleMapsUrl,
                                      website: placeLite.website,
                                    },
                                    fallbackQuery: placeQuery || title,
                                  });
                                })()
                              : null}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-slate-300">
                        Stop {index + 1}
                      </p>
                      <span className="inline-flex items-center">
                        <StopTypeBadge
                          label={resolveStopTypeLabel(
                            verticalTemplate,
                            stop,
                            'Unclassified'
                          )}
                        />
                      </span>
                      {isSeedHelperEnabled && stop.placeRef?.placeId ? (
                        <button
                          type="button"
                          onClick={() => {
                            const seedPlaceId = getStopCanonicalPlaceId(stop);
                            if (!seedPlaceId || typeof navigator === 'undefined') return;
                            const seedMeta = stopMetaById.get(stop.id) as StopMeta | undefined;
                            const seedRole: 'anchor' | 'support' | 'optional' =
                              seedMeta?.role ?? (index === 0 ? 'anchor' : 'support');
                            const seedPlaceLabel =
                              readString(seedMeta?.name) ||
                              readString(stop.label) ||
                              null;
                            const seedResolveQuery = readString(stop.resolve?.q) || undefined;
                            const seedResolveNear = readString(stop.resolve?.near) || undefined;
                            const seedIsPlaceholder = Boolean(stop.resolve?.placeholder);
                            const seedStop: Record<string, unknown> = {
                              label: stop.label || seedMeta?.name || `Stop ${index + 1}`,
                              role: seedRole,
                              placeRef: {
                                provider: 'google',
                                placeId: seedPlaceId,
                                ...(seedPlaceLabel ? { label: seedPlaceLabel } : {}),
                              },
                              ...(seedResolveQuery ? { resolveQuery: seedResolveQuery } : {}),
                              ...(seedResolveNear ? { resolveNear: seedResolveNear } : {}),
                              ...(seedIsPlaceholder ? { isPlaceholder: true } : {}),
                            };
                            const payload = JSON.stringify(seedStop, null, 2);
                            navigator.clipboard?.writeText?.(payload);
                          }}
                          className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        >
                          Copy seed JSON
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 'up')}
                        aria-label={`Move stop ${index + 1} up`}
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80 disabled:opacity-40"
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 'down')}
                        aria-label={`Move stop ${index + 1} down`}
                        className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80 disabled:opacity-40"
                        disabled={index === plan.stops.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStop(stop.id)}
                        className="rounded-md border border-red-700/70 px-2 py-1 text-[10px] text-red-300 hover:bg-red-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1.3fr,0.7fr] gap-3">
                    <div className="space-y-1.5">
                      <label
                        className="text-[11px] font-medium"
                        htmlFor={`stop-label-${stop.id}`}
                      >
                        Label
                      </label>
                      <input
                        id={`stop-label-${stop.id}`}
                        type="text"
                        value={stop.label}
                        onChange={(e) =>
                          updateStop(stop.id, { label: e.target.value })
                        }
                        placeholder="e.g. Drinks, Dinner, Dessert, Scenic viewpoint"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        className="text-[11px] font-medium"
                        htmlFor={`stop-time-${stop.id}`}
                      >
                        Time (optional)
                      </label>
                      <input
                        id={`stop-time-${stop.id}`}
                        type="time"
                        value={stop.time ?? ''}
                        onChange={(e) =>
                          updateStop(stop.id, { time: e.target.value })
                        }
                        style={{ colorScheme: 'dark' }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-[11px] font-medium"
                      htmlFor={`stop-notes-${stop.id}`}
                    >
                      Notes (optional)
                    </label>
                    <textarea
                      id={`stop-notes-${stop.id}`}
                      value={stop.notes ?? ''}
                      onChange={(e) =>
                        updateStop(stop.id, { notes: e.target.value })
                      }
                      placeholder="Parking, dress code, conversation idea, backup plan…"
                      className="w-full min-h-[60px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
                    />
                  </div>
                </div>
              )})}
            </div>
          </section>

          {hasUnsavedChanges ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              <p className="text-[10px] uppercase tracking-wide text-amber-200">
                Unsaved changes
              </p>
              <p>Stops and edits won&apos;t persist until you click Save.</p>
              <p className="text-[10px] text-amber-200/80">
                Refreshing will discard changes.
              </p>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span />
            <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>

              {isSavedPlanRoute ? (
                <button
                  type="button"
                    onClick={handleShareClick}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Share
                  </button>
              ) : null}

            {SHARE_ENABLED ? (
              <button
                type="button"
                onClick={handleShareClick}
                disabled={isSaving}
                className="rounded-lg border border-violet-400/70 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-50 hover:bg-violet-500/40 disabled:opacity-60"
              >
                {isSaving ? 'Sharing…' : 'Share this version'}
              </button>
            ) : null}

            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save plan'}
            </button>
            {saveStatusLabel ? (
              <span className={`text-[11px] ${saveStatusTone}`}>{saveStatusLabel}</span>
            ) : null}
          </div>
          </div>
          </fieldset>
        </form>
        {shouldShowPlanIntelligence ? (
          <section
            id="plan-intelligence-section"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-200">Plan Intelligence</h2>
            </div>
            <section className="space-y-3">
              {shouldShowExperiencePackCard ? (
                <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-200">Suggested storyline</h3>
                    {packMode === 'preview' ? (
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        Preview
                      </span>
                    ) : null}
                  </div>
                  {!experiencePackTemplateId ? (
                    <p className="text-xs text-slate-400">
                      Pick a toolkit to unlock a starter draft.
                    </p>
                  ) : (
                    <>
                      {!experiencePackDraft ? (
                        <p className="text-xs text-slate-400">
                          Pack draft is unavailable for this toolkit.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (experiencePackDraft) applyExperiencePackDraft(experiencePackDraft);
                              }}
                              disabled={isApplyingPack || !experiencePackDraft}
                              aria-disabled={isApplyingPack || !experiencePackDraft}
                              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                                storylineShouldEmphasizeTypical
                                  ? 'border-teal-500/70 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'
                                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${(isApplyingPack || !experiencePackDraft) ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              Typical: {storylineTypicalStops} stops
                            </button>
                            <button
                              type="button"
                              onClick={handleStorylineFlowClick}
                              disabled={!storylineHasFlow}
                              aria-disabled={!storylineHasFlow}
                              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                                storylineHasFlow
                                  ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                  : 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-500'
                              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70`}
                            >
                              Flow: {storylineFlowLabel}
                            </button>
                            {storylineHourBin ? (
                              <button
                                type="button"
                                onClick={focusStorylineAnchors}
                                className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                              >
                                Best: {storylineHourBin}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled
                              aria-disabled
                              className="cursor-default rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-500"
                            >
                              {packMode === 'earned'
                                ? `Based on ${storylineDistinctPlans} completions`
                                : 'Based on toolkit defaults'}
                            </button>
                          </div>
                          <p className="text-xs text-slate-400">
                            {packMode === 'earned'
                              ? 'Pulled from completed plans in this district.'
                              : 'Preview: this adapts as more plans complete.'}
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (experiencePackDraft) applyExperiencePackDraft(experiencePackDraft);
                              }}
                              disabled={isApplyingPack || !experiencePackDraft}
                              className="rounded-md border border-teal-400/70 bg-teal-500/15 px-3 py-1.5 text-[11px] font-semibold text-teal-100 hover:bg-teal-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isApplyingPack ? 'Applying...' : justAppliedPack ? 'Applied' : 'Apply'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsPackDraftDismissed(true)}
                              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                      {shouldLogVerticalDebug ? (
                        <p className="text-[10px] text-slate-500">
                          pack_mode: '{packMode}' | reason: '{experiencePackPreviewReason}' |
                          flip_condition: 'distinctCompletedPlans &gt;= 3 AND cityKnown'
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
              ) : null}
              {shouldShowCoachSuggestionsCard || shouldShowSecondStopRecommendation ? (
                <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-200">Coach suggestions</h3>
                    {hasPreviewCoachSuggestion ? (
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        Preview
                      </span>
                    ) : null}
                  </div>
                  {shouldShowSecondStopRecommendation ? (
                    <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-[11px] text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-slate-200">Plans like this usually include a second stop.</p>
                        <button
                          type="button"
                          onClick={() => setSecondStopDismissed(true)}
                          className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 transition hover:bg-slate-800"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {shouldShowCoachSuggestionsCard ? (
                    <div className="space-y-2">
                      {visibleCoachSuggestions.map((suggestion, index) => (
                        <div
                          key={`${suggestion.id}-${index}`}
                          className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-[12px] font-semibold text-slate-100">
                                {getCoachPrimaryChipLabel(suggestion)}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {getCoachWhyChipLabel(suggestion).replace(/^Why:\s*/, '')}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {suggestion.mode === 'preview' ? (
                                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
                                  Preview
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleCoachSuggestionPrimaryClick(suggestion)}
                                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDismissedCoachSuggestionIds((prev) =>
                                    prev.includes(suggestion.id) ? prev : [...prev, suggestion.id]
                                  )
                                }
                                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-slate-400">
                    Actions based on toolkit defaults and district patterns.
                  </p>
                  {shouldLogVerticalDebug ? (
                    <p className="text-[10px] text-slate-500">
                      recs: {coachSuggestionDebugLine} | derivedLocation:{' '}
                      {comparisonLocation ?? 'unknown'} | template_id:{' '}
                      {experiencePackTemplateId || 'unknown'}
                    </p>
                  ) : null}
                </section>
              ) : null}
              {shouldShowSeasonalContextCard || shouldShowComparisonCard ? (
                <section
                  id="district-intelligence-section"
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-200">District pulse</h3>
                      <p className="text-xs text-slate-400">
                        Signals from this district for this toolkit
                      </p>
                    </div>
                    {districtPulseHasPreview ? (
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        Preview
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">This month</p>
                      <p className={`text-lg font-semibold ${hasEarnedSeasonalContext ? 'text-slate-100' : 'text-slate-500'}`}>
                        {districtPulseThisMonthValue}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">MoM</p>
                      <p className={`text-lg font-semibold ${hasEarnedSeasonalContext ? 'text-slate-100' : 'text-slate-500'}`}>
                        {districtPulseMoMValue}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDistrictPulseBusiestDayClick}
                      className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-left transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Busiest day</p>
                      <p className={`text-lg font-semibold ${hasEarnedSeasonalContext ? 'text-slate-100' : 'text-slate-500'}`}>
                        {districtPulseBusiestDayValue}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={handleDistrictPulseTypicalPlanClick}
                      className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-left transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Typical plan</p>
                      <p className={`text-lg font-semibold ${hasEarnedSeasonalContext ? 'text-slate-100' : 'text-slate-500'}`}>
                        {districtPulseTypicalPlanValue}
                        {districtPulseTypicalPlanValue !== '—' ? ' stops' : ''}
                      </p>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">{districtPulseInsightLine}</p>
                  <div className="flex items-center justify-start gap-2">
                    <Link
                      href="/insights/heatmap"
                      className="rounded-md border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80"
                    >
                      See heatmap
                    </Link>
                  </div>
                  {shouldLogVerticalDebug ? (
                    <p className="text-[10px] text-slate-500">
                      template_id: {experiencePackTemplateId || 'unknown'} | derivedLocation:{' '}
                      {comparisonLocation ?? 'unknown'} | distinctPlans:{' '}
                      {seasonalContextSummary?.distinctPlans ?? 0} | currentMonthCount:{' '}
                      {seasonalContextSummary?.currentMonthCount ?? 0} | previousMonthCount:{' '}
                      {seasonalContextSummary?.previousMonthCount ?? 0} | topDay:{' '}
                      {typeof seasonalTopDayIndex === 'number'
                        ? (topDayNameByIndex[seasonalTopDayIndex as number] ?? seasonalTopDayIndex)
                        : 'none'}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </section>
          </section>
        ) : null}
        {hasLoadedRecentActivity && recentActivity.length > 0 ? (
          <details className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3" open={false}>
            <summary className="cursor-pointer list-none rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80 [&::-webkit-details-marker]:hidden">
              Recent activity ({recentActivity.length}) - latest completed plans.
            </summary>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              {recentActivity.map((row) => {
                const dateLabel = row.completedAt
                  ? new Date(row.completedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Unknown date';
                const sentimentLabel =
                  row.sentiment === 'positive'
                    ? 'Good'
                    : row.sentiment === 'neutral'
                      ? 'OK'
                      : row.sentiment === 'negative'
                        ? 'Bad'
                        : row.sentiment === 'good'
                          ? 'Good'
                          : row.sentiment === 'ok'
                            ? 'OK'
                            : row.sentiment === 'bad'
                              ? 'Bad'
                              : null;
                return (
                  <li
                    key={`${row.planId}-${row.completedAt}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-100">
                        {row.title ?? 'Untitled plan'}
                      </span>
                      <span className="text-[11px] text-slate-400">Completed {dateLabel}</span>
                    </div>
                    {sentimentLabel ? (
                      <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
                        {sentimentLabel}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
        {shouldShowReflection ? (
          <details className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3" open={false}>
            <summary className="cursor-pointer list-none rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/80 [&::-webkit-details-marker]:hidden">
              Reflection ({chosenNotCompleted.length + mostRevisited.length}) - revisit signals.
            </summary>
            <div className="mt-3 space-y-4">
              {chosenNotCompleted.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Chosen, not completed
                  </p>
                  <ul className="space-y-2 text-sm text-slate-200">
                    {chosenNotCompleted.map((row) => {
                      const dateLabel = row.chosenAt
                        ? new Date(row.chosenAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Unknown date';
                      const sentimentLabel =
                        row.sentiment === 'positive'
                          ? 'Good'
                          : row.sentiment === 'neutral'
                            ? 'OK'
                            : row.sentiment === 'negative'
                              ? 'Bad'
                              : row.sentiment === 'good'
                                ? 'Good'
                                : row.sentiment === 'ok'
                                  ? 'OK'
                                  : row.sentiment === 'bad'
                                    ? 'Bad'
                                    : null;
                      return (
                        <li
                          key={`${row.planId}-${row.chosenAt}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-100">
                              {row.title ?? 'Untitled plan'}
                            </span>
                            <span className="text-[11px] text-slate-400">Chosen {dateLabel}</span>
                          </div>
                          {sentimentLabel ? (
                            <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
                              {sentimentLabel}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {mostRevisited.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Most revisited
                  </p>
                  <ul className="space-y-2 text-sm text-slate-200">
                    {mostRevisited.map((row) => {
                      const dateLabel = row.lastViewedAt
                        ? new Date(row.lastViewedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Unknown date';
                      return (
                        <li
                          key={`${row.planId}-${row.lastViewedAt}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-100">
                              {row.title ?? 'Untitled plan'}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Views: {row.viewCount} · Last viewed {dateLabel}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {verticalDebugEnabled && debugEnabled && debugPlan ? (
          <details className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
            <summary className="cursor-pointer">
              Debug: stop location contract
            </summary>
            <div className="mt-2 space-y-1">
              {debugPlan.stops.map((stop, index) => {
                const placeRef = stop.placeRef ?? {};
                const hasPlaceId = Boolean(placeRef.placeId);
                const mapTarget = getStopMapTarget(stop);
                const mapTargetKind =
                  mapTarget?.kind === 'mapsUrl' ? 'url' : mapTarget?.kind ?? 'none';
                const hasPlaceLite = Boolean(stop.placeLite);
                const hasPhotoUrl = Boolean(stop.placeLite?.photoUrl);
                return (
                  <div key={stop.id}>
                    stop {index + 1} ({stop.role}): placeId {hasPlaceId ? 'yes' : 'no'},
                    mapTarget {mapTargetKind}, placeLite{' '}
                    {hasPlaceLite ? 'yes' : 'no'}, photo{' '}
                    {hasPhotoUrl ? 'yes' : 'no'} placeRef[
                    id:{placeRef.placeId ? 'y' : 'n'}; latLng:
                    {placeRef.latLng ? 'y' : 'n'}; mapsUrl:{placeRef.mapsUrl ? 'y' : 'n'};
                    websiteUrl:{placeRef.websiteUrl ? 'y' : 'n'}; label:
                    {placeRef.label ? 'y' : 'n'}]
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}
        </div>
        </div>
      </div>
    </main>
  );
}















