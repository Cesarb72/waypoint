'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { serializePlan, type Plan } from '@/app/plan-engine';
import { ctaClass } from '@/app/ui/cta';

export default function RestaurantToolkitClient() {
  const toolkitPlan = useMemo<Plan>(
    () => ({
      id: 'toolkit-restaurant',
      version: '2.0',
      title: 'Restaurant Night (Template)',
      intent: 'A focused dinner experience with a simple flow.',
      audience: 'guests',
      stops: [
        {
          id: 'anchor-restaurant',
          name: 'Main reservation',
          role: 'anchor',
          optionality: 'required',
          notes: 'Confirm table size, timing, and any dietary notes.',
        },
        {
          id: 'optional-walk',
          name: 'After-dinner stroll',
          role: 'optional',
          optionality: 'flexible',
          notes: 'Short walk or dessert stop nearby if the group wants it.',
        },
      ],
      presentation: {
        shareModes: ['link', 'qr', 'embed'],
      },
      meta: {
        origin: {
          kind: 'toolkit',
          label: 'Restaurant Toolkit',
        },
      },
      origin: {
        kind: 'toolkit',
        label: 'Restaurant Toolkit',
      },
    }),
    []
  );

  const fromPayload = useMemo(() => {
    try {
      return serializePlan(toolkitPlan);
    } catch {
      return '';
    }
  }, [toolkitPlan]);

  const planHref = fromPayload ? `/create?from=${encodeURIComponent(fromPayload)}` : '/create';
  const publishHref = fromPayload
    ? `/create?mode=publish&from=${encodeURIComponent(fromPayload)}`
    : '/create?mode=publish';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-2">
          <Link href="/" className="text-[11px] text-slate-300 hover:text-slate-100">
            Back home
          </Link>
          <h1 className="text-2xl font-semibold">Restaurant Toolkit (V0)</h1>
          <p className="text-sm text-slate-400">
            A focused launcher for restaurant nights with a lightweight starter plan.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link href={planHref} className={`${ctaClass('primary')} text-[11px]`}>
            Create a venue experience
          </Link>
          <Link href={publishHref} className={`${ctaClass('chip')} text-[11px]`}>
            Open in Publish mode
          </Link>
        </div>
      </div>
    </main>
  );
}
