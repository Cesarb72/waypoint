import { getSupabaseBrowserClient } from './supabaseBrowserClient';
import type { Plan } from '../plan-engine';

export type CloudDraftRow = {
  id: string;
  plan_id: string;
  owner_id: string;
  draft_json: Plan;
  updated_at: string;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type OkEmpty = { ok: true };

const draftIdCache = new Map<string, Promise<string>>();

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractPlanIdFromDraftKey(draftKey: string): string | null {
  const planPrefix = 'waypoint:draft:plan:';
  const sourcePrefix = 'waypoint:draft:source:';
  if (draftKey.startsWith(planPrefix)) return draftKey.slice(planPrefix.length);
  if (draftKey.startsWith(sourcePrefix)) return draftKey.slice(sourcePrefix.length);
  return null;
}

async function hashToUuid(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoObj?.subtle?.digest) {
    const digest = await cryptoObj.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest)).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  const hex = hash.toString(16).padStart(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(
    17,
    20
  )}-${hex.slice(20, 32)}`;
}

async function draftKeyToUuid(draftKey: string): Promise<string> {
  if (!draftIdCache.has(draftKey)) {
    draftIdCache.set(draftKey, hashToUuid(draftKey));
  }
  return draftIdCache.get(draftKey) as Promise<string>;
}

async function buildDraftIdentity(draftKey: string) {
  const id = await draftKeyToUuid(draftKey);
  const planIdCandidate = extractPlanIdFromDraftKey(draftKey);
  const plan_id = isUuid(planIdCandidate) ? planIdCandidate : id;
  return { id, plan_id };
}

export async function fetchCloudDraft(
  draftKey: string,
  userId: string
): Promise<Ok<{ draft: Plan; updatedAt: number }> | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { id } = await buildDraftIdentity(draftKey);
    const { data, error } = await supabase
      .from('plan_drafts')
      .select('draft_json,updated_at')
      .eq('id', id)
      .eq('owner_id', userId)
      .limit(1);
    if (error) return { ok: false, error: error.message };
    const row = data?.[0];
    if (!row?.draft_json) return { ok: false, error: 'Draft not found.' };
    const updatedAt = Date.parse(row.updated_at as string) || 0;
    return { ok: true, draft: row.draft_json as Plan, updatedAt };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function upsertCloudDraft(
  draftKey: string,
  plan: Plan,
  userId: string
): Promise<OkEmpty | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const identity = await buildDraftIdentity(draftKey);
    const payload = {
      ...identity,
      owner_id: userId,
      draft_json: plan,
    };
    const { error } = await supabase.from('plan_drafts').upsert(payload, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function clearCloudDraft(
  draftKey: string,
  userId: string
): Promise<OkEmpty | Err> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { id } = await buildDraftIdentity(draftKey);
    const { error } = await supabase
      .from('plan_drafts')
      .delete()
      .eq('id', id)
      .eq('owner_id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
