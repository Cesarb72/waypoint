'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  buildSurpriseMePlan,
  buildSurpriseMePlanGoogle,
  toSeedResolverError,
  withIdeaDateSeedResolverTelemetry,
} from '@/lib/idea-date/seeds';
import { createPlan, setPlan } from '@/lib/idea-date/store';

const googleResolverEnabled = process.env.NEXT_PUBLIC_IDEA_DATE_GOOGLE_RESOLVER === '1';
const debug = process.env.NEXT_PUBLIC_VERTICAL_DEBUG === '1';

function readSeedTelemetry(plan: { meta?: unknown }): { used: string; error: string | null } {
  const meta = typeof plan.meta === 'object' && plan.meta !== null
    ? (plan.meta as Record<string, unknown>)
    : null;
  const ideaDate = meta && typeof meta.ideaDate === 'object' && meta.ideaDate !== null
    ? (meta.ideaDate as Record<string, unknown>)
    : null;
  const telemetry = ideaDate && typeof ideaDate.seedResolverTelemetry === 'object' && ideaDate.seedResolverTelemetry !== null
    ? (ideaDate.seedResolverTelemetry as Record<string, unknown>)
    : null;
  const used = typeof telemetry?.used === 'string' ? telemetry.used : 'unknown';
  const error = typeof telemetry?.error === 'string' && telemetry.error.trim().length > 0
    ? telemetry.error.trim()
    : null;
  return { used, error };
}

export default function IdeaDateLandingPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  async function handleSurpriseMe(): Promise<void> {
    if (debug) {
      console.log(`[idea-date][debug] surprise_click googleResolverEnabled=${googleResolverEnabled}`);
    }
    setIsCreating(true);
    try {
      const id = createPlan({ lens: 'idea-date' });
      let seeded = buildSurpriseMePlan({ id, title: 'Idea-Date: Surprise Me' });
      if (googleResolverEnabled) {
        try {
          if (debug) {
            console.log('[idea-date][debug] google_seeding_start');
          }
          seeded = await buildSurpriseMePlanGoogle({ id, title: 'Idea-Date: Surprise Me' });
          if (debug) {
            const telemetry = readSeedTelemetry(seeded);
            if (telemetry.used === 'google') {
              console.log('[idea-date][debug] google_seeding_success');
            } else {
              console.log(`[idea-date][debug] google_seeding_fallback error=${telemetry.error ?? 'unknown'}`);
            }
          }
        } catch (nextError) {
          const error = toSeedResolverError(nextError);
          if (debug) {
            console.log(`[idea-date][debug] google_seeding_fallback error=${error ?? 'unknown'}`);
          }
          seeded = withIdeaDateSeedResolverTelemetry(seeded, {
            used: 'local',
            count: 0,
            error,
          });
        }
      }
      setPlan(id, seeded);
      if (debug && googleResolverEnabled) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      router.push(`/idea-date/${id}`);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-slate-900">Idea-Date Lens</h1>
        <p className="mt-2 text-sm text-slate-600">
          Engine-first prototype. Start with a messy seed and refine flow, friction, and arc.
        </p>
        <button
          type="button"
          onClick={() => {
            void handleSurpriseMe();
          }}
          disabled={isCreating}
          className="mt-4 w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isCreating ? 'Building...' : 'Surprise Me'}
        </button>
      </div>
    </main>
  );
}
