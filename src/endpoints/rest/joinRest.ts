import express from "express";
import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchemas } from "../../core/schemaLoader";
import type { DBAdapter } from "../../core/db/dbAdapter";
import { CacheManager } from "../../core/cache/cacheManager";
import { executeJoin, listJoins } from "../../core/join/joinExecutor";
import crypto from "node:crypto";

function parseQuery(query: any) {
  const filter: Record<string, any> = {};
  const sort: { field?: string; direction?: "asc" | "desc" } = {};
  const pagination: { limit?: number; offset?: number } = {};
  if (query.limit) pagination.limit = Number(query.limit);
  if (query.offset) pagination.offset = Number(query.offset);
  if (query.sort) sort.field = String(query.sort);
  if (query.dir) sort.direction = String(query.dir) === "desc" ? "desc" : "asc";
  for (const [k, v] of Object.entries(query)) {
    if (["limit", "offset", "sort", "dir"].includes(k)) continue;
    filter[k] = v;
  }
  return { filter, sort, pagination };
}

function computeEtag(payload: any) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return `W/"${hash}"`;
}

export function generateJoinRestRouter(config: InternalConfig, schemas: NormalizedSchemas, adapter: DBAdapter) {
  const router = express.Router();
  const cache = new CacheManager(config);
  const joins = listJoins(config);
  if (joins.length === 0) return router;

  for (const j of joins) {
    const path = `/join/${j.name}`;
    router.get(path, async (req, res) => {
      try {
        const { filter, sort, pagination } = parseQuery(req.query);
        let relOpts: any = {};
        if (req.query.relations) {
          try { relOpts = JSON.parse(String(req.query.relations)); } catch {}
        }
        // Also accept alias-specific args like ordersFilter, ordersSortField, etc.
        for (const r of j.relations) {
          const filterKey = `${r.as}Filter`;
          const sortFieldKey = `${r.as}SortField`;
          const sortDirKey = `${r.as}SortDir`;
          const limitKey = `${r.as}Limit`;
          const offsetKey = `${r.as}Offset`;
          const rf = (req.query as any)[filterKey];
          const rSortField = (req.query as any)[sortFieldKey];
          const rSortDir = (req.query as any)[sortDirKey];
          const rLimit = (req.query as any)[limitKey];
          const rOffset = (req.query as any)[offsetKey];
          const obj: any = relOpts[r.as] ?? {};
          if (rf) {
            try { obj.filter = typeof rf === 'string' ? JSON.parse(rf) : rf; } catch { obj.filter = rf; }
          }
          if (rSortField) obj.sort = { field: String(rSortField), direction: String(rSortDir) === 'desc' ? 'desc' : 'asc' };
          if (rLimit || rOffset) obj.pagination = { limit: rLimit ? Number(rLimit) : undefined, offset: rOffset ? Number(rOffset) : undefined };
          if (Object.keys(obj).length) relOpts[r.as] = obj;
        }
        const key = cache.keyForList({ name: `join:${j.name}`, primaryKey: "id", timestamps: false, fields: {} } as any, { filter, sort, pagination, relations: relOpts });
        const rows = await cache.getOrSet(
          key,
          async () => executeJoin(j, { filter, sort, pagination, relations: relOpts }, schemas, adapter),
          { schema: `join:${j.name}` }
        );
        const etag = computeEtag(rows);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        res.setHeader("ETag", etag);
        res.json(rows);
      } catch (e) {
        res.status(500).json({ code: "ERROR", message: (e as Error).message });
      }
    });
  }

  return router;
}
