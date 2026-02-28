'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createEmptyPlan, serializePlan } from '../plan-engine';
import { ctaClass } from '../ui/cta';
import { withEntryMode, withPreservedModeParam } from '../lib/entryMode';
import { useEntryMode } from '../context/EntryModeContext';
import { loadPlanById } from '@/lib/planStorage';
import type { City } from '../data/cityDistricts';
import type { CityDistrict } from '@/types/cityDistrict';

type FeaturedPlan = {
  id: string;
  title: string;
  missing: boolean;
};

type Props = {
  district: CityDistrict;
  city: City;
};

function formatFeaturedPlans(district: CityDistrict): FeaturedPlan[] {
  return district.featuredPlanIds.map((id) => {
    const plan = loadPlanById(id);
    const title = plan?.title?.trim() || `Plan ${id}`;
    return { id, title, missing: !plan };
  });
}

export default function DistrictView({ district, city }: Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { mode: entryMode, isReadOnly: isEntryReadOnly } = useEntryMode();
  const [featuredPlans, setFeaturedPlans] = useState<FeaturedPlan[] | null>(null);

  const search = searchParams.toString();
  const currentHref = useMemo(
    () => `${pathname}${search ? `?${search}` : ''}`,
    [pathname, search]
  );

  const modeLabel = useMemo(() => {
    if (isEntryReadOnly) {
      return `Mode: ${entryMode === 'publish' ? 'Publish' : 'Curate'} (Read-only)`;
    }
    return 'Mode: Plan';
  }, [entryMode, isEntryReadOnly]);

  const backToCityHref = useMemo(
    () => withPreservedModeParam(`/city/${city.slug}`, searchParams),
    [city.slug, searchParams]
  );

  const districtContext = useMemo(() => {
    const districtId = district.id?.trim();
    const districtSlug = district.slug?.trim();
    const districtName = district.name?.trim();
    const cityId = city.id?.trim();
    const citySlug = city.slug?.trim();
    const cityName = city.name?.trim();
    const label =
      districtName && cityName ? `${districtName} (${cityName})` : districtName || '';
    if (!districtId || !districtSlug || !districtName || (!cityId && !citySlug) || !label) {
      return null;
    }
    return {
      id: districtId,
      slug: districtSlug,
      name: districtName,
      cityId: cityId || undefined,
      citySlug: citySlug || undefined,
      cityName: cityName || undefined,
      label,
    };
  }, [city.id, city.name, city.slug, district.id, district.name, district.slug]);

  const openEditorHref = useMemo(() => {
    const plan = createEmptyPlan({
      title: district.name,
      intent: `Plan for ${district.name}`,
    });
    plan.id = `district_${district.id}`;
    plan.context = {
      localNote: `District: ${district.name}`,
      ...(districtContext ? { district: districtContext } : {}),
    };
    const encoded = serializePlan(plan);
    const params = new URLSearchParams();
    params.set('from', encoded);
    params.set('origin', currentHref);
    params.set('returnTo', currentHref);
    return withEntryMode(`/create?${params.toString()}`, 'plan');
  }, [currentHref, district.id, district.name, districtContext]);

  const primaryCtaLabel = isEntryReadOnly
    ? 'Open plan editor (Plan mode)'
    : 'Start planning in this district';

  const handlePrimaryClick = () => {
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_DEBUG_ORIGINS === '1'
    ) {
      console.log('[district] build-plan', {
        districtId: district.id,
        cityId: district.cityId,
        href: openEditorHref,
      });
    }
  };

  useEffect(() => {
    setFeaturedPlans(formatFeaturedPlans(district));
  }, [district]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="px-4 pt-2 text-[11px] text-slate-400">{modeLabel}</div>
      <section className="mx-auto max-w-3xl px-4 py-10 space-y-8">
        <header className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {city.name}
            </p>
            <h1 className="text-3xl font-semibold text-slate-50">{district.name}</h1>
            <p className="text-sm text-slate-300">{district.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={openEditorHref}
              className={ctaClass('primary')}
              onClick={handlePrimaryClick}
            >
              {primaryCtaLabel}
            </Link>
            <Link href={backToCityHref} className={ctaClass('chip')}>
              Back to City
            </Link>
          </div>
          <p className="text-[11px] text-slate-500">This opens the plan editor.</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">Featured plans</h2>
          {featuredPlans === null ? (
            <p className="text-xs text-slate-400">Loading featured plans...</p>
          ) : featuredPlans.length === 0 ? (
            <p className="text-xs text-slate-500">No featured plans yet.</p>
          ) : (
            <ul className="space-y-2">
              {featuredPlans.map((plan) => (
                <li
                  key={plan.id}
                  className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                >
                  {plan.title}
                  {plan.missing ? (
                    <span className="ml-2 text-[11px] text-slate-500">
                      (not in local drafts)
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
