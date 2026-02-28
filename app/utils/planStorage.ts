import {
  deserializePlan,
  serializePlan,
  PLAN_VERSION,
  type Plan,
  type PlanSignals,
  type Stop,
} from '../plan-engine';
import { buildReflectionSummary, type ReflectionSummary } from '../plan-engine/planReflection';
import type { Origin } from '../plan-engine/origin';
import { loadPlanById, type StoredPlan } from '@/lib/planStorage';

export type PlanIndexItem = {
  id: string;
  title: string;
  intent: string;
  audience?: string;
  encoded: string;
  updatedAt: string;
  isSaved: boolean;
  isShared?: boolean;
};

export type TemplateIndexItem = {
  id: string;
  title: string;
  intent: string;
  audience?: string;
  encoded: string;
  updatedAt: string;
  isSaved: boolean;
  isShared?: boolean;
  templateTitle: string;
  packId: string;
  packTitle: string;
  packDescription?: string;
  packTags?: string[];
};

const STORAGE_KEY = 'waypoint.v2.plansIndex';
const SHARED_KEY = 'waypoint.v2.sharedIndex';
const ORIGIN_KEY = 'waypoint.origin.active';
const DRAFT_CLOUD_MAP_KEY = 'waypoint.v3.draftToCloudMap';
const MAX_RECENT = 25;
const originLogState = { loaded: false, saved: false };

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

function normalizePlanSignals(input?: PlanSignals | null): PlanSignals {
  return {
    ...DEFAULT_PLAN_SIGNALS,
    ...(input ?? {}),
  };
}

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readIndex(): PlanIndexItem[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PlanIndexItem[];
  } catch {
    return [];
  }
}

function savePlansIndex(items: PlanIndexItem[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage failures
  }
}

function sortByUpdated(items: PlanIndexItem[]): PlanIndexItem[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function readSharedSet(): Set<string> {
  if (!hasLocalStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(SHARED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as string[]);
  } catch {
    return new Set();
  }
}

function saveSharedSet(ids: Set<string>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(SHARED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage failures
  }
}

function readDraftCloudMap(): Record<string, string> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_CLOUD_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function saveDraftCloudMap(next: Record<string, string>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(DRAFT_CLOUD_MAP_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

export function getCloudPlanIdForDraft(draftId: string): string | null {
  if (!draftId) return null;
  const map = readDraftCloudMap();
  const match = map[draftId];
  return typeof match === 'string' && match.trim() ? match : null;
}

export function setCloudPlanIdForDraft(draftId: string, cloudId: string): void {
  if (!draftId || !cloudId) return;
  const map = readDraftCloudMap();
  if (map[draftId] === cloudId) return;
  map[draftId] = cloudId;
  saveDraftCloudMap(map);
}

export function clearCloudPlanIdForDraft(draftId: string): void {
  if (!draftId) return;
  const map = readDraftCloudMap();
  if (!(draftId in map)) return;
  delete map[draftId];
  saveDraftCloudMap(map);
}

export function purgeInvalidOrLegacyPlans(items: PlanIndexItem[]): PlanIndexItem[] {
  const filtered: PlanIndexItem[] = [];

  items.forEach((item) => {
    if (!item.encoded) return;
    try {
      const plan = deserializePlan(item.encoded);
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_DEBUG_ORIGINS === '1' &&
      !originLogState.loaded
    ) {
      originLogState.loaded = true;
      const planAny = plan as unknown as { origin?: unknown; meta?: { origin?: unknown } };
      console.log(
        '[originS] loaded plan JSON',
        JSON.stringify({
          id: plan?.id,
          title: plan?.title,
          originTop: planAny?.origin ?? null,
          originMeta: planAny?.meta?.origin ?? null,
        })
      );
      }
      if (plan.version === '2.0') {
        filtered.push(item);
      }
    } catch {
      // drop invalid/legacy items silently
    }
  });

  if (filtered.length !== items.length) {
    savePlansIndex(filtered);
  }

  return filtered;
}

export function getPlansIndex(): PlanIndexItem[] {
  const items = readIndex();
  return purgeInvalidOrLegacyPlans(items);
}

function convertLegacyPlanToPlan(legacy: StoredPlan): Plan {
  const stops: Stop[] = (legacy.stops ?? []).map((stop, index) => ({
    id: stop.id ?? `${legacy.id}-stop-${index + 1}`,
    name: stop.label || `Stop ${index + 1}`,
    role: index === 0 ? 'anchor' : 'support',
    optionality: 'required',
    notes: stop.notes ?? undefined,
    duration: stop.time ?? undefined,
  }));

  return {
    id: legacy.id,
    version: PLAN_VERSION,
    title: legacy.title || 'Untitled plan',
    intent: legacy.notes || '',
    audience: legacy.attendees || '',
    stops,
    metadata: {
      createdAt: legacy.createdAt,
      lastUpdated: legacy.updatedAt,
    },
    planSignals: legacy.planSignals,
  };
}

export function loadSavedPlan(planId: string): Plan | null {
  if (!planId) return null;
  const match = getPlansIndex().find((item) => item.id === planId);
  if (match?.encoded) {
    try {
      return deserializePlan(match.encoded);
    } catch {
      // fall through to legacy
    }
  }
  const legacy = loadPlanById(planId);
  if (!legacy) return null;
  return convertLegacyPlanToPlan(legacy);
}

export function upsertRecentPlan(plan: Plan): PlanIndexItem {
  const updatedAt = new Date().toISOString();
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_DEBUG_ORIGINS === '1' &&
    !originLogState.saved
  ) {
    originLogState.saved = true;
    const planAny = plan as unknown as { origin?: unknown; meta?: { origin?: unknown } };
    console.log(
      '[originS] saving plan JSON',
      JSON.stringify({
        id: plan.id,
        title: plan.title,
        originTop: planAny?.origin ?? null,
        originMeta: planAny?.meta?.origin ?? null,
      })
    );
  }
  const encoded = (() => {
    try {
      return serializePlan(plan);
    } catch {
      return '';
    }
  })();

  const nextItem: PlanIndexItem = {
    id: plan.id,
    title: plan.title,
    intent: plan.intent,
    audience: plan.audience,
    encoded,
    updatedAt,
    isSaved: false,
    isShared: undefined,
  };

  const existing = readIndex();
  const existingIdx = existing.findIndex((item) => item.id === plan.id);
  if (existingIdx >= 0) {
    nextItem.isSaved = existing[existingIdx].isSaved;
    nextItem.isShared = existing[existingIdx].isShared;
    existing.splice(existingIdx, 1);
  }

  const merged = [nextItem, ...existing];
  const capped = merged.slice(0, MAX_RECENT);
  savePlansIndex(capped);
  return nextItem;
}

export function updatePlanSentiment(
  planId: string,
  sentiment: PlanSignals['sentiment']
): Plan | null {
  const plan = loadSavedPlan(planId);
  if (!plan) return null;
  const sentimentAt = sentiment ? new Date().toISOString() : undefined;
  const nextPlan: Plan = {
    ...plan,
    planSignals: {
      ...normalizePlanSignals(plan.planSignals),
      sentiment,
      sentimentAt,
    },
  };
  upsertRecentPlan(nextPlan);
  return nextPlan;
}

export function toggleSavedById(id: string): boolean {
  const items = readIndex();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  items[idx] = { ...items[idx], isSaved: !items[idx].isSaved, updatedAt: new Date().toISOString() };
  savePlansIndex(items);
  return true;
}

export function setSavedById(id: string, saved: boolean): boolean {
  const items = readIndex();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  if (items[idx].isSaved === saved) return true;
  items[idx] = { ...items[idx], isSaved: saved, updatedAt: new Date().toISOString() };
  savePlansIndex(items);
  return true;
}

export function getRecentPlans(): PlanIndexItem[] {
  return sortByUpdated(getPlansIndex());
}

export function getSavedPlans(): PlanIndexItem[] {
  return sortByUpdated(getPlansIndex().filter((item) => item.isSaved));
}

export function getSavedPlansForReflection(): Plan[] {
  return getSavedPlans()
    .map((item) => {
      try {
        return deserializePlan(item.encoded);
      } catch {
        return null;
      }
    })
    .filter((plan): plan is Plan => Boolean(plan?.id));
}

export function getReflectionSummary(opts?: {
  includeRecentlyTouched?: boolean;
}): ReflectionSummary {
  const plans = getSavedPlansForReflection();
  return buildReflectionSummary(plans, opts);
}

export function getTemplatePlans(): TemplateIndexItem[] {
  const items = getPlansIndex();
  const templates: TemplateIndexItem[] = [];

  items.forEach((item) => {
    if (!item.encoded) return;
    try {
      const plan = deserializePlan(item.encoded);
      if (!plan.isTemplate) return;
      const templateTitle = plan.templateMeta?.title || plan.title || 'Template';
      const packId = plan.templateMeta?.packId || 'custom';
      const packTitle = plan.templateMeta?.packTitle || 'My templates';
      templates.push({
        ...item,
        title: plan.title || item.title,
        intent: plan.intent || item.intent,
        audience: plan.audience || item.audience,
        templateTitle,
        packId,
        packTitle,
        packDescription: plan.templateMeta?.packDescription,
        packTags: plan.templateMeta?.packTags,
      });
    } catch {
      // ignore invalid payloads
    }
  });

  return [...templates].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function removePlanById(id: string): void {
  const items = readIndex();
  const next = items.filter((item) => item.id !== id);
  savePlansIndex(next);
}

// Backward compatibility alias
export function removePlanFromIndex(id: string): void {
  removePlanById(id);
}

export function markPlanShared(id: string): void {
  const set = readSharedSet();
  if (!id) return;
  set.add(id);
  saveSharedSet(set);
}

export function isPlanShared(id: string): boolean {
  if (!id) return false;
  const set = readSharedSet();
  return set.has(id);
}

export function saveOrigin(origin: Origin): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    // ignore storage failures
  }
}

export function loadOrigin(): Origin | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(ORIGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Origin;
    if (!parsed || typeof parsed.label !== 'string' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearOrigin(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(ORIGIN_KEY);
  } catch {
    // ignore storage failures
  }
}
