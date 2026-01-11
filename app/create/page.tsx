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
  const originEntityId = Array.isArray(sp?.originEntityId)
    ? sp?.originEntityId[0]
    : sp?.originEntityId;
  const originEntityName = Array.isArray(sp?.originEntityName)
    ? sp?.originEntityName[0]
    : sp?.originEntityName;
  const originQuery = Array.isArray(sp?.originQuery) ? sp?.originQuery[0] : sp?.originQuery;
  const originMood = Array.isArray(sp?.originMood) ? sp?.originMood[0] : sp?.originMood;
  const originSource = Array.isArray(sp?.originSource)
    ? sp?.originSource[0]
    : sp?.originSource;
  const initialOrigin = {
    entityId: originEntityId,
    entityName: originEntityName,
    query: originQuery,
    mood: originMood,
    source: originSource,
  };

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
        initialOrigin={initialOrigin}
      />
    </>
  );
}
