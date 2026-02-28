import Link from 'next/link';
import ShareablePlanView from '../../surfaces/ShareablePlanView';
import { getSupabaseServerClient } from '../../lib/supabaseServerClient';
import { getPlanForShare } from '../../lib/planRepository';

type PageProps = {
  params: { planId: string } | Promise<{ planId: string }>;
  searchParams?: SearchParams | Promise<SearchParams>;
};

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(
  searchParams: SearchParams | undefined,
  key: string
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeLogoUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeAccentColor(value: string | null): string | null {
  if (!value) return null;
  const decoded = safeDecode(value) ?? '';
  let trimmed = decoded.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) {
    trimmed = trimmed.slice(1);
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    trimmed = trimmed
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

function sanitizeDescription(value: string | null): string | null {
  if (!value) return null;
  const decoded = safeDecode(value) ?? '';
  const trimmed = decoded.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 160) : null;
}

export default async function SharePlanPage({ params, searchParams }: PageProps) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : undefined;
  const planId = typeof resolvedParams.planId === 'string' ? resolvedParams.planId : '';
  const shareToken =
    readParam(resolvedSearchParams, 't') ?? readParam(resolvedSearchParams, 'token');
  const supabase = await getSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  const plan =
    planId
      ? await getPlanForShare({ supabase, planId, token: shareToken, userId })
      : null;
  const embedParam = readParam(resolvedSearchParams, 'embed');
  const debugParam = readParam(resolvedSearchParams, 'debug');
  const isEmbed = embedParam === '1' || embedParam === 'true';
  const logoOverride = sanitizeLogoUrl(safeDecode(readParam(resolvedSearchParams, 'logo')));
  const accentOverride = sanitizeAccentColor(readParam(resolvedSearchParams, 'accent'));
  const descOverride = sanitizeDescription(readParam(resolvedSearchParams, 'desc'));

  if (!plan) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-lg px-4 py-16 space-y-3 text-center">
          <h1 className="text-lg font-semibold">Plan not found</h1>
          <p className="text-sm text-slate-400">
            This shared plan link is missing or no longer available.
          </p>
          <Link href="/" className="text-sm text-sky-300 hover:text-sky-200">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      {!isEmbed ? (
        <>
          <div className="px-4 pt-4">
            <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
              Home
            </Link>
          </div>
          <div className="px-4 pt-2 text-[11px] text-slate-400">
            Shared plan - Read-only
          </div>
        </>
      ) : null}
      <ShareablePlanView
        plan={plan}
        isShared
        allowNavigation={false}
        readOnly
        embed={isEmbed}
        debug={debugParam === '1'}
        shareConfig={{
          logoUrl: logoOverride,
          accentColor: accentOverride,
          description: descOverride,
        }}
      />
    </main>
  );
}
