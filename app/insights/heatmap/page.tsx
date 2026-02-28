import { HeatmapClient } from './HeatmapClient';

export default function HeatmapPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <HeatmapClient />
      </div>
    </main>
  );
}
