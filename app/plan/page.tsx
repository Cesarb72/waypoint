'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deserializePlan } from '../plan-engine';
import ShareablePlanView from '../surfaces/ShareablePlanView';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';

function sanitizeOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    if (!raw.startsWith('/')) return null; // same-origin only
    const url = new URL(raw, 'http://example.com');
    url.searchParams.delete('origin'); // prevent nesting
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

export default function PlanSharePage() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get('p');
  const fromEdit = searchParams.get('fromEdit');
  const origin = useMemo(() => sanitizeOrigin(searchParams.get('origin')), [searchParams]);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [isOwned, setIsOwned] = useState(false);

  const { plan, error } = useMemo(() => {
    if (!encoded) return { plan: null, error: null };
    try {
      return { plan: deserializePlan(encoded), error: null };
    } catch (err) {
      return { plan: null, error: (err as Error).message };
    }
  }, [encoded]);

  if (!encoded) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        {/* TEMP/DEV: lightweight escape hatch back to home */}
        <div className="px-4 pt-4">
          <Link href="/" className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-2 max-w-sm">
            <h1 className="text-lg font-semibold">No plan found</h1>
            <p className="text-sm text-slate-400">
              If you meant to view a shared plan, please check the link and try again.
            </p>
            <div>
              <Link href="/" className="text-sm text-sky-300 hover:text-sky-100">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        {/* TEMP/DEV: lightweight escape hatch back to home */}
        <div className="px-4 pt-4">
          <Link href="/" className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-2 max-w-sm">
            <h1 className="text-lg font-semibold">This plan link looks invalid or incomplete.</h1>
            <p className="text-sm text-slate-400">
              Please check the shared link and try again.
            </p>
            <div>
              <Link href="/" className="text-sm text-sky-300 hover:text-sky-100">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const sharePath = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('p', encoded);
    if (fromEdit) params.set('fromEdit', fromEdit);
    return `/plan?${params.toString()}`;
  }, [encoded, fromEdit]);

  const createCopyHref = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('from', encoded);
    if (sharePath) {
      params.set('origin', sharePath);
    }
    return `/create?${params.toString()}`;
  }, [encoded, sharePath]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    async function checkOwnership() {
      if (!plan?.id || !userId) {
        setIsOwned(false);
        return;
      }
      const { data, error: supaError } = await supabase
        .from('waypoints')
        .select('owner_id')
        .eq('id', plan.id)
        .limit(1);
      if (cancelled) return;
      if (supaError || !data || data.length === 0) {
        setIsOwned(false);
        return;
      }
      setIsOwned(data[0]?.owner_id === userId);
    }
    checkOwnership();
    return () => {
      cancelled = true;
    };
  }, [plan?.id, supabase, userId]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      {/* TEMP/DEV: lightweight escape hatch back to home */}
      <div className="px-4 pt-4">
        <Link href="/" className={ctaClass('chip')}>
          Home
        </Link>
      </div>
      {fromEdit === 'true' && encoded ? (
        <div className="px-4 pt-2">
          <Link href={`/create?from=${encodeURIComponent(encoded)}`} className={ctaClass('chip')}>
            Back to editing this plan
          </Link>
        </div>
      ) : null}
      {origin ? (
        <div className="px-4 pt-2">
          <Link href={origin} className={ctaClass('chip')}>
            Back to your copy
          </Link>
        </div>
      ) : null}
      {createCopyHref ? (
        <div className="px-4 pt-2">
          <Link href={createCopyHref} className={ctaClass('primary')}>
            {isOwned ? 'Edit this plan' : 'Edit your copy'}
          </Link>
          {!isOwned ? (
            <p className="text-[11px] text-slate-400 mt-1">
              This creates your own version. The original won&apos;t change.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="px-4 pt-2">
        <p className="text-xs text-slate-400">
          You're viewing a shared Waypoint. Editing creates your own copy.
        </p>
      </div>
      {plan ? <ShareablePlanView plan={plan} /> : null}
    </main>
  );
}
