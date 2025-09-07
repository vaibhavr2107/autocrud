import crypto from "node:crypto";
import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchema } from "../schemaLoader";
import { MemoryCache } from "./memoryCache";

export class CacheManager {
  private cache: MemoryCache<any>;
  private enabled: boolean;
  private schemaKeys: Map<string, Set<string>> = new Map();
  private itemKeys: Map<string, Map<string, Set<string>>> = new Map();

  constructor(config: InternalConfig) {
    this.enabled = config.cache.enabled;
    this.cache = new MemoryCache(config.cache.ttl);
  }

  keyForList(schema: NormalizedSchema, payload: any): string {
    const raw = JSON.stringify({ s: schema.name, p: payload });
    return crypto.createHash("sha1").update(raw).digest("hex");
  }

  keyForItem(schema: NormalizedSchema, id: any): string {
    return `${schema.name}:item:${String(id)}`;
  }

  private registerKey(schemaName: string, key: string, id?: string) {
    if (!this.schemaKeys.has(schemaName)) this.schemaKeys.set(schemaName, new Set());
    this.schemaKeys.get(schemaName)!.add(key);
    if (id !== undefined) {
      if (!this.itemKeys.has(schemaName)) this.itemKeys.set(schemaName, new Map());
      const m = this.itemKeys.get(schemaName)!;
      if (!m.has(id)) m.set(id, new Set());
      m.get(id)!.add(key);
    }
  }

  async getOrSet<T>(key: string, fn: () => Promise<T>, meta?: { schema: string; id?: string }): Promise<T> {
    if (!this.enabled) return await fn();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached as T;
    const value = await fn();
    this.cache.set(key, value);
    if (meta) this.registerKey(meta.schema, key, meta.id);
    return value;
  }

  invalidateSchema(schemaName: string) {
    const keys = this.schemaKeys.get(schemaName);
    if (keys) {
      for (const k of keys) this.cache.del(k);
      keys.clear();
    }
    const items = this.itemKeys.get(schemaName);
    if (items) items.clear();
  }

  invalidateById(schemaName: string, id: any) {
    const sid = String(id);
    const itemMap = this.itemKeys.get(schemaName);
    const set = itemMap?.get(sid);
    if (set) {
      for (const k of set) this.cache.del(k);
      set.clear();
      itemMap!.delete(sid);
    }
  }
}
