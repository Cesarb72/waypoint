"use client";

import { useState } from "react";
import { ENTITIES } from "@/data/entities";
import Image from "next/image";

export default function Home() {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");
  const [results, setResults] = useState(ENTITIES);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
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
        <section className="w-full mb-10 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Results
          </h3>

          {results.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No matches yet. Try adjusting what, where, or when — or hit “Surprise
              me.”
            </p>
          ) : (
            <ul className="space-y-3">
              {results.map((entity) => (
                <li
                  key={entity.id}
                  className="rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-black dark:text-zinc-50">
                        {entity.title}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {entity.category} · {entity.location}
                      </p>
                    </div>
                    {entity.cost && (
                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-200">
                        {entity.cost}
                      </span>
                    )}
                  </div>
                  {entity.timeLabel && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      When: {entity.timeLabel}
                    </p>
                  )}
                  {entity.tags && entity.tags.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Tags: {entity.tags.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the page.tsx file.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Looking for a starting point or more instructions? Head over to{" "}
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Templates
            </a>{" "}
            or the{" "}
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Learning
            </a>{" "}
            center.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={16}
            />
            Deploy Now
          </a>
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/8 px-5 transition-colors hover:border-transparent hover:bg-black/4 dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}
