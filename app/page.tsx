'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Entity, Mood } from '@/data/entities';
import { fetchEntities } from '@/lib/entitySource';
import { searchEntities } from '@/lib/searchEntities';
import type { Plan } from '@/lib/planTypes';
import { loadPlans, deletePlan, clearPlans } from '@/lib/planStorage';
import {
  loadSavedWaypoints,
  saveWaypointFromEntity,
  removeSavedWaypoint,
  type SavedWaypoint,
} from '@/lib/savedWaypoints';

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

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 🔌 Data from "API"
  const [data, setData] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 📍 Location (optional)
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'requesting' | 'denied' | 'available'
  >('idle');

  // 💾 Recently created plans (from localStorage)
  const [recentPlans, setRecentPlans] = useState<Plan[]>([]);

  // 💾 Saved waypoints (favorites)
  const [savedWaypoints, setSavedWaypoints] = useState<SavedWaypoint[]>([]);
  const [waypointView, setWaypointView] = useState<'all' | 'saved'>('all');

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
        // User denied or error
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

  // 🔎 Filters from URL (this is the actual query sent to the API)
  const queryFromUrl = searchParams.get('q') ?? '';

  const moodFromUrlRaw = (searchParams.get('mood') as Mood | 'all' | null) ?? 'all';
  const moodFromUrl: Mood | 'all' = MOOD_OPTIONS.includes(moodFromUrlRaw)
    ? moodFromUrlRaw
    : 'all';

  // 📝 Local UX state: "What" and "Where" inputs
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

  // 🔁 Load entities whenever URL query or location changes
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

  // 🧠 Centralized search logic (mood-only filter on client)
  const filteredEntities = useMemo(
    () =>
      searchEntities(data, {
        query: '',
        mood: moodFromUrl,
      }),
    [data, moodFromUrl]
  );

  // 📍 Navigate into planning flow WITH a snapshot of the entity
  function goToPlanForEntity(entity: Entity) {
    const params = new URLSearchParams();

    params.set('entityId', entity.id);
    if (queryFromUrl) params.set('q', queryFromUrl);

    // Snapshot data to survive API differences on the /plan page
    params.set('name', entity.name);
    if ((entity as any).description) {
      params.set('description', (entity as any).description);
    }
    if ((entity as any).mood) {
      params.set('mood', (entity as any).mood);
    }

    router.push(`/plan?${params.toString()}`);
  }

  // 🎯 When user clicks "Plan this"
  function handlePlanClick(entity: Entity) {
    goToPlanForEntity(entity);
  }

  // 🎲 Surprise Me: pick a random entity and jump straight into planning
  function handleSurpriseMe() {
    const pool = filteredEntities.length > 0 ? filteredEntities : data;

    if (!pool || pool.length === 0) {
      setError('No waypoints available to surprise you with yet.');
      return;
    }

    const random = pool[Math.floor(Math.random() * pool.length)];
    goToPlanForEntity(random);
  }

  // 📅 Re-open an existing plan in Calendar
  function handleOpenPlanCalendar(plan: Plan) {
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
    params.set('details', plan.notes ?? '');
    params.set('location', plan.location);
    params.set('dates', compact); // start time only; GCal will infer default duration

    const href = `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.toString()}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  // 🗺️ Open an existing plan in Maps
  function handleOpenPlanMaps(plan: Plan) {
    const query = plan.location || plan.title;
    if (!query) {
      window.alert('This plan is missing a location. Please recreate it from a waypoint.');
      return;
    }

    const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query
    )}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  // ✏️ Edit an existing plan
  function handleEditPlan(plan: Plan) {
    router.push(`/plan?planId=${encodeURIComponent(plan.id)}`);
  }

  // 🗑️ Remove a single plan
  function handleRemovePlan(planId: string) {
    deletePlan(planId);
    setRecentPlans((prev) => prev.filter((p) => p.id !== planId));
  }

  // 🧹 Clear all plans
  function handleClearAllPlans() {
    if (!window.confirm('Clear all saved plans from this browser?')) return;
    clearPlans();
    setRecentPlans([]);
  }

  // ❤️ Toggle saved waypoint
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
    } else {
      // In saved-only view we usually only remove, but keep this here for safety
      // (no-op for add, since we don't know the full entity here).
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

  return (
    <main className="min-h-screen flex flex-col items-center bg-slate-950 text-slate-50 px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Waypoint <span className="text-slate-400">MVP</span>
          </h1>
          <p className="text-sm text-slate-400">
            A simple flow to go from &ldquo;What should we do?&rdquo; to a scheduled plan with live
            places, moods, favorites, and a one-tap surprise.
          </p>
          <p className="text-xs text-slate-500">
            For testers: pick a <span className="font-semibold">What</span>, optionally add a{' '}
            <span className="font-semibold">Where</span>, choose a mood, then either select a
            waypoint, <span className="font-semibold">favorite it</span>, or hit{' '}
            <span className="font-semibold">Surprise me</span>.
          </p>
        </header>

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
                placeholder="e.g. coffee, parks, art museum, live music"
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
                  (optional – city, neighborhood, state)
                </span>
              </label>
              <input
                type="text"
                placeholder="e.g. near me, San Jose, Arizona"
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
              <span className="text-xs font-medium text-slate-300">Feeling indecisive?</span>
              <button
                type="button"
                onClick={handleSurpriseMe}
                className="rounded-lg border border-violet-500/70 bg-violet-600/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-100 hover:bg-violet-600/35"
              >
                Surprise me
              </button>
            </div>
          </div>
        </section>

        {/* Recent plans (still under controls) */}
        {recentPlans.length > 0 && (
          <section className="space-y-2 pt-2 border-t border-slate-900/60">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Recent plans</h2>
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
                  <div className="space-y-0.5">
                    <p className="font-medium text-slate-100 truncate">{plan.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {plan.location} ·{' '}
                      {plan.dateTime
                        ? new Date(plan.dateTime).toLocaleString()
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
                      onClick={() => handleRemovePlan(plan.id)}
                      className="shrink-0 rounded-md border border-slate-600/70 bg-slate-800/40 px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Waypoint view toggle + status + results */}
        <section className="space-y-2 mt-2">
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
                {locationStatus === 'requesting' && 'Requesting location…'}
                {locationStatus === 'denied' && 'Location denied (using default area)'}
              </span>
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
                const name = item.source === 'entity' ? item.entity.name : item.saved.name;
                const description =
                  item.source === 'entity'
                    ? (item.entity as any).description
                    : item.saved.description;
                const mood =
                  item.source === 'entity'
                    ? ((item.entity as any).mood ?? 'chill')
                    : (item.saved.mood ?? 'chill');

                const isSaved = savedWaypoints.some((wp) => wp.id === id);

                const onPlanClick = () => {
                  if (item.source === 'entity') {
                    handlePlanClick(item.entity);
                  } else {
                    // Build a lightweight Entity from saved snapshot
                    const synthetic: Entity = {
                      id,
                      name,
                      description: description ?? '',
                      mood: mood as Mood,
                    } as Entity;
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
                          {isSaved ? '♥ Saved' : '♡ Save'}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={onPlanClick}
                        className="rounded-lg border border-sky-500/70 bg-sky-600/20 px-3 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-600/30"
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
