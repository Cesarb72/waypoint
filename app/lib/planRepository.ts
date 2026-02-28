import { getSupabaseBrowserClient } from './supabaseBrowserClient';
import { fetchCloudPlan, upsertCloudPlan, CLOUD_PLAN_SELECT_MIN } from './cloudPlans';
import { loadSavedPlan, upsertRecentPlan } from '../utils/planStorage';
import { generateId, nowIso } from '../plan-engine/defaults';
import { PLAN_VERSION } from '../plan-engine';
import type { Plan, PlanEditPolicy, PlanOriginKind, PlanOwner } from '../plan-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeStop } from '../../lib/stopLocation';
import { extractDistrict } from './geo/extractDistrict';

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

export type PlanRepositorySource = 'cloud' | 'local';

export type LoadPlanResult =
  | Ok<{ plan: Plan; source: PlanRepositorySource }>
  | Err;

export type SavePlanResult =
  | Ok<{ plan: Plan; source: PlanRepositorySource }>
  | Err;

type CreatePlanOptions = {
  userId?: string | null;
  originKind?: PlanOriginKind;
  editPolicy?: PlanEditPolicy;
  createdFrom?: Plan['createdFrom'] | null;
};

export type PlanDraftStop = {
  id: string;
  label: string;
  notes?: string;
  time?: string;
  stop_type_id?: string;
  placeRef?: Plan['stops'][number]['placeRef'];
  placeLite?: Plan['stops'][number]['placeLite'];
  resolve?: Plan['stops'][number]['resolve'];
};

export type PlanDraft = {
  title: string;
  date?: string;
  time?: string;
  whenText?: string;
  district?: string;
  attendees: string;
  notes: string;
  stops: PlanDraftStop[];
  planSignals?: Plan['planSignals'];
};

type SharedPlanRow = {
  id: string;
  title: string | null;
  intent: string | null;
  audience: string | null;
  template_id?: string | null;
  stops: Plan['stops'] | null;
  presentation: Plan['presentation'] | null;
  brand: Plan['brand'] | null;
  origin: Plan['origin'] | null;
  created_from: Plan['createdFrom'] | null;
  metadata: Plan['metadata'] | null;
  updated_at: string | null;
};

function normalizeOwner(plan: Plan, userId: string | null): PlanOwner | undefined {
  if (plan.owner) return plan.owner;
  if (!userId) return undefined;
  return { type: 'user', id: userId };
}

function normalizeEditPolicy(plan: Plan, override?: PlanEditPolicy): PlanEditPolicy | undefined {
  if (override) return override;
  if (plan.editPolicy) return plan.editPolicy;
  return 'owner_only';
}

function normalizeOrigin(plan: Plan, originKind?: PlanOriginKind): Plan['origin'] | undefined {
  if (!originKind) return plan.origin;
  if (plan.origin?.kind === originKind) return plan.origin;
  return { ...(plan.origin ?? {}), kind: originKind };
}

function normalizeMetadata(plan: Plan): Plan['metadata'] {
  const now = nowIso();
  return {
    ...plan.metadata,
    createdAt: plan.metadata?.createdAt ?? now,
    lastUpdated: now,
  };
}

function readNonEmptyAnchor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
}

function pickAnchorValue(draftValue: string | undefined, baseValue: string | undefined): string | undefined {
  const next = readNonEmptyAnchor(draftValue);
  if (next) return next;
  const prev = readNonEmptyAnchor(baseValue);
  if (prev) return prev;
  if (typeof draftValue === 'string') return draftValue;
  return undefined;
}

function deriveDistrictFromStops(stops: Array<{
  placeLite?: { formattedAddress?: string | null } | null;
}>): string | null {
  for (const stop of stops) {
    const formattedAddress = stop?.placeLite?.formattedAddress;
    if (typeof formattedAddress !== 'string' || !formattedAddress.trim()) continue;
    const derived = extractDistrict(formattedAddress);
    if (derived) return derived;
  }
  return null;
}

export function buildDraftFromPlan(
  plan: Plan,
  fallbackStopLabel: string,
  defaultStopTypeId?: string
): PlanDraft {
  const planWithAnchors = plan as Plan & {
    date?: string;
    time?: string;
    whenText?: string;
  };
  const constraintsWithLegacy = (plan.constraints ?? {}) as Plan['constraints'] & {
    whenText?: string;
    date?: string;
    time?: string;
  };
  const normalizedStops = (plan.stops ?? []).map((stop) => normalizeStop(stop).stop);
  const stops: PlanDraftStop[] = normalizedStops.map((stop, index) => ({
    id:
      stop.id ??
      (typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    label: stop.name || `Stop ${index + 1}`,
    notes: stop.notes ?? '',
    time: stop.duration ?? '',
    stop_type_id: stop.stop_type_id,
    placeRef: stop.placeRef ? { ...stop.placeRef } : undefined,
    placeLite: stop.placeLite ? { ...stop.placeLite } : undefined,
    resolve: stop.resolve ? { ...stop.resolve } : undefined,
  }));

  const fallbackWhenText =
    readNonEmptyAnchor(constraintsWithLegacy.whenText) ??
    readNonEmptyAnchor(plan.constraints?.timeWindow);
  const planWithDistrict = plan as Plan & { district?: string | null };
  const draftDistrict =
    readNonEmptyAnchor(planWithDistrict.district ?? undefined) ??
    deriveDistrictFromStops(normalizedStops) ??
    '';

  return {
    title: plan.title ?? '',
    date:
      readNonEmptyAnchor(planWithAnchors.date) ??
      readNonEmptyAnchor(constraintsWithLegacy.date) ??
      '',
    time:
      readNonEmptyAnchor(planWithAnchors.time) ??
      readNonEmptyAnchor(constraintsWithLegacy.time) ??
      '',
    whenText: readNonEmptyAnchor(planWithAnchors.whenText) ?? fallbackWhenText ?? '',
    district: draftDistrict,
    attendees: plan.audience ?? '',
    notes: plan.intent ?? '',
    planSignals: plan.planSignals,
    stops:
      stops.length > 0
        ? stops
        : [
            {
              id:
                typeof crypto !== 'undefined'
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              label: fallbackStopLabel || 'Main stop',
              notes: '',
              time: '',
              stop_type_id: defaultStopTypeId,
            },
          ],
  };
}

export function buildPlanFromDraft(draft: PlanDraft, base: Plan | null, planId: string): Plan {
  const baseStopsById = new Map<string, Plan['stops'][number]>();
  base?.stops?.forEach((stop) => {
    if (stop.id) baseStopsById.set(stop.id, stop);
  });

  const stops: Plan['stops'] = draft.stops.map((stop, index) => {
    const existing = baseStopsById.get(stop.id);
    const baseStop: Plan['stops'][number] = {
      id: stop.id,
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

  const baseWithAnchors = (base ?? {}) as Plan & {
    date?: string;
    time?: string;
    whenText?: string;
  };
  const draftDate = pickAnchorValue(draft.date, baseWithAnchors.date);
  const draftTime = pickAnchorValue(draft.time, baseWithAnchors.time);
  const draftWhenText = pickAnchorValue(
    draft.whenText,
    baseWithAnchors.whenText ?? base?.constraints?.timeWindow
  );
  const baseWithDistrict = (base ?? {}) as Plan & { district?: string | null };
  const existingDistrict = readNonEmptyAnchor(baseWithDistrict.district ?? undefined);
  const draftDistrict = readNonEmptyAnchor(draft.district);
  const derivedDistrict = deriveDistrictFromStops(stops);
  const nextDistrict = draftDistrict ?? derivedDistrict ?? existingDistrict ?? null;

  const nextPlan: Plan & {
    date?: string;
    time?: string;
    whenText?: string;
    district?: string | null;
  } = {
    ...(base ?? {}),
    id: planId,
    version: base?.version ?? PLAN_VERSION,
    title: draft.title || 'Untitled plan',
    intent: draft.notes || '',
    audience: draft.attendees || '',
    date: draftDate,
    time: draftTime,
    whenText: draftWhenText,
    constraints: {
      ...(base?.constraints ?? {}),
      timeWindow: draftWhenText ?? base?.constraints?.timeWindow,
    },
    district: nextDistrict,
    stops,
    planSignals: draft.planSignals ?? base?.planSignals,
  };
  return nextPlan;
}

function finalizePlan(
  plan: Plan,
  options?: CreatePlanOptions
): Plan {
  const userId = options?.userId ?? null;
  const owner = normalizeOwner(plan, userId);
  const editPolicy = normalizeEditPolicy(plan, options?.editPolicy);
  const origin = normalizeOrigin(plan, options?.originKind);
  const createdFrom = options?.createdFrom ?? plan.createdFrom ?? undefined;
  return {
    ...plan,
    id: plan.id || generateId(),
    owner,
    editPolicy,
    origin,
    createdFrom,
    metadata: normalizeMetadata(plan),
    ownerId: owner?.id ?? plan.ownerId,
  };
}

async function resolveSessionUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function loadPlan(
  planId: string,
  options?: { userId?: string | null }
): Promise<LoadPlanResult> {
  if (!planId) return { ok: false, error: 'Missing plan id.' };
  const userId = options?.userId ?? (await resolveSessionUserId());
  if (userId) {
    const cloud = await fetchCloudPlan(planId, userId);
    if (cloud.ok) {
      return { ok: true, plan: cloud.plan, source: 'cloud' };
    }
  }
  const local = loadSavedPlan(planId);
  if (!local) return { ok: false, error: 'Plan not found.' };
  return { ok: true, plan: local, source: 'local' };
}

export async function savePlan(
  plan: Plan,
  options?: { userId?: string | null }
): Promise<SavePlanResult> {
  if (!plan) return { ok: false, error: 'Missing plan.' };
  const userId = options?.userId ?? (await resolveSessionUserId());
  const finalized = finalizePlan(plan, { userId });
  if (userId) {
    if (process.env.NODE_ENV !== 'production') {
      const anchored = finalized as Plan & {
        date?: string;
        time?: string;
        whenText?: string;
      };
      console.log('[plan] persist payload', {
        id: anchored.id,
        date: anchored.date ?? null,
        time: anchored.time ?? null,
        whenText: anchored.whenText ?? null,
      });
    }
    const result = await upsertCloudPlan(finalized, userId);
    if (result.ok) {
      upsertRecentPlan(finalized);
      return { ok: true, plan: finalized, source: 'cloud' };
    }
  }
  upsertRecentPlan(finalized);
  return { ok: true, plan: finalized, source: 'local' };
}

export async function createPlan(
  plan: Plan,
  options?: CreatePlanOptions
): Promise<SavePlanResult> {
  const finalized = finalizePlan(plan, options);
  return savePlan(finalized, { userId: options?.userId ?? null });
}

export async function forkPlan(
  sourcePlanId: string,
  options?: { userId?: string | null }
): Promise<SavePlanResult> {
  const userId = options?.userId ?? (await resolveSessionUserId());
  if (!userId) return { ok: false, error: 'You must be signed in to fork.' };
  const loaded = await loadPlan(sourcePlanId, { userId });
  if (!loaded.ok) return loaded;
  const base = loaded.plan;
  const now = nowIso();
  const forked: Plan = {
    ...base,
    id: generateId(),
    isTemplate: false,
    owner: { type: 'user', id: userId },
    editPolicy: 'owner_only',
    presentation: base.presentation ? { ...base.presentation, shareToken: undefined } : undefined,
    metadata: {
      ...base.metadata,
      createdAt: now,
      lastUpdated: now,
    },
  };
  return createPlan(forked, { userId, editPolicy: 'owner_only' });
}

function buildPlanFromSharedRow(row: SharedPlanRow): Plan | null {
  if (!row?.id || !row.stops) return null;
  return {
    id: row.id,
    version: PLAN_VERSION,
    title: row.title ?? 'Waypoint',
    intent: row.intent ?? '',
    audience: row.audience ?? '',
    template_id: row.template_id ?? undefined,
    stops: row.stops,
    presentation: row.presentation ?? undefined,
    brand: row.brand ?? undefined,
    origin: row.origin ?? undefined,
    createdFrom: row.created_from ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

export async function getPlanForShare(input: {
  supabase: SupabaseClient;
  planId: string;
  token: string | null;
  userId?: string | null;
}): Promise<Plan | null> {
  const { supabase, planId, token, userId } = input;
  if (!planId) return null;
  if (token) {
    const { data, error } = await supabase.rpc('get_shared_plan', {
      p_plan_id: planId,
      p_token: token,
    });
    if (!error) {
      const row = Array.isArray(data)
        ? (data[0] as SharedPlanRow | undefined)
        : (data as SharedPlanRow | null);
      if (row) return buildPlanFromSharedRow(row);
    }
    if (!userId) return null;
  }
  if (!userId) return null;
  let query = supabase.from('plans').select(CLOUD_PLAN_SELECT_MIN).eq('id', planId).limit(1);
  if (token) {
    query = query.eq('share_token', token);
  }
  const { data, error } = await query;
  if (error) return null;
  const row = data?.[0] as { plan_json?: Plan } | undefined;
  const plan = row?.plan_json ?? null;
  return plan;
}
