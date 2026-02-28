import Link from 'next/link';
import { notFound } from 'next/navigation';

type ToolkitConfig = {
  name: string;
  description: string;
  status: 'active' | 'coming-soon';
};

const toolkitConfigs: Record<string, ToolkitConfig> = {
  concierge: {
    name: 'Concierge toolkit',
    description: 'Active lens for engine-guided date planning.',
    status: 'active',
  },
  'restaurants-hospitality': {
    name: 'Restaurants & hospitality',
    description: 'Toolkit for venue and hospitality workflows.',
    status: 'coming-soon',
  },
  'tourism-dmo': {
    name: 'Tourism & DMO agencies',
    description: 'Toolkit for destination-level coordination.',
    status: 'coming-soon',
  },
  'events-festivals': {
    name: 'Events & festivals',
    description: 'Toolkit for event arc and attendee flow planning.',
    status: 'coming-soon',
  },
  'community-orgs': {
    name: 'Community organizations',
    description: 'Toolkit for community program routing and planning.',
    status: 'coming-soon',
  },
  'retail-districts': {
    name: 'Retail districts',
    description: 'Toolkit for district-wide partner coordination.',
    status: 'coming-soon',
  },
  'entertainment-venues': {
    name: 'Entertainment venues',
    description: 'Toolkit for event-adjacent itinerary design.',
    status: 'coming-soon',
  },
  'local-business-ecosystems': {
    name: 'Local business ecosystems',
    description: 'Toolkit for cross-business experiences.',
    status: 'coming-soon',
  },
};

type ToolkitPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams(): { slug: string }[] {
  return Object.keys(toolkitConfigs).map((slug) => ({ slug }));
}

export default async function ToolkitDetailPage({ params }: ToolkitPageProps) {
  const { slug } = await params;
  const toolkit = toolkitConfigs[slug];

  if (!toolkit) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 space-y-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Toolkit</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            {toolkit.name}
          </h1>
          <p className="text-sm text-slate-300 sm:text-base">{toolkit.description}</p>

          {toolkit.status === 'active' ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/idea-date"
                className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white"
              >
                Try Idea-Date
              </Link>
              <Link
                href="/toolkits"
                className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100"
              >
                Back to Toolkits
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Coming soon</p>
              <Link
                href="/toolkits"
                className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100"
              >
                Back to Toolkits
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
