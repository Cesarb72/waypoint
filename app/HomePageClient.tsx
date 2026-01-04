'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  loadSavedWaypoints,
  saveWaypointFromEntity,
  removeSavedWaypoint,
  type SavedWaypoint,
} from '@/lib/savedWaypoints';
import {
  createEmptyPlan,
  deserializePlan,
  serializePlan,
  type Plan,
  v6Starters,
} from './plan-engine';
import {
  getRecentPlans,
  getSavedPlans,
  removePlanById,
  upsertRecentPlan,
  type PlanIndexItem,
} from './utils/planStorage';
import { ctaClass } from './ui/cta';
import AuthPanel from './auth/AuthPanel';
import { getSupabaseBrowserClient } from './lib/supabaseBrowserClient';

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

export default function HomePageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showDevTools = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === '1';
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  // ðŸ”Œ Data from "API"
  const [data, setData] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ðŸ“ Location (optional)
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'requesting' | 'denied' | 'available'
  >('idle');

  // ðŸ’¾ Recently created plans (from localStorage)
  const [recentPlans, setRecentPlans] = useState<StoredPlan[]>([]);

  // ðŸ’¾ Saved waypoints (favorites)
  const [savedWaypoints, setSavedWaypoints] = useState<SavedWaypoint[]>([]);
  const [waypointView, setWaypointView] = useState<'all' | 'saved'>('all');
  // ðŸ“‘ V2 plans stored via plan engine (recent/saved)
  const [recentV2Plans, setRecentV2Plans] = useState<PlanIndexItem[]>([]);
  const [recentShowSavedOnly, setRecentShowSavedOnly] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const authPanelRef = useRef<HTMLDivElement | null>(null);

  // Try to get browser geolocation once on mount
  useEffect(() => {
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
  }, []);

  // Load recent plans once on mount
  useEffect(() => {
    const plans = loadPlans();
    setRecentPlans(plans);
  }, []);

  // Load saved waypoints once on mount
  useEffect(() => {
    const saved = loadSavedWaypoints();
    setSavedWaypoints(saved);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!userId) {
      setSupabaseLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      pendingStarterHandledRef.current = false;
      isPromotingRef.current = false;
    }
  }, [userId]);

  const loadSupabaseWaypoints = useCallback(async () => {
    if (!userId) return;
    setSupabaseLoading(true);
    const { data: rows, error: supaError } = await supabase
      .from('waypoints')
      .select('id,title,plan,parent_id,updated_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (supaError || !rows) {
      setSupabaseLoading(false);
      return;
    }

    const mapped: PlanIndexItem[] = rows
      .map((row) => {
        const planObj = row.plan as unknown as Plan | null;
        if (!planObj) return null;
        try {
          const encoded = serializePlan(planObj);
          return {
            id: row.id,
            title: row.title || planObj.title || 'Waypoint',
            intent: planObj.intent,
            audience: planObj.audience,
            encoded,
            updatedAt: row.updated_at || new Date().toISOString(),
            isSaved: true,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as PlanIndexItem[];

    setRecentV2Plans(mapped.slice(0, 8));
    setSupabaseLoading(false);
  }, [supabase, userId]);

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
        await supabase.from('waypoints').upsert(payload as any, { onConflict: 'id' });
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


  // Load V2 recent/saved plans on mount and when filter toggles
  useEffect(() => {
    if (userId) return;
    const plans = recentShowSavedOnly ? getSavedPlans() : getRecentPlans();
    setRecentV2Plans(plans.slice(0, 8));
  }, [recentShowSavedOnly, userId]);

  // ðŸ”Ž Filters from URL (this is the actual query sent to the API & search)
  const queryFromUrl = searchParams.get('q') ?? '';

  const moodFromUrlRaw =
    (searchParams.get('mood') as Mood | 'all' | null) ?? 'all';
  const moodFromUrl: Mood | 'all' = MOOD_OPTIONS.includes(moodFromUrlRaw)
    ? moodFromUrlRaw
    : 'all';

  // ðŸ“ Local UX state: "What" and "Where" inputs
  const [whatInput, setWhatInput] = useState(queryFromUrl);
  const [whereInput, setWhereInput] = useState('');

  // Keep "what" in sync if URL changes (back/forward, surprise, etc.)
  useEffect(() => {
    setWhatInput(queryFromUrl);
  }, [queryFromUrl]);

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
    router.replace(queryString ? `${pathname}?${queryString}` : pathname);
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

  // ðŸ” Load entities whenever URL query or location changes
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

  // ðŸ§  Centralized search logic (text + tags + mood)
  const filteredEntities = useMemo(
    () =>
      searchEntities(data, {
        query: queryFromUrl, // use whatever is in the search bar / URL
        mood: moodFromUrl,
      }),
    [data, moodFromUrl, queryFromUrl]
  );

  // ðŸ“ Navigate into planning flow WITH a snapshot of the entity
  function goToPlanForEntity(entity: Entity) {
    const params = new URLSearchParams();

    params.set('entityId', entity.id);
    if (queryFromUrl) params.set('q', queryFromUrl);

    params.set('name', entity.name);
    if (entity.description) {
      params.set('description', entity.description);
    }
    if (entity.mood) {
      params.set('mood', entity.mood);
    }

    router.push(`/create?${params.toString()}`);
  }

  // ðŸŽ¯ When user clicks "Plan this"
  function handlePlanClick(entity: Entity) {
    goToPlanForEntity(entity);
  }

  // ðŸŽ² Surprise Me: pick a random entity and jump straight into planning
  function handleSurpriseMe() {
    const pool = filteredEntities.length > 0 ? filteredEntities : data;

    if (!pool || pool.length === 0) {
      setError('No waypoints available to surprise you with yet.');
      return;
    }

    const random = pool[Math.floor(Math.random() * pool.length)];
    goToPlanForEntity(random);
  }

  // Helper to build a share URL for a plan
  function getPlanShareUrl(planId: string): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/p/${encodeURIComponent(planId)}`;
    }
    // Fallback for SSR â€“ still a valid relative link
    return `/p/${encodeURIComponent(planId)}`;
  }

  // ðŸ“… Re-open an existing plan in Calendar
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

  // ðŸ—ºï¸ Open an existing plan in Maps
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

  // âœï¸ Edit an existing plan
  function handleEditPlan(plan: StoredPlan) {
    router.push(`/plan?planId=${encodeURIComponent(plan.id)}`);
  }

  // ðŸ” View shared/summary view of a plan
  function handleViewDetails(plan: StoredPlan) {
    router.push(`/p/${encodeURIComponent(plan.id)}`);
  }

  // ðŸ§· Share a plan via link (MVP: copy link and/or open)
  function handleSharePlan(plan: StoredPlan) {
    const url = getPlanShareUrl(plan.id);

    // Try clipboard first if available
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          window.alert('Share link copied to your clipboard.');
        })
        .catch(() => {
          // Fallback: just open the link
          window.open(url, '_blank', 'noopener,noreferrer');
        });
    } else {
      // No clipboard: open the shareable link
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // ðŸ—‘ï¸ Remove a single plan
  function handleRemovePlan(planId: string) {
    deletePlan(planId);
    setRecentPlans((prev) => prev.filter((p) => p.id !== planId));
  }

  function handleRemoveRecentV2(planId: string) {
    if (userId) {
      supabase.from('waypoints').delete().eq('id', planId).eq('owner_id', userId).then(() => {
        setRecentV2Plans((prev) => prev.filter((p) => p.id !== planId));
      });
    } else {
      removePlanById(planId);
      const refreshed = recentShowSavedOnly ? getSavedPlans() : getRecentPlans();
      setRecentV2Plans(refreshed.slice(0, 8));
    }
  }

  // ðŸ§¹ Clear all plans
  function handleClearAllPlans() {
    if (!window.confirm('Clear all saved plans from this browser?')) return;
    clearPlans();
    setRecentPlans([]);
  }

  // â¤ï¸ Toggle saved waypoint
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

  const waypointHeaderLabel = 'Your Waypoints';

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
    if (authPanelRef.current) {
      authPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        mapped.timeWindow = parts.join(' • ');
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

  function buildPlanFromStarter(starter: v6Starters.PlanStarter, owner: string): Plan {
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
      createdBy: owner,
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
      ownerId: owner,
      originStarterId: starter.id,
    };
  }

  const promoteStarter = useCallback(
    async (starter: v6Starters.PlanStarter) => {
      if (!userId) return;
      if (isPromotingRef.current) return;
      isPromotingRef.current = true;
      setIsPromotingStarter(true);
      setPendingStarterMessage(null);
      try {
        const plan = buildPlanFromStarter(starter, userId);
        const encoded = serializePlan(plan);
        upsertRecentPlan(plan);
        await supabase.from('waypoints').upsert(
          {
            id: plan.id,
            owner_id: userId,
            title: plan.title || starter.intent.primary || 'Waypoint',
            plan,
            parent_id: null,
          },
          { onConflict: 'id' }
        );
        loadSupabaseWaypoints();
        setSelectedStarter(null);
        router.push(`/create?from=${encodeURIComponent(encoded)}`);
      } catch {
        setPendingStarterMessage('Could not start planning right now. Please try again.');
      } finally {
        setIsPromotingStarter(false);
        isPromotingRef.current = false;
      }
    },
    [loadSupabaseWaypoints, router, supabase, userId]
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
      void promoteStarter(parsed);
    } catch {
      window.localStorage.removeItem(PENDING_STARTER_KEY);
    }
  }, [promoteStarter, userId]);

  function handleSelectStarter(starter: v6Starters.PlanStarter) {
    setSelectedStarter(starter);
    setPendingStarterMessage(null);
  }

  function handleGenerateStarter() {
    const generated = v6Starters.createGeneratedStarter({
      intent: { primary: 'Something fun', context: 'Quick jump into planning' },
      constraints: { attributes: ['surprise'] },
    });
    setSelectedStarter(generated);
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
      setPendingStarterMessage('Sign in to save and continue — we’ll keep this starter ready.');
      handleScrollToAuth();
      return;
    }
    void promoteStarter(selectedStarter);
  }

  function handleClearSelectedStarter() {
    setSelectedStarter(null);
    setPendingStarterMessage(null);
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-slate-950 text-slate-50 px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Waypoint
          </h1>
          <p className="text-sm text-slate-400">
            Waypoint is a shareable coordination plan to align on what to do, when, and where.
          </p>
          <p className="text-xs text-slate-500">
            Pick the plan you want, adjust the details, then share the read-only link with
            your crew.
          </p>
        </header>
        {!userId && (
          <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="font-semibold text-slate-100">
                Sign in to sync your Waypoints across devices and save sharable plans.
              </p>
              <p className="text-[11px] text-slate-400">Continue on this device</p>
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
        <div ref={authPanelRef}>
          <AuthPanel />
        </div>

        {/* TEMP/DEV: Share link generator */}
        {showDevTools && (
          <div className="rounded-md border border-dashed border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-100">Dev tools</p>
                <p>Generate and open a prebuilt shared plan.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleOpenSharedView}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-750"
                >
                  Open shared view
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-750"
                >
                  Copy link
                </button>
              </div>
            </div>
            {copyStatus === 'copied' && (
              <p className="text-[11px] text-slate-200">Copied!</p>
            )}
          </div>
        )}

        {/* Discovery: V6 starters */}
        <section className="space-y-3 rounded-lg border border-slate-900/70 bg-slate-900/40 px-3 py-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Start a Waypoint</h2>
            <p className="text-[11px] text-slate-500">
              Pick a template or get a surprise starter.
            </p>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Templates</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {v6Starters.V6_TEMPLATE_STARTERS.map((starter) => {
                  const isSelected = selectedStarter?.id === starter.id;
                  return (
                    <button
                      key={starter.id}
                      type="button"
                      onClick={() => handleSelectStarter(starter)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? 'border-sky-500 bg-sky-500/10 text-slate-50'
                          : 'border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <p className="font-semibold">{starter.intent.primary}</p>
                      {starter.intent.context ? (
                        <p className="text-[11px] text-slate-400">{starter.intent.context}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Surprise me</p>
              <button
                type="button"
                onClick={handleGenerateStarter}
                className="rounded-lg border border-fuchsia-500/70 bg-fuchsia-600/20 px-3 py-2 text-sm font-semibold text-fuchsia-50 hover:bg-fuchsia-600/30"
              >
                Surprise me with a starter
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">From Idea-Date</p>
              <p className="text-[11px] text-slate-500">
                Starter ideas you can adapt into your own Waypoint.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {v6Starters.IDEA_DATE_IMPORTED_STARTERS.map((starter) => {
                  const isSelected = selectedStarter?.id === starter.id;
                  return (
                    <button
                      key={starter.id}
                      type="button"
                      onClick={() => handleSelectStarter(starter)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? 'border-sky-500 bg-sky-500/10 text-slate-50'
                          : 'border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <p className="font-semibold">{starter.intent.primary}</p>
                      {starter.intent.context ? (
                        <p className="text-[11px] text-slate-400">{starter.intent.context}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {selectedStarter && (
            <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
              <p className="text-xs text-slate-300">
                Selected:{' '}
                <span className="font-semibold text-slate-100">
                  {selectedStarter.intent.primary}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStartSelectedStarter}
                  disabled={isPromotingStarter}
                  className={`${ctaClass('primary')} text-[11px] ${
                    isPromotingStarter ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isPromotingStarter ? 'Creating…' : 'Start planning'}
                </button>
                <button
                  type="button"
                  onClick={handleClearSelectedStarter}
                  className={`${ctaClass('chip')} text-[11px]`}
                >
                  Clear
                </button>
              </div>
              {pendingStarterMessage && (
                <p className="text-[11px] text-slate-400">{pendingStarterMessage}</p>
              )}
              <p className="text-[11px] text-slate-500">
                Promotion will be added in Task 3; this just records your pick.
              </p>
            </div>
          )}
        </section>

        {/* Controls */}
        <section className="space-y-3">
          {/* What + Search */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              What are you looking for?
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
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

          {/* Where + Mood + Surprise */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-300">
                Where?
                <span className="ml-1 text-[10px] font-normal text-slate-500">
                  (optional â€“ city, neighborhood, state)
                </span>
              </label>
              <input
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
            </div>

            <div className="flex flex-col gap-2 sm:w-40">
              <label className="text-xs font-medium text-slate-300">Mood</label>
              <select
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

            <div className="flex flex-col gap-2 sm:w-40">
              <span className="text-xs font-medium text-slate-300">
                Feeling indecisive?
              </span>
              <button
                type="button"
                onClick={handleSurpriseMe}
                className="rounded-lg border border-violet-500/70 bg-violet-600/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-100 hover:bg-violet-600/35"
              >
                Surprise me
              </button>
            </div>
          </div>

          {/* Helper hint about natural-language search */}
          <p className="text-[11px] text-slate-500">
            You can use natural phrases like{' '}
            <span className="font-medium text-slate-300">
              &ldquo;cheap date&rdquo;, &ldquo;cozy bar in downtown&rdquo;, or
              &ldquo;birthday dinner&rdquo;
            </span>
            . We match vibes, tags (cost, proximity, use case), and places â€” even with small
            typos.
          </p>
        </section>

        {/* Plans (recent + saved toggle) */}
        <section className="space-y-3 pt-6 mt-6 border-t border-slate-900/60">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">{waypointHeaderLabel}</h2>
            <label className={`${ctaClass('chip')} text-[11px]`}>
              <input
                type="checkbox"
                checked={recentShowSavedOnly}
                onChange={(e) => setRecentShowSavedOnly(e.target.checked)}
              />
              Saved only
            </label>
          </div>
          {migrationMessage ? (
            <div className="rounded-md border border-emerald-700/60 bg-emerald-900/40 px-3 py-2 text-[11px] text-emerald-100">
              {migrationMessage}
            </div>
          ) : null}
          {userId && supabaseLoading ? (
            <p className="text-xs text-slate-400">Loading your Waypoints...</p>
          ) : recentV2Plans.length === 0 ? (
            <p className="text-xs text-slate-400">No Waypoints yet. Create or share one to see it here.</p>
          ) : (
            <ul className="space-y-2">
              {recentV2Plans.map((plan) => (
                <li
                  key={plan.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs flex items-center justify-between gap-3"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-medium text-slate-100 truncate">{plan.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      Updated {new Date(plan.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!plan.encoded) return;
                      router.push(`/plan?p=${encodeURIComponent(plan.encoded)}`);
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
                        const origin = `/plan?p=${encodeURIComponent(plan.encoded)}`;
                        router.push(
                          `/create?from=${encodeURIComponent(plan.encoded)}&origin=${encodeURIComponent(origin)}`
                        );
                      } catch {
                        // ignore invalid payload
                      }
                    }}
                    className="text-[10px] text-slate-300 hover:text-slate-100 underline"
                  >
                    Edit (creates copy)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRecentV2(plan.id)}
                    className={`${ctaClass('danger')} shrink-0 text-[10px]`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        
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
                      {plan.location ?? 'No location'} Â·{' '}
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
                    <button
                      type="button"
                      onClick={() => handleViewDetails(plan)}
                      className="shrink-0 rounded-md border border-indigo-500/70 bg-indigo-600/20 px-2 py-1 text-[10px] font-semibold text-indigo-50 hover:bg-indigo-600/30"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSharePlan(plan)}
                      className="shrink-0 rounded-md border border-fuchsia-500/70 bg-fuchsia-600/20 px-2 py-1 text-[10px] font-semibold text-fuchsia-50 hover:bg-fuchsia-600/30"
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemovePlan(plan.id)}
                      className="shrink-0 rounded-md border border-slate-600/70 bg-slate-800/40 px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-slate-800"
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
                Saved only
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
                {locationStatus === 'requesting' && 'Requesting locationâ€¦'}
                {locationStatus === 'denied' && 'Location denied (using default area)'}
              </span>

              {/* Active filters summary */}
              {(queryFromUrl || moodFromUrl !== 'all') && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {queryFromUrl && (
                    <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300">
                      Query: â€œ{queryFromUrl}â€
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

                const onPlanClick = () => {
                  if (item.source === 'entity') {
                    handlePlanClick(item.entity);
                  } else {
                    const synthetic: Entity = {
                      id,
                      name,
                      description: description ?? '',
                      mood,
                      location: item.saved.location,
                      cost,
                      proximity,
                      useCases,
                    };
                    handlePlanClick(synthetic);
                  }
                };

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
                        <h2 className="text-sm font-medium">{name}</h2>
                        {description && (
                          <p className="text-xs text-slate-400">{description}</p>
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
                          className="text-[11px] text-slate-300 hover:text-rose-400"
                          aria-label={isSaved ? 'Remove from saved' : 'Save waypoint'}
                        >
                          {isSaved ? 'â™¥ Saved' : 'â™¡ Save'}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={onPlanClick}
                        className={`${ctaClass('primary')} text-[11px]`}
                      >
                        Plan this
                      </button>
                    </div>
                  </li>
                );
              })}

              {displayWaypoints.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-xs text-slate-500">
                  {waypointView === 'saved'
                    ? 'You have no saved waypoints yet. Tap the heart on a place to save it.'
                    : 'No waypoints match that search. Try adjusting the What, Where, or mood.'}
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}




