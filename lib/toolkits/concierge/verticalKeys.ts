export function normalizeRefinement(refinement: string | null | undefined): string {
  if (typeof refinement !== 'string') return 'none';
  const trimmed = refinement.trim();
  return trimmed ? trimmed : 'none';
}

export function buildVerticalPlanId(params: {
  verticalKey: string;
  parts: string[];
  refinement?: string | null;
}): string {
  return `${params.verticalKey}-${params.parts.join('-')}-${normalizeRefinement(params.refinement)}`;
}

export function buildVerticalCacheKey(params: {
  parts: string[];
  refinement?: string | null;
}): string {
  return `${params.parts.join(':')}:${normalizeRefinement(params.refinement)}`;
}
