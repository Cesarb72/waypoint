'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deserializePlan } from '../plan-engine';
import ShareablePlanView from '../surfaces/ShareablePlanView';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import { markPlanShared, isPlanShared } from '../utils/planStorage';

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

export default function PlanShareClient() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get('p');
  const fromEdit = searchParams.get('fromEdit');
  const origin = useMemo(() => sanitizeOrigin(searchParams.get('origin')), [searchParams]);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [isOwned, setIsOwned] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [isShared, setIsShared] = useState(false);

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

  const shareFullUrl = useMemo(() => {
    if (!sharePath) return null;
    return typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath;
  }, [sharePath]);

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
    if (plan?.id) {
      setIsShared(isPlanShared(plan.id));
    }
  }, [plan?.id]);

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

  async function handleCopyShare() {
    if (!shareFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(shareFullUrl);
      if (plan?.id) {
        markPlanShared(plan.id);
        setIsShared(true);
      }
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 1500);
    } catch {
      // Ignore copy failures in preview
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      {/* TEMP/DEV: lightweight escape hatch back to home */}
      <div className="px-4 pt-4">
        <Link href="/" className={ctaClass('chip')}>
          Home
        </Link>
      </div>
      {isShared ? (
        <div className="px-4 pt-2">
          <div className="flex flex-col gap-1 rounded-md border border-emerald-700/60 bg-emerald-900/40 px-3 py-2 text-emerald-50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                Shared
              </span>
              <span className="text-sm font-medium">This plan was shared with you.</span>
            </div>
            <span className="text-[11px] text-emerald-100">Editing will create your own copy.</span>
          </div>
        </div>
      ) : null}
      {plan ? (
        <>
          <ShareablePlanView
            plan={plan}
            isShared={isShared}
            actions={
              createCopyHref
                ? {
                    createCopyHref,
                    shareFullUrl,
                    onCopyShare: handleCopyShare,
                    isShared,
                    shareStatus,
                  }
                : undefined
            }
          />
        </>
      ) : null}
    </main>
  );
}
