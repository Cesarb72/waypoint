"use client";

import { useState } from "react";
import { ENTITIES } from "@/data/entities";

export default function Home() {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");
  const [results, setResults] = useState(ENTITIES);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const handleSearch = () => {
    const queryWhat = what.trim().toLowerCase();
    const queryWhere = where.trim().toLowerCase();
    const queryWhen = when.trim().toLowerCase();

    let filtered = ENTITIES;

    if (queryWhat) {
      filtered = filtered.filter((entity) => {
        const inTitle = entity.title.toLowerCase().includes(queryWhat);
        const inCategory = entity.category.toLowerCase().includes(queryWhat);
        const inTags = entity.tags?.some((tag) =>
          tag.toLowerCase().includes(queryWhat)
        );
        return inTitle || inCategory || inTags;
      });
    }

    if (queryWhere) {
      filtered = filtered.filter((entity) =>
        entity.location.toLowerCase().includes(queryWhere)
      );
    }

    if (queryWhen) {
      filtered = filtered.filter((entity) =>
        (entity.timeLabel ?? "").toLowerCase().includes(queryWhen)
      );
    }

    setResults(filtered);
    // If we're in "saved only" mode, keep that, just filter from new results
  };

  const handleSurprise = () => {
    if (ENTITIES.length === 0) {
      setResults([]);
      return;
    }
    const random = ENTITIES[Math.floor(Math.random() * ENTITIES.length)];
    setResults([random]);
  };

  const toggleSave = (id: string) => {
    setSavedIds((prev) =>
      prev.includes(id) ? prev.filter((savedId) => savedId !== id) : [...prev, id]
    );
  };

  const handleAddToCalendar = (title: string) => {
    alert(
      `Got it. I’ll add "${title}" to your calendar in a future version of Waypoint.`
    );
  };

  const handleShowDetails = (title: string) => {
    alert(
      `In the full version, this will open more details for "${title}".`
    );
  };

  const displayedResults = showSavedOnly
    ? results.filter((entity) => savedIds.includes(entity.id))
    : results;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col gap-10 py-16 px-6 bg-white dark:bg-black sm:px-10">
        {/* Simple header / hero */}
        <header className="w-full space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Waypoint · Early prototype
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Find something to do, then actually make it happen.
          </h1>
          <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Search by what, where, and when. Filter your options or let the
            assistant surprise you with a plan.
          </p>
        </header>

        {/* Search section */}
        <section className="w-full mb-8 space-y-4">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
            Plan your next outing
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                What do you want to do?
              </label>
              <input
                type="text"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                placeholder="Concerts, restaurants, hikes..."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Where?
              </label>
              <input
                type="text"
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="Near me, San Jose, downtown..."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                When?
              </label>
              <input
                type="text"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                placeholder="Tonight, this weekend, Friday 8pm..."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={handleSearch}
              className="inline-flex items-center justify-center rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleSurprise}
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Surprise me
            </button>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            We currently have {ENTITIES.length} sample options available.
          </p>
        </section>

        {/* Results section */}
        <section className="w-full space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Results
            </h3>
            <div className="flex items-center gap-3">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
                {showSavedOnly
                  ? `Showing ${displayedResults.length} saved ${
                      displayedResults.length === 1 ? "item" : "items"
                    }`
                  : `Showing ${displayedResults.length} of ${ENTITIES.length} options`}
              </p>
              <button
                type="button"
                onClick={() => setShowSavedOnly((prev) => !prev)}
                className="text-[11px] font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
              >
                {showSavedOnly ? "Show all" : "View saved only"}
              </button>
            </div>
          </div>

          {displayedResults.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {showSavedOnly
                ? "You haven’t saved anything yet. Try saving a few results first."
                : "No matches yet. Try adjusting what, where, or when — or hit “Surprise me”."}
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {displayedResults.map((entity) => (
                <li
                  key={entity.id}
                  className="flex flex-col rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
                >
                  {/* Category */}
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {entity.category}
                  </p>

                  {/* Title */}
                  <p className="mt-0.5 text-sm font-semibold text-black dark:text-zinc-50">
                    {entity.title}
                  </p>

                  {/* Meta row */}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                    {entity.location && <span>📍 {entity.location}</span>}
                    {entity.timeLabel && <span>🕒 {entity.timeLabel}</span>}
                    {entity.cost && <span>💸 {entity.cost}</span>}
                  </div>

                  {/* Action row */}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
                    <button
                      type="button"
                      onClick={() => toggleSave(entity.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <span>{savedIds.includes(entity.id) ? "♥" : "♡"}</span>
                      <span>
                        {savedIds.includes(entity.id) ? "Saved" : "Save"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAddToCalendar(entity.title)}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <span>🗓</span>
                      <span>Add</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShowDetails(entity.title)}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <span>⋯</span>
                      <span>Details</span>
                    </button>
                  </div>

                  {/* Tags */}
                  {entity.tags && entity.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {entity.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
