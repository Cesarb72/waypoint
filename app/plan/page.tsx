// app/plan/page.tsx
import { Suspense } from 'react';
import PlanPageClient from './PlanPageClient';

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <p className="text-sm text-slate-400">Loading planner…</p>
        </main>
      }
    >
      <PlanPageClient />
    </Suspense>
  );
}
