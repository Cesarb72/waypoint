export type DiscoverySession = {
  path: string;
  queryString: string;
  scrollY: number;
  createdAt: number;
};

const STORAGE_KEY = 'waypoint.discovery.session';
const RESTORE_KEY = 'waypoint.discovery.restore';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function saveDiscoverySession(session: DiscoverySession): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage failures
  }
}

export function loadDiscoverySession(): DiscoverySession | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscoverySession;
    if (!parsed || typeof parsed.path !== 'string' || typeof parsed.queryString !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDiscoverySession(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function markDiscoveryRestore(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(RESTORE_KEY, '1');
  } catch {
    // ignore storage failures
  }
}

export function getDiscoveryRestoreFlag(): boolean {
  if (!hasSessionStorage()) return false;
  try {
    return window.sessionStorage.getItem(RESTORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearDiscoveryRestoreFlag(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(RESTORE_KEY);
  } catch {
    // ignore storage failures
  }
}
