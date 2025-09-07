import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchemas, NormalizedSchema } from "../../core/schemaLoader";
import type { DBAdapter, FindFilter, Pagination, Sort } from "../../core/db/dbAdapter";
import { applyAfterRead, applyBeforeSave } from "../../core/transform/transformer";
import { CacheManager } from "../../core/cache/cacheManager";
import { executeJoin, listJoins } from "../../core/join/joinExecutor";

export function getCRUD(config: InternalConfig, schemas: NormalizedSchemas, adapter: DBAdapter) {
  const cache = new CacheManager(config);
  const joins = listJoins(config);
  const joinDeps: Record<string, string[]> = {};
  for (const j of joins) {
    for (const rel of [j.base, ...j.relations.map((r) => r.schema)]) {
      if (!joinDeps[rel]) joinDeps[rel] = [];
      const key = `join:${j.name}`;
      if (!joinDeps[rel].includes(key)) joinDeps[rel].push(key);
    }
  }
  function bind(schema: NormalizedSchema) {
    return {
      find: async (opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort } = {}) => {
        const key = cache.keyForList(schema, opts);
        const rows = await cache.getOrSet(key, async () => adapter.find(schema, opts), { schema: schema.name });
        return rows.map((d) => applyAfterRead(config, schema, d));
      },
      findById: async (id: any) => {
        const key = cache.keyForItem(schema, id);
        const one = await cache.getOrSet(key, async () => adapter.findById(schema, id), { schema: schema.name, id: String(id) });
        return one ? applyAfterRead(config, schema, one) : null;
      },
      insert: async (doc: any) => {
        const created = await adapter.insert(schema, applyBeforeSave(config, schema, doc));
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, created[schema.primaryKey]);
        for (const tag of joinDeps[schema.name] ?? []) cache.invalidateSchema(tag);
        return applyAfterRead(config, schema, created);
      },
      update: async (id: any, patch: any) => {
        const updated = await adapter.update(schema, id, applyBeforeSave(config, schema, patch));
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, id);
        for (const tag of joinDeps[schema.name] ?? []) cache.invalidateSchema(tag);
        return updated ? applyAfterRead(config, schema, updated) : null;
      },
      delete: async (id: any) => {
        const ok = await adapter.delete(schema, id);
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, id);
        for (const tag of joinDeps[schema.name] ?? []) cache.invalidateSchema(tag);
        return ok;
      },
    };
  }

  const api: Record<string, ReturnType<typeof bind>> = {};
  for (const schema of Object.values(schemas)) {
    api[schema.name] = bind(schema);
  }
  const joinApi: Record<string, (opts?: { filter?: FindFilter; pagination?: Pagination; sort?: Sort; relations?: Record<string, { filter?: FindFilter; sort?: Sort; pagination?: Pagination }> }) => Promise<any[]>> = {};
  for (const j of joins) {
    joinApi[j.name] = async (opts = {}) => {
      const key = cache.keyForList({ name: `join:${j.name}`, primaryKey: "id", timestamps: false, fields: {} } as any, opts);
      return cache.getOrSet(
        key,
        async () => executeJoin(j, opts, schemas, adapter),
        { schema: `join:${j.name}` }
      );
    };
  }
  return { ...api, join: joinApi } as any;
}
