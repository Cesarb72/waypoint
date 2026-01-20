import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ctaClass } from '../../ui/cta';
import { DEFAULT_ENTRY_MODE, isEntryMode, withPreservedModeParam } from '../../lib/entryMode';
import { CITIES, getCityBySlug, getDistrictsForCity } from '../../data/cityDistricts';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(
  searchParams?: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();
  if (!searchParams) return params;
  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      params.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    }
  });
  return params;
}

export default async function CityPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const slug = resolvedParams.slug;
  const city = getCityBySlug(slug);
  if (!city) {
    notFound();
  }

  const districts = getDistrictsForCity(city.id);
  const urlSearchParams = toSearchParams(resolvedSearchParams ?? {});
  const modeParam = urlSearchParams.get('mode');
  const mode = isEntryMode(modeParam) ? modeParam : DEFAULT_ENTRY_MODE;
  const modeLabel =
    mode === 'plan' ? 'Mode: Plan' : `Mode: ${mode === 'publish' ? 'Publish' : 'Curate'} (Read-only)`;
  const homeHref = withPreservedModeParam('/', urlSearchParams);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="px-4 pt-4">
        <Link href={homeHref} className={ctaClass('chip')}>
          Home
        </Link>
      </div>
      <div className="px-4 pt-2 text-[11px] text-slate-400">{modeLabel}</div>
      <section className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">City</p>
          <h1 className="text-3xl font-semibold text-slate-50">{city.name}</h1>
          <p className="text-sm text-slate-300">{city.description}</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">Districts</h2>
          {districts.length === 0 ? (
            <p className="text-xs text-slate-500">No districts configured yet.</p>
          ) : (
            <div className="grid gap-3">
              {districts.map((district) => {
                const districtSlug = district.slug?.trim();
                if (!districtSlug) return null;
                const districtHref = withPreservedModeParam(
                  `/districts/${districtSlug}`,
                  urlSearchParams
                );
                return (
                  <div
                    key={district.id}
                    className="rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3"
                  >
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-slate-100">
                        {district.name}
                      </h3>
                      <p className="text-xs text-slate-400">{district.description}</p>
                    </div>
                    <div className="mt-3">
                      <Link href={districtHref} className={ctaClass('primary')}>
                        View district
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
