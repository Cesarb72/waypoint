// app/page.tsx
import { Suspense } from 'react';
import HomePageClient from './HomePageClient';

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <p className="text-sm text-slate-400">Loading…</p>
        </main>
      }
    >
      <HomePageClient />
    </Suspense>
  );
}
