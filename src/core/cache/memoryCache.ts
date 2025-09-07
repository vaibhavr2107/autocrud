type Entry<T> = { value: T; expiresAt: number };

export class MemoryCache<T = any> {
  private ttlMs: number;
  private store: Map<string, Entry<T>> = new Map();

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  del(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  keys() {
    return Array.from(this.store.keys());
  }
}
