'use client';

import type { Plan } from './planTypes';

const STORAGE_KEY = 'waypoint_plans_v1';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadPlans(): Plan[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Plan[];

    // Ensure we always have createdAt and sort newest → oldest
    return parsed
      .map((plan) => ({
        ...plan,
        createdAt: plan.createdAt ?? new Date().toISOString(),
      }))
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return bTime - aTime;
      });
  } catch {
    // If something went wrong with parsing, reset to empty
    return [];
  }
}

export function savePlan(plan: Plan): void {
  if (!isBrowser()) return;

  const existing = loadPlans();

  const normalized: Plan = {
    ...plan,
    createdAt: plan.createdAt ?? new Date().toISOString(),
  };

  // Replace if the same id exists, otherwise prepend
  const withoutCurrent = existing.filter((p) => p.id !== normalized.id);
  const updated = [normalized, ...withoutCurrent];

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function loadPlanById(planId: string): Plan | null {
  const plans = loadPlans();
  return plans.find((p) => p.id === planId) ?? null;
}

export function deletePlan(planId: string): void {
  if (!isBrowser()) return;

  const existing = loadPlans();
  const filtered = existing.filter((p) => p.id !== planId);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function clearPlans(): void {
  if (!isBrowser()) return;

  window.localStorage.removeItem(STORAGE_KEY);
}
