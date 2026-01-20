import type { Plan } from '@/app/plan-engine';

const DRAFT_PREFIX = 'waypoint:draft:';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getKey(planId?: string | null): string | null {
  if (!planId) return null;
  return `${DRAFT_PREFIX}${planId}`;
}

export function loadDraft(planId?: string | null): Plan | null {
  const key = getKey(planId);
  return loadDraftByKey(key);
}

export function loadDraftByKey(key?: string | null): Plan | null {
  if (!key || !hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Plan;
  } catch {
    return null;
  }
}

export function saveDraft(planId: string | null | undefined, plan: Plan): void {
  const key = getKey(planId);
  saveDraftByKey(key, plan);
}

export function saveDraftByKey(key: string | null | undefined, plan: Plan): void {
  if (!key || !hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(plan));
  } catch {
    // ignore storage failures
  }
}

export function clearDraft(planId: string | null | undefined): void {
  const key = getKey(planId);
  clearDraftByKey(key);
}

export function clearDraftByKey(key: string | null | undefined): void {
  if (!key || !hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}
