"use client";

import { useState } from "react";
import { ENTITIES } from "@/data/entities";

type BookedEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
};

type EntityType = (typeof ENTITIES)[number];

function buildShareMessage(entity: EntityType, notes?: string) {
  const pieces = [
    `Hey — want to check out "${entity.title}"?`,
    entity.location ? `It’s in ${entity.location}.` : "",
    entity.timeLabel ? `Timing: ${entity.timeLabel}.` : "",
    notes ? `Plan: ${notes}` : "",
    "",
    "Planned with Waypoint (early prototype).",
  ].filter(Boolean);

  return pieces.join(" ");
}

export default function Home() {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");

  const [results, setResults] = useState(ENTITIES);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [calendarTarget, setCalendarTarget] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [bookedEvents, setBookedEvents] = useState<BookedEvent[]>([]);

  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  // NEW: notes that belong to the current plan
  const [planNotes, setPlanNotes] = useState("");

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

  const handleAddToCalendar = (id: string) => {
    setCalendarTarget(id);
    setEventDate("");
    setEventTime("");
  };

  const handleShowDetails = (title: string) => {
    alert(`In the full version, this will open more details for "${title}".`);
  };

  const displayedResults = showSavedOnly
    ? results.filter((entity) => savedIds.includes(entity.id))
    : results;

  const selectedEntity =
    selectedId != null
      ? ENTITIES.find((entity) => entity.id === selectedId) ?? null
      : null;

  const calendarEntity =
    calendarTarget != null
      ? ENTITIES.find((entity) => entity.id === calendarTarget) ?? null
      : null;

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

        {/* Profile / account skeleton */}
        <section className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900">
                CB
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Your profile
                </p>
                <p className="text-sm font-semibold text-black dark:text-zinc-50">
                  Cesar (demo account)
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  This MVP keeps everything on your device. Accounts and sign-in
                  will come later.
                </p>
              </div>
            </div>

            <div className="text-right text-xs text-zinc-600 dark:text-zinc-300">
              <p>
                Saved plans:{" "}
                <span className="font-semibold text-black dark:text-zinc-50">
                  {savedIds.length}
                </span>
              </p>
              <p>
                Scheduled events:{" "}
                <span className="font-semibold text-black dark:text-zinc-50">
                  {bookedEvents.length}
                </span>
              </p>
            </div>
          </div>
        </section>

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
                    {/* PLAN button now wires selected plan + share builder */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(entity.id);
                        const msg = buildShareMessage(entity, planNotes);
                        setShareTargetId(entity.id);
                        setShareMessage(msg);
                        setShareCopied(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <span>🧭</span>
                      <span>Plan</span>
                    </button>

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
                      onClick={() => handleAddToCalendar(entity.id)}
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

        {/* Selected plan panel + simple plan builder */}
        {selectedEntity && (
          <section className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Selected plan
                </p>
                <h4 className="text-base font-semibold text-black dark:text-zinc-50">
                  {selectedEntity.title}
                </h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  {selectedEntity.location && (
                    <span>📍 {selectedEntity.location}</span>
                  )}
                  {selectedEntity.timeLabel && (
                    <span className="ml-2">🕒 {selectedEntity.timeLabel}</span>
                  )}
                  {selectedEntity.cost && (
                    <span className="ml-2">💸 {selectedEntity.cost}</span>
                  )}
                </p>
                {selectedEntity.tags && selectedEntity.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedEntity.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setPlanNotes("");
                }}
                className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Clear
              </button>
            </div>

            {/* NEW: simple plan builder notes */}
            <div className="mt-3 space-y-1">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Plan notes (optional)
              </label>
              <textarea
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                rows={3}
                placeholder="Add where to meet, who’s coming, or any extra details."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                These notes stay on this device for now. Later they’ll sync with your account.
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
              <button
                type="button"
                onClick={() => toggleSave(selectedEntity.id)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span>
                  {savedIds.includes(selectedEntity.id) ? "♥" : "♡"}
                </span>
                <span>
                  {savedIds.includes(selectedEntity.id) ? "Saved" : "Save"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleAddToCalendar(selectedEntity.id)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span>🗓</span>
                <span>Add to calendar</span>
              </button>

              <button
                type="button"
                onClick={() => handleShowDetails(selectedEntity.title)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span>⋯</span>
                <span>View details</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  alert(
                    `(MVP stub) This would send the full plan to your calendar or group chat.`
                  )
                }
                className="inline-flex items-center gap-1 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
              >
                <span>📤</span>
                <span>Send plan</span>
              </button>
            </div>
          </section>
        )}

        {/* Share / invite panel */}
        {shareTargetId && (
          <section className="w-full space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Share this plan
            </p>

            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              Copy the invite text below and paste it into your group chat, text, or email.
              In a later version, Waypoint will send this for you.
            </p>

            <textarea
              value={shareMessage}
              onChange={(e) => setShareMessage(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareMessage);
                    setShareCopied(true);
                    alert("Plan copied. Paste it into your chat of choice.");
                  } catch {
                    setShareCopied(false);
                    alert(
                      "Copy failed. You can still select the text above and copy it manually."
                    );
                  }
                }}
                className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
              >
                {shareCopied ? "Copied!" : "Copy invite text"}
              </button>

              <button
                type="button"
                onClick={() => setShareTargetId(null)}
                className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </div>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              This is a stub for now. In the full version, you’ll be able to send directly
              via text, email, or group chat.
            </p>
          </section>
        )}

        {/* Calendar panel */}
        {calendarEntity && (
          <section className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Add to calendar
                </p>
                <h4 className="text-base font-semibold text-black dark:text-zinc-50">
                  {calendarEntity.title}
                </h4>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                  {calendarEntity.location && (
                    <span>📍 {calendarEntity.location}</span>
                  )}
                  {calendarEntity.timeLabel && (
                    <span className="ml-2">🕒 {calendarEntity.timeLabel}</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCalendarTarget(null)}
                className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Time
                </label>
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-black shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
              <button
                type="button"
                onClick={() => {
                  const summaryDate = eventDate || "[date not set]";
                  const summaryTime = eventTime || "[time not set]";

                  setBookedEvents((prev) => [
                    ...prev,
                    {
                      id: calendarEntity.id,
                      title: calendarEntity.title,
                      date: summaryDate,
                      time: summaryTime,
                    },
                  ]);

                  alert(
                    `(MVP stub) This would create a calendar event for "${calendarEntity.title}" on ${summaryDate} at ${summaryTime}.`
                  );

                  setCalendarTarget(null);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
              >
                <span>✅</span>
                <span>Save to calendar</span>
              </button>

              <button
                type="button"
                onClick={() => setCalendarTarget(null)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span>✕</span>
                <span>Cancel</span>
              </button>
            </div>

            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              In a future version, this will sync directly with Google Calendar or
              generate an .ics file you can add anywhere.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
