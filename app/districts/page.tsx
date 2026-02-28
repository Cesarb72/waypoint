import Link from 'next/link';

export default function DistrictsIndexPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">Districts Index</h1>
        <p className="text-sm text-slate-300">
          This index is coming soon. Use a direct slug for now.
        </p>
        <Link href="/" className="text-sm text-slate-300 underline hover:text-slate-100">
          Back to home
        </Link>
      </div>
    </main>
  );
}
