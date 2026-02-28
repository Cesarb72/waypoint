import Link from 'next/link';

type ToolkitCard = {
  slug: string;
  name: string;
  description: string;
  status: 'active' | 'coming-soon';
};

const toolkitCards: ToolkitCard[] = [
  {
    slug: 'concierge',
    name: 'Concierge toolkit',
    description: 'Active lens for multi-stop date planning.',
    status: 'active',
  },
  {
    slug: 'restaurants-hospitality',
    name: 'Restaurants & hospitality',
    description: 'Venue operations and hospitality planning.',
    status: 'coming-soon',
  },
  {
    slug: 'tourism-dmo',
    name: 'Tourism & DMO agencies',
    description: 'Destination-level itinerary orchestration.',
    status: 'coming-soon',
  },
  {
    slug: 'events-festivals',
    name: 'Events & festivals',
    description: 'Program flow and attendee route coordination.',
    status: 'coming-soon',
  },
  {
    slug: 'community-orgs',
    name: 'Community organizations',
    description: 'Community program and partner workflows.',
    status: 'coming-soon',
  },
  {
    slug: 'retail-districts',
    name: 'Retail districts',
    description: 'District partner coordination and routing.',
    status: 'coming-soon',
  },
  {
    slug: 'entertainment-venues',
    name: 'Entertainment venues',
    description: 'Pre/post-event plan structures.',
    status: 'coming-soon',
  },
  {
    slug: 'local-business-ecosystems',
    name: 'Local business ecosystems',
    description: 'Cross-business bundle coordination.',
    status: 'coming-soon',
  },
];

export default function ToolkitsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 space-y-8">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Toolkits</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            Industry toolkits
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-300 sm:text-base">
            Toolkits package lens behavior by industry. Concierge is active; additional toolkits are
            staged behind the same engine.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {toolkitCards.map((toolkit) => (
            <article
              key={toolkit.slug}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-3"
            >
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-100">{toolkit.name}</p>
                <p className="text-xs text-slate-400">{toolkit.description}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link
                  href={`/toolkits/${toolkit.slug}`}
                  className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100"
                >
                  View toolkit
                </Link>
                {toolkit.status === 'active' ? (
                  <Link
                    href="/idea-date"
                    className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white"
                  >
                    Try Idea-Date
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
                    Coming soon
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
