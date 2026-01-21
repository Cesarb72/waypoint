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
import type { StoredPlan } from '@/lib/planStorage';
import { loadPlans, deletePlan, clearPlans } from '@/lib/planStorage';
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
  removePlanById,
  markPlanShared,
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

let didLogSavedWaypoint = false;

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

function buildReturnTo(pathname: string, searchParams: URLSearchParams): string {
  const qs = searchParams.toString();
  return `${pathname}${qs ? `?${qs}` : ''}`;
}

function formatMoodLabel(mood: Mood): string {
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

function buildDiscoverySignal(options: {
  query: string;
  moodFilter: Mood | 'all';
  name: string;
  description?: string;
  location?: string;
  tags?: string[];
  entityMood?: Mood;
  isSaved: boolean;
}): string | null {
  const trimmedQuery = options.query.trim();
  const queryLower = trimmedQuery.toLowerCase();
  const haystack = [
    options.name,
    options.description,
    options.location,
    options.tags?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (trimmedQuery && haystack) {
    const queryWords = queryLower
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3);
    const matchesQuery =
      haystack.includes(queryLower) || queryWords.some((word) => haystack.includes(word));
    if (matchesQuery) {
      return `Matches your search: "${trimmedQuery}"`;
    }
  }

  if (options.moodFilter !== 'all' && options.entityMood === options.moodFilter) {
    return `Matches mood: ${formatMoodLabel(options.moodFilter)}`;
  }

  if (options.isSaved) {
    return 'Matches saved interest';
  }

  if (options.moodFilter !== 'all') {
    return 'Fits your filters';
  }

  return null;
}

export default function HomePageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showDevTools = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === '1';
  const SHARE_ENABLED = false;
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

  //  Recently created plans (from localStorage)
  const [recentPlans, setRecentPlans] = useState<StoredPlan[]>([]);

  //  Saved waypoints (favorites)
  const [savedWaypoints, setSavedWaypoints] = useState<SavedWaypoint[]>([]);
  const [waypointView, setWaypointView] = useState<'all' | 'saved'>('all');
  /**
   * SavedWaypoint fields observed from local storage (lib/savedWaypoints.ts):
   * id, name, description, location, mood, cost, proximity, useCases.
   * Source: SavedWaypoint is derived from Entity in data/entities.ts.
   */
  //  V2 plans stored via plan engine (recent/saved)
  const [recentV2Plans, setRecentV2Plans] = useState<PlanIndexItem[]>([]);
  const [recentShowSavedOnly, setRecentShowSavedOnly] = useState(false);
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
  const templateSectionRef = useRef<HTMLDivElement | null>(null);
  const templatesBootstrappedRef = useRef(false);
  const didLogDerivedOriginRef = useRef(false);

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

  // Load recent plans once on mount
  useEffect(() => {
    const plans = loadPlans();
    setRecentPlans(plans);
  }, []);

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
      const fallback = getRecentPlans().map((item) => ({
        ...item,
        isShared: isPlanShared(item.id),
      }));
      setRecentV2Plans(fallback.slice(0, 8));
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
    setRecentV2Plans(mapped.slice(0, 8));
    setSupabaseLoading(false);
  }, [userId]);

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
      const payload = localPlans
        .map((item) => {
          try {
            const planObj = deserializePlan(item.encoded);
            return {
              id: item.id,
              owner_id: userId,
              title: item.title || planObj.title || 'Waypoint',
              plan: planObj,
              parent_id: null,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      try {
        await supabase.from(CLOUD_PLANS_TABLE).upsert(payload as any, { onConflict: 'id' });
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
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load waypoints.');
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
    params.set('from', encoded);
    params.set('originSource', 'home_search');
    const href = `/create?${params.toString()}`;
    router.push(withPreservedModeParam(href, searchParams));
  }

  //  When user clicks "Plan this"
  function handlePlanClick(entity: Entity) {
    goToPlanForEntity(entity);
  }

  //  Surprise Me: pick a random entity and jump straight into planning
  function handleSurpriseMe(mode?: SurpriseGeneratorMode) {
    setSurpriseError(null);
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
      setSurprisePlan({
        ...seededPlan,
        originStarterId: starter.id,
        metadata: {
          ...metadata,
          createdAt: metadata.createdAt ?? meta.generatedAt,
          lastUpdated: meta.generatedAt,
        },
      });
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
          `/create?from=${encodeURIComponent(encoded)}&source=surprise`,
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
  }

  function buildSharePlanFromStored(plan: StoredPlan): Plan {
    const stops: Stop[] = (plan.stops ?? []).map((stop, index) => ({
      id: stop.id ?? `${plan.id}-stop-${index + 1}`,
      name: stop.label || `Stop ${index + 1}`,
      role: index === 0 ? 'anchor' : 'support',
      optionality: 'required',
      notes: stop.notes || undefined,
      duration: stop.time || undefined,
    }));

    return {
      id: plan.id,
      version: '2.0',
      title: plan.title || 'Untitled plan',
      intent: plan.notes || '',
      audience: plan.attendees || '',
      stops,
      presentation: {
        shareModes: ['link', 'qr', 'embed'],
      },
      metadata: {
        createdAt: plan.createdAt,
        lastUpdated: plan.updatedAt,
      },
    };
  }

  // Helper to build a share URL for a plan
  function getPlanShareUrl(plan: StoredPlan): string {
    const encoded = serializePlan(buildSharePlanFromStored(plan));
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/plan?p=${encodeURIComponent(encoded)}`;
    }
    // Fallback for SSR  still a valid relative link
    return `/plan?p=${encodeURIComponent(encoded)}`;
  }

  //  Re-open an existing plan in Calendar
  function handleOpenPlanCalendar(plan: StoredPlan) {
    if (!plan.dateTime) {
      window.alert(
        'This plan is missing a date/time. Please recreate it from a waypoint.'
      );
      return;
    }

    const date = new Date(plan.dateTime);
    if (Number.isNaN(date.getTime())) {
      window.alert(
        'This plan has an invalid date/time. Please recreate it from a waypoint.'
      );
      return;
    }

    const iso = date.toISOString(); // e.g. 2025-12-01T08:30:00.000Z
    const compact = iso.replace(/[-:]/g, '').split('.')[0] + 'Z';

    const params = new URLSearchParams();
    params.set('text', plan.title);
    if (plan.notes) params.set('details', plan.notes);
    if (plan.location) params.set('location', plan.location);
    params.set('dates', compact);

    const href = `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.toString()}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  //  Open an existing plan in Maps
  function handleOpenPlanMaps(plan: StoredPlan) {
    const query = plan.location || plan.title;
    if (!query) {
      window.alert(
        'This plan is missing a location. Please recreate it from a waypoint.'
      );
      return;
    }

    const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query
    )}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  //  Edit an existing plan
  function handleEditPlan(plan: StoredPlan) {
    router.push(
      withPreservedModeParam(
        `/plan?planId=${encodeURIComponent(plan.id)}`,
        searchParams
      )
    );
  }

  function handleShareRecentV2Plan(plan: PlanIndexItem) {
    if (!plan.encoded) return;
    const href =
      typeof window !== 'undefined'
        ? `${window.location.origin}/plan?p=${encodeURIComponent(plan.encoded)}`
        : `/plan?p=${encodeURIComponent(plan.encoded)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(href)
        .then(() => {
          window.alert('Share link copied to your clipboard.');
          markPlanShared(plan.id);
          setRecentV2Plans((prev) =>
            prev.map((item) =>
              item.id === plan.id ? { ...item, isShared: true } : item
            )
          );
        })
        .catch(() => {
          window.alert('Unable to copy the link. Please open the plan to share.');
        });
    } else {
      window.alert(href);
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
          `/create?from=${encodeURIComponent(encoded)}&origin=${encodeURIComponent(originHref)}&returnTo=${encodeURIComponent(returnTo)}`,
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

  //  View shared/summary view of a plan
  function handleViewDetails(plan: StoredPlan) {
    router.push(`/p/${encodeURIComponent(plan.id)}`);
  }

  //  Share a plan via link (MVP: copy link and/or open)
  function handleSharePlan(plan: StoredPlan) {
    const url = getPlanShareUrl(plan);

    // Try clipboard first if available
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          window.alert('Share link copied to your clipboard.');
          markPlanShared(plan.id);
          setRecentPlans((prev) =>
            prev.map((p) => (p.id === plan.id ? { ...p, isShared: true } : p))
          );
          setRecentV2Plans((prev) =>
            prev.map((p) => (p.id === plan.id ? { ...p, isShared: true } : p))
          );
        })
        .catch(() => {
          window.alert(`Copy unavailable. Share this link: ${url}`);
        });
    } else {
      // No clipboard: show the link without redirecting
      window.alert(`Share this link: ${url}`);
    }
  }

  //  Remove a single plan
  function handleRemovePlan(planId: string) {
    deletePlan(planId);
    setRecentPlans((prev) => prev.filter((p) => p.id !== planId));
  }

  function handleRemoveRecentV2(planId: string) {
    if (userId) {
      supabase.from(CLOUD_PLANS_TABLE).delete().eq('id', planId).eq('owner_id', userId).then(() => {
        setRecentV2Plans((prev) => prev.filter((p) => p.id !== planId));
      });
    } else {
      removePlanById(planId);
      const refreshed = recentShowSavedOnly ? getSavedPlans() : getRecentPlans();
      setRecentV2Plans(refreshed.slice(0, 8));
    }
  }

  //  Clear all plans
  function handleClearAllPlans() {
    if (!window.confirm('Clear all saved plans from this browser?')) return;
    clearPlans();
    setRecentPlans([]);
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

  // Which waypoints should we show in the main list?
  const displayWaypoints: DisplayWaypoint[] = useMemo(() => {
    if (waypointView === 'all') {
      return filteredEntities.map((entity) => ({ source: 'entity', entity }));
    }
    return savedWaypoints.map((saved) => ({ source: 'saved', saved }));
  }, [waypointView, filteredEntities, savedWaypoints]);

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
  const [isSurpriseLoading, setIsSurpriseLoading] = useState(false);
  const [surpriseNonce, setSurpriseNonce] = useState(0);

  const starterOptions = useMemo(
    () => [...v6Starters.V6_TEMPLATE_STARTERS, ...v6Starters.IDEA_DATE_IMPORTED_STARTERS],
    []
  );
  const waypointHeaderLabel = 'Your Waypoints';
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

  function handleOpenSharedView() {
    router.push(shareLinks.relativePath);
  }

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
            `/create?from=${encodeURIComponent(encoded)}`,
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
    [router, userId]
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

  function handleClearSelectedStarter() {
    setSelectedStarter(null);
    setPendingStarterMessage(null);
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-slate-950 text-slate-50 px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <header className="space-y-3">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Plan, share, align</p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-50">
              Waypoint keeps your plans and people in sync.
            </h1>
            <p className="text-sm text-slate-300">
              Draft the plan, lock the details, and share a read-only link so everyone knows the what, when, and where.
            </p>
            <p className="text-sm text-slate-400">
              Start from an idea, adapt it for your crew, and keep one source of truth. Preview without an account; sign in to save, edit, or share.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
                <p className="font-semibold text-slate-50">Try Waypoint free. Sign in when you want to sync.</p>
                <p className="text-[12px] text-slate-400">
                  You can explore, preview, and generate plans. Sign in to save, edit, or share them across devices.
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
        <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-300">
          You’re here to explore. Nothing you do here commits you — just browse, follow your curiosity, and look around.
        </div>
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

        <div ref={authPanelRef}>{showAuthPanel ? <AuthPanel /> : null}</div>

        <section className="rounded-md border border-slate-800 bg-slate-900/50 px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">Create a plan</p>
              <p className="text-[11px] text-slate-500">
                Step into Create when you're ready to author. Templates and starting points live there.
              </p>
            </div>
            <Link href="/create" className={ctaClass('primary')}>
              Create a plan
            </Link>
          </div>
        </section>

        {TEMPLATES_ENABLED ? (
          <section
            ref={templateSectionRef}
            className="space-y-3 pt-6 mt-6 border-t border-slate-900/60"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-200">Templates</h2>
              <button
                type="button"
                onClick={() => setShowTemplateExplorer((prev) => !prev)}
                className={`${ctaClass('chip')} text-[11px]`}
              >
                {showTemplateExplorer ? 'Hide templates' : 'Start with a template'}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Templates are reusable starting points. Pick one to open it in the editor and customize it.
            </p>
            <p className="text-[11px] text-slate-500">
              You're building your own plan. Templates just get you started.
            </p>
            {templateLoading ? (
              <p className="text-xs text-slate-400">Loading templates...</p>
            ) : templatePlans.length === 0 ? (
              <p className="text-xs text-slate-400">
                No templates yet. Convert a plan to a template to reuse it later.
              </p>
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
                      {activeTemplatePack.description || 'Pick a template to start a new plan.'}
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
                              className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUseTemplate(template)}
                              className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                            >
                              Use template
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
                Start with a template to explore packs and reuse plans.
              </p>
            )}
          </section>
        ) : null}

        <section className="space-y-3 pt-6 mt-6 border-t border-slate-900/60">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Continue
          </h2>
          {/* Plans (recent + saved toggle) */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">{waypointHeaderLabel}</h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">View:</span>
                <button
                  type="button"
                  onClick={() => setRecentShowSavedOnly(false)}
                  className={`text-[11px] rounded-full px-3 py-1 border ${
                    recentShowSavedOnly
                      ? 'border-slate-700 text-slate-400 hover:text-slate-200'
                      : 'border-slate-100 bg-slate-100 text-slate-900'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setRecentShowSavedOnly(true)}
                  className={`text-[11px] rounded-full px-3 py-1 border ${
                    recentShowSavedOnly
                      ? 'border-slate-100 bg-slate-100 text-slate-900'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Saved
                </button>
              </div>
            </div>
            {migrationMessage ? (
              <div className="rounded-md border border-emerald-700/60 bg-emerald-900/40 px-3 py-2 text-[11px] text-emerald-100">
                {migrationMessage}
              </div>
            ) : null}
            {userId && supabaseLoading ? (
              <p className="text-xs text-slate-400">Loading your Waypoints...</p>
            ) : recentV2Plans.length === 0 ? (
              <p className="text-xs text-slate-400">
                No Waypoints yet. Try searching, then plan or share a result to populate this list.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentV2Plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-0.5 min-w-0 w-full">
                      <p className="font-medium text-slate-100 truncate" title={plan.title}>
                        {plan.title}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate" title={new Date(plan.updatedAt).toLocaleString()}>
                        <span>Updated {new Date(plan.updatedAt).toLocaleString()}</span>
                        {plan.isShared ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                            Shared
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => {
                          if (!plan.encoded) return;
                          router.push(
                            withPreservedModeParam(
                              `/plans/${encodeURIComponent(plan.id)}`,
                              searchParams
                            )
                          );
                        }}
                        className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!plan.encoded) return;
                          try {
                            deserializePlan(plan.encoded);
                            const origin = withPreservedModeParam(
                              `/plan?p=${encodeURIComponent(plan.encoded)}`,
                              searchParams
                            );
                            router.push(
                              withPreservedModeParam(
                                `/create?from=${encodeURIComponent(plan.encoded)}&origin=${encodeURIComponent(origin)}`,
                                searchParams
                              )
                            );
                          } catch {
                            // ignore invalid payload
                          }
                        }}
                        className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                      >
                        Edit
                      </button>
                      {SHARE_ENABLED ? (
                        <button
                          type="button"
                          onClick={() => handleShareRecentV2Plan(plan)}
                          className={`${ctaClass('chip')} shrink-0 text-[10px]`}
                        >
                          Share this version
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemoveRecentV2(plan.id)}
                        className={`${ctaClass('danger')} shrink-0 text-[10px] ms-2`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent plans */}
          {recentPlans.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-900/50">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Earlier plans</span>
                <button
                  type="button"
                  onClick={handleClearAllPlans}
                  className="text-[10px] font-medium text-slate-500 hover:text-slate-300"
                >
                  Clear all
                </button>
              </div>

              <ul className="space-y-2">
                {recentPlans.map((plan) => (
                  <li
                    key={plan.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs flex items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-medium text-slate-100 truncate">{plan.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {plan.location ?? 'No location'} A{' '}
                        {plan.dateTime
                          ? new Date(plan.dateTime).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })
                          : 'No time set'}
                      </p>
                      {plan.chosen || plan.completed === true || plan.sentiment ? (
                        <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
                          {plan.chosen ? (
                            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                              Chosen
                            </span>
                          ) : null}
                          {plan.completed === true ? (
                            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                              Completed
                            </span>
                          ) : null}
                          {plan.sentiment ? (
                            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 capitalize">
                              {plan.sentiment}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => handleOpenPlanCalendar(plan)}
                        className="shrink-0 rounded-md border border-emerald-500/70 bg-emerald-600/20 px-2 py-1 text-[10px] font-semibold text-emerald-50 hover:bg-emerald-600/30"
                      >
                        Calendar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenPlanMaps(plan)}
                        className="shrink-0 rounded-md border border-sky-500/70 bg-sky-600/20 px-2 py-1 text-[10px] font-semibold text-sky-50 hover:bg-sky-600/30"
                      >
                        Maps
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditPlan(plan)}
                        className="shrink-0 rounded-md border border-amber-500/70 bg-amber-600/20 px-2 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-600/30"
                      >
                        Edit
                      </button>
                      {SHARE_ENABLED ? (
                        <button
                          type="button"
                          onClick={() => handleViewDetails(plan)}
                          className="shrink-0 rounded-md border border-indigo-500/70 bg-indigo-600/20 px-2 py-1 text-[10px] font-semibold text-indigo-50 hover:bg-indigo-600/30"
                        >
                          Details
                        </button>
                      ) : null}
                      {SHARE_ENABLED ? (
                        <button
                          type="button"
                          onClick={() => handleSharePlan(plan)}
                          className="shrink-0 rounded-md border border-fuchsia-500/70 bg-fuchsia-600/20 px-2 py-1 text-[10px] font-semibold text-fuchsia-50 hover:bg-fuchsia-600/30"
                        >
                          Share this version
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemovePlan(plan.id)}
                        className="shrink-0 rounded-md border border-rose-600/70 bg-rose-700/25 px-2 py-1 text-[10px] font-semibold text-rose-50 hover:bg-rose-700/35 ms-2"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

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

        {/* Controls */}
        <section className="space-y-3">
          {/* What + Search */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300" htmlFor="home-what">
              What are you looking for?
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                id="home-what"
                name="q"
                type="text"
                placeholder="e.g. cheap date, cozy bar, birthday dinner, friends night"
                value={whatInput}
                onChange={(e) => {
                  setWhatInput(e.target.value);
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
                Search
              </button>
            </div>
          </div>

          {/* Where + Mood */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-300" htmlFor="home-where">
                Where?
                <span className="ml-1 text-[10px] font-normal text-slate-500">
                  (optional  city, neighborhood, state)
                </span>
              </label>
              <input
                id="home-where"
                name="where"
                type="text"
                placeholder="e.g. near me, San Jose, downtown"
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
            </div>
          </div>

          {/* Helper hint about natural-language search */}
          <p className="text-[11px] text-slate-500">
            Search currently looks across starting points and your saved Waypoints (places coming soon). Use natural phrases like{' '}
            <span className="font-medium text-slate-300">
              &ldquo;cheap date&rdquo;, &ldquo;cozy bar in downtown&rdquo;, or &ldquo;birthday dinner&rdquo;
            </span>{' '}
            to match vibes and tags - even with small typos.
          </p>
        </section>

        {/* Waypoint view toggle + status + results */}
        <section className="space-y-2 mt-6">
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
                All waypoints
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
                Saved
              </button>
            </div>

            <div className="flex flex-col items-start sm:items-end text-[11px] text-slate-400 gap-0.5">
              <span>
                {isLoading
                  ? 'Loading waypoints...'
                  : error
                  ? 'Error loading waypoints.'
                  : waypointView === 'all'
                  ? `${displayWaypoints.length} matching waypoint(s)`
                  : `${displayWaypoints.length} saved waypoint(s)`}
              </span>
              <span>
                {locationStatus === 'available' && 'Using your location'}
                {locationStatus === 'requesting' && 'Requesting location'}
                {locationStatus === 'denied' && 'Location denied (using default area)'}
              </span>

              {/* Active filters summary */}
              {(queryFromUrl || moodFromUrl !== 'all') && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {queryFromUrl && (
                    <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300">
                      Query: {queryFromUrl}
                    </span>
                  )}
                  {moodFromUrl !== 'all' && (
                    <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300 capitalize">
                      Mood: {moodFromUrl}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && !isLoading && (
            <div className="rounded-xl border border-red-600/60 bg-red-950/40 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {isLoading && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
              Loading waypoints...
            </div>
          )}

          {!isLoading && !error && (
            <ul className="space-y-3">
              {displayWaypoints.map((item) => {
                const id = item.source === 'entity' ? item.entity.id : item.saved.id;
                const name =
                  item.source === 'entity' ? item.entity.name : item.saved.name;
                const description =
                  item.source === 'entity'
                    ? item.entity.description
                    : item.saved.description;
                const tags =
                  item.source === 'entity' ? item.entity.tags : undefined;
                const mood: Mood =
                  item.source === 'entity'
                    ? item.entity.mood
                    : (item.saved.mood ?? 'chill');

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

                const isSaved = savedWaypoints.some((wp) => wp.id === id);
                const origin = item.source === 'saved' ? deriveOrigin(item.saved) : null;
                const originLine = origin
                  ? origin.originType === 'District'
                    ? `${origin.primaryLabel} · ${origin.secondaryLabel ?? ''}`.trim()
                    : origin.originType === 'City'
                    ? origin.primaryLabel
                    : origin.originType === 'Template'
                    ? `Template · ${origin.primaryLabel}`
                    : `Search · "${origin.primaryLabel}"`
                  : null;
                const discoverySignal = buildDiscoverySignal({
                  query: queryFromUrl,
                  moodFilter: moodFromUrl,
                  name,
                  description,
                  location: item.source === 'entity' ? item.entity.location : item.saved.location,
                  tags,
                  entityMood: mood,
                  isSaved,
                });

                const onToggleFavorite = () => {
                  if (item.source === 'entity') {
                    toggleSavedWaypointForEntity(item.entity);
                  } else {
                    toggleSavedWaypointById(id);
                  }
                };

                const hasAnyChip =
                  !!cost || !!proximity || (useCases && useCases.length > 0);

                return (
                  <li
                    key={id}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-medium">{name}</h2>
                          {origin ? (
                            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300">
                              {origin.originType}
                            </span>
                          ) : null}
                        </div>
                        {originLine ? (
                          <p className="text-[11px] text-slate-500 truncate">{originLine}</p>
                        ) : null}
                        {description && (
                          <p className="text-xs text-slate-400">{description}</p>
                        )}
                        {discoverySignal && (
                          <p className="text-[11px] text-slate-500">{discoverySignal}</p>
                        )}

                        {/* Chips row */}
                        {hasAnyChip && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {cost && (
                              <span className="inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
                                {labelCost(cost)}
                              </span>
                            )}
                            {proximity && (
                              <span className="inline-flex items-center rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100">
                                {labelProximity(proximity)}
                              </span>
                            )}
                            {useCases &&
                              useCases.map((u) => (
                                <span
                                  key={u}
                                  className="inline-flex items-center rounded-full border border-purple-500/50 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-100"
                                >
                                  {labelUseCase(u)}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                          {mood}
                        </span>
                        <button
                          type="button"
                          onClick={onToggleFavorite}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                          aria-label={isSaved ? 'Remove from saved' : 'Save waypoint'}
                        >
                          {isSaved ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      {origin?.originHref ? (
                        <Link
                          href={origin.originHref}
                          className={`${ctaClass('chip')} text-[11px]`}
                        >
                          Explore
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}

              {displayWaypoints.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-xs text-slate-500">
                  {waypointView === 'saved'
                    ? 'No saved waypoints yet. Save a place from search to keep it handy.'
                    : 'No matches yet. Try a new query or clear filters to see new ideas.'}
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}







