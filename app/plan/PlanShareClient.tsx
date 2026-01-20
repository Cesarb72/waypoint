'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deserializePlan } from '../plan-engine';
import ShareablePlanView from '../surfaces/ShareablePlanView';
import { ctaClass } from '../ui/cta';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import { markPlanShared, isPlanShared } from '../utils/planStorage';
import { useSession } from '../auth/SessionProvider';
import { CLOUD_PLANS_TABLE } from '../lib/cloudTables';
import { withPreservedModeParam } from '../lib/entryMode';
import { useEntryMode } from '../context/EntryModeContext';

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

function sanitizeReturnTo(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    if (!raw.startsWith('/')) return null;
    const url = new URL(raw, 'http://example.com');
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

export default function PlanShareClient() {
  const searchParams = useSearchParams();
  const { mode: entryMode, isReadOnly: isEntryReadOnly } = useEntryMode();
  const encoded = searchParams.get('p');
  const fromEdit = searchParams.get('fromEdit');
  const modeParam = searchParams.get('mode');
  const mode = modeParam === 'edit' || fromEdit === 'true' ? 'edit' : 'view';
  const origin = useMemo(() => sanitizeOrigin(searchParams.get('origin')), [searchParams]);
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('returnTo')),
    [searchParams]
  );
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [isOwned, setIsOwned] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [isShared, setIsShared] = useState(false);
  const transitionRef = useRef<{ mode: string; planId: string | null } | null>(null);

  const { plan, error } = useMemo(() => {
    if (!encoded) return { plan: null, error: null };
    try {
      return { plan: deserializePlan(encoded), error: null };
    } catch (err) {
      return { plan: null, error: (err as Error).message };
    }
  }, [encoded]);

  const backHref = useMemo(() => {
    let nextHref = '/';
    if (returnTo) {
      nextHref = returnTo;
    } else if (origin) {
      nextHref = origin;
    } else if (fromEdit === 'true' && encoded) {
      nextHref = `/create?from=${encodeURIComponent(encoded)}`;
    }
    return withPreservedModeParam(nextHref, searchParams);
  }, [encoded, fromEdit, origin, returnTo, searchParams]);
  const backLabel =
    (returnTo && returnTo.startsWith('/create')) || fromEdit === 'true'
      ? 'Back to editor'
      : returnTo && returnTo.includes('templates=1')
      ? 'Back to templates'
      : 'Back';

  const editorReturnHref = useMemo(() => {
    if (isEntryReadOnly) return null;
    if (returnTo && returnTo.startsWith('/create')) {
      return withPreservedModeParam(returnTo, searchParams);
    }
    if (fromEdit === 'true' && encoded) {
      return withPreservedModeParam(
        `/create?from=${encodeURIComponent(encoded)}`,
        searchParams
      );
    }
    return null;
  }, [encoded, fromEdit, isEntryReadOnly, returnTo, searchParams]);

  const viewMode = useMemo(() => {
    if (editorReturnHref) return 'preview';
    return 'readonly';
  }, [editorReturnHref]);
  const modeLabel = useMemo(() => {
    if (isEntryReadOnly) {
      return `Mode: ${entryMode === 'publish' ? 'Publish' : 'Curate'} (Read-only)`;
    }
    return 'Mode: Plan';
  }, [entryMode, isEntryReadOnly]);

  useEffect(() => {
    const planId = plan?.id ?? null;
    const previous = transitionRef.current;
    if (previous && previous.mode === viewMode && previous.planId === planId) {
      return;
    }
    if (
      previous &&
      process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_DEBUG_ORIGINS === '1'
    ) {
      console.log('[nav] transition', {
        from: previous.mode,
        to: viewMode,
        planId,
      });
    }
    transitionRef.current = { mode: viewMode, planId };
  }, [plan?.id, viewMode]);

  const emptyStateHomeHref = useMemo(
    () => withPreservedModeParam('/', searchParams),
    [searchParams]
  );
  const emptyStateTemplatesHref = useMemo(
    () => withPreservedModeParam('/?templates=1', searchParams),
    [searchParams]
  );
  const emptyStateSearchHref = useMemo(
    () => withPreservedModeParam('/?search=1', searchParams),
    [searchParams]
  );
  const homeHref = useMemo(() => withPreservedModeParam('/', searchParams), [searchParams]);

  if (!encoded) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="px-4 pt-4">
          <Link href={emptyStateHomeHref} className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="px-4 pt-2 text-[11px] text-slate-400">{modeLabel}</div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-3 max-w-sm">
            <h1 className="text-lg font-semibold">No plan selected</h1>
            <p className="text-sm text-slate-400">
              Pick a starting point to open the editor.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={emptyStateHomeHref} className={ctaClass('chip')}>
                Go home
              </Link>
              <Link href={emptyStateTemplatesHref} className={ctaClass('chip')}>
                Go to templates
              </Link>
              <Link href={emptyStateSearchHref} className={ctaClass('chip')}>
                Go to search
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
        <div className="px-4 pt-4">
          <Link href={emptyStateHomeHref} className={ctaClass('chip')}>
            Home
          </Link>
        </div>
        <div className="px-4 pt-2 text-[11px] text-slate-400">{modeLabel}</div>
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center space-y-2 max-w-sm">
            <h1 className="text-lg font-semibold">This plan link looks invalid or incomplete.</h1>
            <p className="text-sm text-slate-400">
              Please check the shared link and try again.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={emptyStateHomeHref} className="text-sm text-sky-300 hover:text-sky-100">
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

  const embedPath = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('p', encoded);
    if (fromEdit) params.set('fromEdit', fromEdit);
    return `/embed?${params.toString()}`;
  }, [encoded, fromEdit]);

  const embedFullUrl = useMemo(() => {
    if (!embedPath) return null;
    return typeof window !== 'undefined' ? `${window.location.origin}${embedPath}` : embedPath;
  }, [embedPath]);

  const createCopyHref = useMemo(() => {
    if (!encoded) return null;
    const params = new URLSearchParams();
    params.set('from', encoded);
    if (sharePath) {
      params.set('origin', sharePath);
    }
    if (returnTo) {
      params.set('returnTo', returnTo);
    }
    return `/create?${params.toString()}`;
  }, [encoded, returnTo, sharePath]);

  useEffect(() => {
    if (plan?.id) {
      setIsShared(isPlanShared(plan.id));
    }
  }, [plan?.id]);

  useEffect(() => {
    let cancelled = false;
    async function checkOwnership() {
      if (!plan?.id || !userId) {
        setIsOwned(false);
        return;
      }
      const { data, error: supaError } = await supabase
        .from(CLOUD_PLANS_TABLE)
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

  async function handleCopyEmbed() {
    if (!embedFullUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(embedFullUrl);
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
        <Link href={homeHref} className={ctaClass('chip')}>
          Home
        </Link>
      </div>
      <div className="px-4 pt-2 text-[11px] text-slate-400">{modeLabel}</div>
      {plan ? (
        <>
          {mode === 'view' || editorReturnHref ? (
            <div className="px-4 pt-2">
              <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 flex items-center justify-between gap-3">
                <span>{viewMode === 'preview' ? 'Preview mode' : 'Read-only preview'}</span>
                {editorReturnHref ? (
                  <Link
                    href={editorReturnHref}
                    className="text-[11px] text-slate-200 hover:text-slate-50"
                  >
                    Back to editor
                  </Link>
                ) : (
                  <Link
                    href={backHref}
                    className="text-[11px] text-slate-200 hover:text-slate-50"
                  >
                    {backLabel}
                  </Link>
                )}
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Read-only. Open in Waypoint to edit.
              </div>
            </div>
          ) : null}
          <ShareablePlanView
            plan={plan}
            isShared={isShared}
            mode={mode}
            actions={
              createCopyHref
                ? {
                    createCopyHref,
                    shareFullUrl,
                    onCopyShare: handleCopyShare,
                    embedFullUrl,
                    onCopyEmbed: handleCopyEmbed,
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
