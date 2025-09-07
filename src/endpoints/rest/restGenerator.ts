import express from "express";
import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchemas, NormalizedSchema, FieldDef } from "../../core/schemaLoader";
import type { DBAdapter } from "../../core/db/dbAdapter";
import { applyAfterRead, applyBeforeSave } from "../../core/transform/transformer";
import { CacheManager } from "../../core/cache/cacheManager";
import crypto from "node:crypto";
import { compileCreateValidator, compileUpdateValidator } from "../../core/validation/validators";
import { getCRUD } from "../functions/functionGenerator";

function computeEtag(payload: any) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return `W/"${hash}"`;
}

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

export function generateRestRouter(config: InternalConfig, schemas: NormalizedSchemas, adapter: DBAdapter) {
  const router = express.Router();
  const cache = new CacheManager(config);
  const funcs = getCRUD(config, schemas, adapter) as any;

  for (const schema of Object.values(schemas)) {
    const base = `/${schema.name}`;
    const validateCreate = compileCreateValidator(schema);
    const validateUpdate = compileUpdateValidator(schema);

    if (config.schemas[schema.name]?.ops?.read !== false) router.get(base, async (req, res) => {
      try {
        const { filter, sort, pagination } = parseQuery(req.query);
        const cacheKey = cache.keyForList(schema, { filter, sort, pagination });
        const rows = await cache.getOrSet(
          cacheKey,
          async () => funcs[schema.name].find({ filter, sort, pagination }),
          { schema: schema.name }
        );
        const etag = computeEtag(rows);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        res.setHeader("ETag", etag);
        res.json(rows);
      } catch (e) {
        res.status(400).json({ code: "ERROR", message: (e as Error).message });
      }
    });

    if (config.schemas[schema.name]?.ops?.readOne !== false) router.get(`${base}/:id`, async (req, res) => {
      try {
        const key = cache.keyForItem(schema, req.params.id);
        const one = await cache.getOrSet(key, async () => funcs[schema.name].findById(req.params.id), { schema: schema.name, id: String(req.params.id) });
        if (!one) return res.status(404).json({ code: "NOT_FOUND" });
        const transformed = one;
        const etag = computeEtag(transformed.updatedAt ? `${transformed[schema.primaryKey]}-${transformed.updatedAt}` : transformed);
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        res.setHeader("ETag", etag);
        res.json(transformed);
      } catch (e) {
        res.status(500).json({ code: "ERROR", message: (e as Error).message });
      }
    });

    if (config.schemas[schema.name]?.ops?.create !== false) router.post(base, express.json(), async (req, res) => {
      try {
        const ok = validateCreate(req.body);
        if (!ok) throw new Error(`VALIDATION_ERROR: ${JSON.stringify(validateCreate.errors)}`);
        const created = await funcs[schema.name].insert(req.body);
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, created[schema.primaryKey]);
        res.status(201).json(created);
      } catch (e) {
        const msg = (e as Error).message;
        const status = msg.startsWith("VALIDATION_ERROR") ? 400 : 500;
        res.status(status).json({ code: status === 400 ? "VALIDATION_ERROR" : "ERROR", message: msg });
      }
    });

    if (config.schemas[schema.name]?.ops?.update !== false) router.patch(`${base}/:id`, express.json(), async (req, res) => {
      try {
        const ok = validateUpdate(req.body);
        if (!ok) throw new Error(`VALIDATION_ERROR: ${JSON.stringify(validateUpdate.errors)}`);
        const updated = await funcs[schema.name].update(req.params.id, req.body);
        if (!updated) return res.status(404).json({ code: "NOT_FOUND" });
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, req.params.id);
        res.json(updated);
      } catch (e) {
        const msg = (e as Error).message;
        const status = msg.startsWith("VALIDATION_ERROR") ? 400 : 500;
        res.status(status).json({ code: status === 400 ? "VALIDATION_ERROR" : "ERROR", message: msg });
      }
    });

    if (config.schemas[schema.name]?.ops?.delete !== false) router.delete(`${base}/:id`, async (req, res) => {
      try {
        const ok = await funcs[schema.name].delete(req.params.id);
        if (!ok) return res.status(404).json({ code: "NOT_FOUND" });
        cache.invalidateSchema(schema.name);
        cache.invalidateById(schema.name, req.params.id);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ code: "ERROR", message: (e as Error).message });
      }
    });
  }

  return router;
}
