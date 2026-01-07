import { ENTITIES, type Entity } from '@/data/entities';
import { PLAN_TEMPLATES, type PlanTemplate } from '@/app/templates/planTemplates';
import {
  createPlanFromTemplate,
  createPlanStarter,
  type PlanStarter,
} from '..';

export type SurpriseSourcePool = 'templateCatalog' | 'entities' | 'mixed';

export type SurpriseStarterMeta = {
  origin: 'surprise';
  generatedAt: string;
  sourcePool: SurpriseSourcePool;
};

export type SurpriseGeneratorMode = 'like' | 'different';

export type SurpriseSeedMeta = {
  sourcePool?: SurpriseSourcePool;
  stopCount?: number;
};

export type SurpriseGeneratorInput = {
  entities?: Entity[];
  templates?: PlanTemplate[];
  mode?: SurpriseGeneratorMode;
  seedMeta?: SurpriseSeedMeta;
  seed?: number;
};

const RECENT_SURPRISE_KEY = 'waypoint_recent_surprise_ids';
const LEGACY_LAST_SURPRISE_KEY = 'waypoint_last_surprise_id';
const RECENT_LIMIT = 5;
let recentSurpriseIdsInMemory: string[] | null = null;

function parseStoredIds(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => typeof value === 'string');
    }
  } catch {
    return null;
  }
  return null;
}

function readRecentSurpriseIds(): string[] {
  if (recentSurpriseIdsInMemory) return recentSurpriseIdsInMemory;
  if (typeof window === 'undefined') return [];

  let stored: string[] | null = null;
  try {
    stored = parseStoredIds(window.sessionStorage.getItem(RECENT_SURPRISE_KEY));
  } catch {
    stored = null;
  }
  if (!stored) {
    try {
      stored = parseStoredIds(window.localStorage.getItem(RECENT_SURPRISE_KEY));
    } catch {
      stored = null;
    }
  }

  if (!stored) {
    try {
      const legacy = window.localStorage.getItem(LEGACY_LAST_SURPRISE_KEY);
      stored = legacy ? [legacy] : null;
    } catch {
      stored = null;
    }
  }

  recentSurpriseIdsInMemory = stored ?? [];
  return recentSurpriseIdsInMemory;
}

function writeRecentSurpriseIds(ids: string[]): void {
  recentSurpriseIdsInMemory = ids;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RECENT_SURPRISE_KEY, JSON.stringify(ids));
    return;
  } catch {
    // ignore and try local storage
  }
  try {
    window.localStorage.setItem(RECENT_SURPRISE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures; in-memory cache still prevents repeats
  }
}

function normalizeEntities(list?: Entity[]): Entity[] {
  if (list && list.length > 0) return list;
  return ENTITIES;
}

function normalizeTemplates(list?: PlanTemplate[]): PlanTemplate[] {
  if (list && list.length > 0) return list;
  return PLAN_TEMPLATES;
}

function buildStarterFromTemplate(template: PlanTemplate): PlanStarter {
  const seedPlan = createPlanFromTemplate({
    ...template.prefill,
    title: template.prefill.title ?? template.label,
    intent: template.prefill.intent ?? template.description ?? template.label,
  });

  return createPlanStarter({
    id: `tpl-${template.id}`,
    type: 'TEMPLATE',
    title: template.label,
    summary: template.description,
    seedPlan,
    source: { templateId: template.id },
  });
}

function buildStarterFromEntity(entity: Entity): PlanStarter {
  const title = entity.name || 'Waypoint idea';
  const seedPlan = createPlanFromTemplate({
    title,
    intent: entity.description || 'A quick plan to get you started.',
    audience: 'me-and-friends',
    stops: [
      {
        id: `anchor-${entity.id}`,
        name: title,
        role: 'anchor',
        optionality: 'required',
        location: entity.location,
        notes: entity.description,
      },
    ],
    context: entity.location ? { localNote: `Meet at ${entity.location}` } : undefined,
    signals: entity.mood ? { vibe: entity.mood } : undefined,
  });

  return createPlanStarter({
    id: `entity-${entity.id}`,
    type: 'GENERATED',
    title,
    summary: entity.description,
    seedPlan,
    source: { importUri: entity.id },
  });
}

function pickCandidate<T>(items: T[], seed: number): T {
  if (items.length === 1) return items[0];
  // Simple deterministic picker based on seed to keep surprises reproducible per click
  const idx = Math.abs(Math.floor(seed)) % items.length;
  return items[idx];
}

function pickFirstAvailable<T>(buckets: T[][], seed: number): T | null {
  for (const bucket of buckets) {
    if (bucket.length > 0) {
      return pickCandidate(bucket, seed);
    }
  }
  return null;
}

export function generateSurpriseStarterCandidate(
  input: SurpriseGeneratorInput = {}
): { starter: PlanStarter; meta: SurpriseStarterMeta } {
  const seed = input.seed ?? Date.now();
  const entityPool = normalizeEntities(input.entities).map((entity) => ({
    starter: buildStarterFromEntity(entity),
    sourcePool: 'entities' as const,
    stopCount: 1,
  }));
  const templatePool = normalizeTemplates(input.templates).map((template) => ({
    starter: buildStarterFromTemplate(template),
    sourcePool: 'templateCatalog' as const,
    stopCount: Array.isArray(template.prefill.stops) ? template.prefill.stops.length : 0,
  }));

  const candidatePool = [...entityPool, ...templatePool];
  if (candidatePool.length === 0) {
    throw new Error('No surprise candidates available');
  }

  let recentIds = readRecentSurpriseIds();
  const seedSourcePool = input.seedMeta?.sourcePool;
  const seedStopCount = input.seedMeta?.stopCount;
  const mode = input.mode;

  let withoutRepeat =
    recentIds.length > 0
      ? candidatePool.filter((item) => !recentIds.includes(item.starter.id))
      : candidatePool;
  if (withoutRepeat.length === 0) {
    recentIds = [];
    writeRecentSurpriseIds([]);
    withoutRepeat = candidatePool;
  }

  let choice: (typeof candidatePool)[number] | null = null;

  if (mode === 'like') {
    const samePool = seedSourcePool ? withoutRepeat.filter((item) => item.sourcePool === seedSourcePool) : withoutRepeat;
    const sameStop =
      seedStopCount !== undefined
        ? samePool.filter((item) => item.stopCount === seedStopCount)
        : [];
    choice =
      pickFirstAvailable([sameStop, samePool, withoutRepeat], seed) ??
      pickFirstAvailable([candidatePool], seed);
  } else if (mode === 'different') {
    const diffEither =
      seedSourcePool || seedStopCount !== undefined
        ? withoutRepeat.filter(
            (item) =>
              (seedSourcePool && item.sourcePool !== seedSourcePool) ||
              (seedStopCount !== undefined && item.stopCount !== seedStopCount)
          )
        : [];
    const diffPool = seedSourcePool ? withoutRepeat.filter((item) => item.sourcePool !== seedSourcePool) : [];
    const diffStop =
      seedStopCount !== undefined
        ? withoutRepeat.filter((item) => item.stopCount !== seedStopCount)
        : [];
    choice =
      pickFirstAvailable([diffEither, diffPool, diffStop, withoutRepeat], seed) ??
      pickFirstAvailable([candidatePool], seed);
  } else {
    choice = pickFirstAvailable([withoutRepeat, candidatePool], seed);
  }

  if (!choice) {
    choice = candidatePool[0];
  }

  const nextRecent = [
    choice.starter.id,
    ...recentIds.filter((id) => id !== choice.starter.id),
  ].slice(0, RECENT_LIMIT);
  writeRecentSurpriseIds(nextRecent);

  const sourcePool: SurpriseSourcePool =
    entityPool.length > 0 && templatePool.length > 0 ? 'mixed' : choice.sourcePool;

  return {
    starter: choice.starter,
    meta: {
      origin: 'surprise',
      generatedAt: new Date().toISOString(),
      sourcePool,
    },
  };
}
