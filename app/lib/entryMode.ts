export type EntryMode = 'plan' | 'publish' | 'curate';

export const ENTRY_MODES = ['plan', 'publish', 'curate'] as const;
export const DEFAULT_ENTRY_MODE: EntryMode = 'plan';

export function isEntryMode(value: unknown): value is EntryMode {
  return typeof value === 'string' && (ENTRY_MODES as readonly string[]).includes(value);
}

export function getEntryModeFromSearchParams(searchParams: URLSearchParams): EntryMode {
  const value = searchParams.get('mode');
  return isEntryMode(value) ? value : DEFAULT_ENTRY_MODE;
}

function shouldPreserveMode(url: URL): boolean {
  if (url.origin !== 'http://example.com') return false;
  if (url.pathname === '/embed') return false;
  if (url.pathname.startsWith('/p/')) return false;
  return true;
}

export function withEntryMode(href: string, mode: EntryMode): string {
  const url = new URL(href, 'http://example.com');
  if (url.origin !== 'http://example.com') return href;
  if (mode === DEFAULT_ENTRY_MODE) {
    url.searchParams.delete('mode');
  } else {
    url.searchParams.set('mode', mode);
  }
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
}

export function withPreservedMode(href: string, searchParams: URLSearchParams): string {
  const mode = getEntryModeFromSearchParams(searchParams);
  if (mode === DEFAULT_ENTRY_MODE) return href;
  const url = new URL(href, 'http://example.com');
  if (!shouldPreserveMode(url)) return href;
  return withEntryMode(href, mode);
}

export function withPreservedModeParam(href: string, searchParams: URLSearchParams): string {
  const rawMode = searchParams.get('mode');
  if (!isEntryMode(rawMode)) return href;
  const url = new URL(href, 'http://example.com');
  if (!shouldPreserveMode(url)) return href;
  url.searchParams.set('mode', rawMode);
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
}
