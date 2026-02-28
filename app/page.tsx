import Link from 'next/link';

type ToolkitTile = {
  name: string;
  description: string;
  status: 'active' | 'coming-soon';
  href?: string;
  cta?: string;
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
    href: '/idea-date',
    cta: 'Try Idea-Date',
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
    note: 'No /plans index route exists yet.',
  },
  {
    label: 'Districts',
    note: 'No /districts index route exists yet.',
  },
  {
    label: 'Templates',
    note: 'No /templates route exists yet.',
  },
  {
    label: 'Insights',
    href: '/insights/heatmap',
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
            Waypoint is a coordination engine for multi-stop plans across verticals. Concierge is the
            active toolkit today, with additional toolkits rolling out through configuration.
          </p>
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
                <div className="mt-auto">
                  {tile.status === 'active' && tile.href ? (
                    <Link
                      href={tile.href}
                      className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-white"
                    >
                      {tile.cta ?? 'Open'}
                    </Link>
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
                  <p className="text-xs text-slate-500">{item.note ?? 'Route not available yet.'}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}