import Link from 'next/link';

type ToolkitTile = {
  name: string;
  description: string;
  status: 'active' | 'coming-soon';
  ideaDateHref?: string;
};

type QuickLink = {
  label: string;
  href?: string;
  note?: string;
};

const toolkitTiles: ToolkitTile[] = [
  {
    name: 'Concierge Toolkit',
    description: 'Active lens for engine-guided date plan coordination.',
    status: 'active',
    ideaDateHref: '/idea-date',
  },
  {
    name: 'Restaurants & hospitality',
    description: 'Vertical toolkit and operational flows.',
    status: 'coming-soon',
  },
  {
    name: 'Tourism & DMO agencies',
    description: 'Regional discovery and campaign coordination.',
    status: 'coming-soon',
  },
  {
    name: 'Events & festivals',
    description: 'Multi-stop runbooks and attendee journeys.',
    status: 'coming-soon',
  },
  {
    name: 'Community organizations',
    description: 'Program planning and local engagement support.',
    status: 'coming-soon',
  },
  {
    name: 'Retail districts',
    description: 'District-level partner orchestration.',
    status: 'coming-soon',
  },
  {
    name: 'Entertainment venues',
    description: 'Pre/post-event coordination and itinerary framing.',
    status: 'coming-soon',
  },
  {
    name: 'Local business ecosystems',
    description: 'Cross-business bundles and shared destination paths.',
    status: 'coming-soon',
  },
];

const quickLinks: QuickLink[] = [
  {
    label: 'Create a plan',
    href: '/create',
  },
  {
    label: 'Plans / Recent plans',
    note: 'Coming soon',
  },
  {
    label: 'Districts',
    href: '/districts',
  },
  {
    label: 'Templates',
    note: 'Coming soon',
  },
  {
    label: 'Insights',
    href: '/insights',
  },
  {
    label: 'Toolkits',
    href: '/toolkits',
  },
  {
    label: 'Idea-Date',
    href: '/idea-date',
  },
];

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 space-y-10">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Engine-first hub</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            Waypoint
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-300 sm:text-base">
            Waypoint is a coordination engine for multi-stop plans across verticals. Start with the
            active concierge lens, then expand through toolkit configuration.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/toolkits"
              className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white"
            >
              Browse Toolkits
            </Link>
            <Link
              href="/idea-date"
              className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100"
            >
              Try Idea-Date
            </Link>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Toolkit tiles</h2>
            <p className="mt-1 text-sm text-slate-400">Verticalization via configuration.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {toolkitTiles.map((tile) => (
              <article
                key={tile.name}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-3"
              >
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-100">{tile.name}</p>
                  <p className="text-xs text-slate-400">{tile.description}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {tile.status === 'active' ? (
                    <>
                      <Link
                        href="/toolkits/concierge"
                        className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100"
                      >
                        Concierge Toolkit
                      </Link>
                      <Link
                        href={tile.ideaDateHref ?? '/idea-date'}
                        className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white"
                      >
                        Try Idea-Date
                      </Link>
                    </>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
                      Coming soon
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Continue</h2>
            <p className="mt-1 text-sm text-slate-400">Quick links into existing routes.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickLinks.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-2"
              >
                <p className="text-sm font-medium text-slate-100">{item.label}</p>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-xs text-slate-300 hover:text-slate-100 underline"
                  >
                    Open {item.href}
                  </Link>
                ) : (
                  <p className="text-xs text-slate-500">{item.note ?? 'Coming soon'}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
