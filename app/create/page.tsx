import Link from 'next/link';
import { deserializePlan } from '../plan-engine';
import CreatePlanClient from './CreatePlanClient';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function sanitizeOrigin(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== 'string') return undefined;
    if (!value.startsWith('/')) return undefined; // same-origin only
    const url = new URL(value, 'http://example.com');
    url.searchParams.delete('origin'); // prevent nesting
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return undefined;
  }
}

export default async function Page({ searchParams }: PageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const raw = sp?.from;
  const fromEncoded = Array.isArray(raw) ? raw[0] : raw;
  const originParam = sp?.origin;
  const originUrl = sanitizeOrigin(Array.isArray(originParam) ? originParam[0] : originParam);
  let sourceTitle: string | undefined;

  if (fromEncoded) {
    try {
      sourceTitle = deserializePlan(fromEncoded).title;
    } catch {
      sourceTitle = undefined;
    }
  }

  return (
    <>
      {/* TEMP/DEV: lightweight escape hatch back to home */}
      <div className="px-4 pt-4">
        <Link href="/" className="text-sm text-slate-300 hover:text-slate-100">
          ƒ+? Home
        </Link>
      </div>
      <CreatePlanClient
        fromEncoded={fromEncoded}
        sourceTitle={sourceTitle}
        sourceEncoded={fromEncoded}
        originUrl={originUrl}
      />
    </>
  );
}
