import 'server-only';

type CacheRecord<V> = {
  value: V;
  expiresAt: number;
  touchedAt: number;
};

export type ServerTtlCache<K, V> = {
  get: (key: K) => V | null;
  set: (key: K, value: V) => void;
};

export function createServerTtlCache<K, V>(options: {
  ttlMs: number;
  maxEntries: number;
}): ServerTtlCache<K, V> {
  const records = new Map<K, CacheRecord<V>>();

  function evictExpired(now: number): void {
    for (const [key, record] of records) {
      if (record.expiresAt > now) continue;
      records.delete(key);
    }
  }

  function evictOldestIfNeeded(): void {
    while (records.size > options.maxEntries) {
      const oldest = records.keys().next();
      if (oldest.done) return;
      records.delete(oldest.value);
    }
  }

  return {
    get(key: K): V | null {
      const now = Date.now();
      evictExpired(now);
      const record = records.get(key);
      if (!record) return null;
      if (record.expiresAt <= now) {
        records.delete(key);
        return null;
      }
      return record.value;
    },
    set(key: K, value: V): void {
      const now = Date.now();
      evictExpired(now);
      if (records.has(key)) {
        records.delete(key);
      }
      records.set(key, {
        value,
        expiresAt: now + options.ttlMs,
        touchedAt: now,
      });
      evictOldestIfNeeded();
    },
  };
}
