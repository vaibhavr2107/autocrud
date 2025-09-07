import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { DBAdapter, FindFilter, Pagination, Sort } from "./dbAdapter";
import type { NormalizedSchema } from "../schemaLoader";
import { ensureDataDir, schemaDataFile } from "../schemaLoader";

type Store = { data: any[]; byId: Map<any, any> };

export class FileAdapter implements DBAdapter {
  private baseDir: string;
  private stores: Map<string, Store> = new Map();
  private locks: Map<string, Promise<void>> = new Map();
  private seqNext: Map<string, number> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async connect(): Promise<void> {
    await ensureDataDir(this.baseDir);
  }

  async disconnect(): Promise<void> {}

  private async withLock(filePath: string, fn: () => Promise<void>) {
    const current = this.locks.get(filePath) ?? Promise.resolve();
    const next = current.then(fn, fn);
    this.locks.set(filePath, next.catch(() => {}));
    await next;
  }

  private async load(schema: NormalizedSchema): Promise<Store> {
    const file = schemaDataFile(this.baseDir, schema.name);
    const existing = this.stores.get(schema.name);
    if (existing) return existing;
    try {
      const txt = await fs.readFile(file, "utf8");
      let arr: any[];
      try {
        arr = JSON.parse(txt);
      } catch (parseErr) {
        // Attempt to recover from possible corruption by reading backup
        try {
          const bak = await fs.readFile(file + ".bak", "utf8");
          arr = JSON.parse(bak);
        } catch {
          throw parseErr;
        }
      }
      const byId = new Map(arr.map((x: any) => [x[schema.primaryKey], x]));
      if (schema.pk.strategy === "sequence" && schema.pk.type === "number") {
        const maxId = arr.reduce((m, x) => (typeof x[schema.primaryKey] === "number" && x[schema.primaryKey] > m ? x[schema.primaryKey] : m), 0);
        const next = Math.max(schema.pk.start, maxId + schema.pk.step);
        this.seqNext.set(schema.name, next);
      }
      const store = { data: arr, byId };
      this.stores.set(schema.name, store);
      return store;
    } catch (e: any) {
      if (e.code === "ENOENT") {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "[]", "utf8");
        const store = { data: [], byId: new Map() };
        this.stores.set(schema.name, store);
        return store;
      }
      throw e;
    }
  }

  private async persist(schema: NormalizedSchema, store: Store) {
    const file = schemaDataFile(this.baseDir, schema.name);
    const tmp = file + ".tmp";
    const bak = file + ".bak";
    await this.withLock(file, async () => {
      const data = JSON.stringify(store.data, null, 2);
      // Write to temp file first
      await fs.writeFile(tmp, data, "utf8");
      // Replace target file atomically where possible; on Windows, ensure removal first
      try {
        await fs.rename(tmp, file);
      } catch (err) {
        try {
          await fs.rm(file, { force: true });
        } catch {}
        await fs.rename(tmp, file);
      }
      // Update backup (best-effort)
      try {
        await fs.writeFile(bak, data, "utf8");
      } catch {}
    });
  }

  private matches(doc: any, filter: FindFilter | undefined): boolean {
    if (!filter) return true;
    for (const [k, v] of Object.entries(filter)) {
      const dv = doc[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // operators
        for (const [op, ov] of Object.entries<any>(v)) {
          switch (op) {
            case "eq":
              if (dv !== ov) return false;
              break;
            case "in":
              if (!Array.isArray(ov) || !ov.includes(dv)) return false;
              break;
            case "gt":
              if (!(dv > ov)) return false;
              break;
            case "gte":
              if (!(dv >= ov)) return false;
              break;
            case "lt":
              if (!(dv < ov)) return false;
              break;
            case "lte":
              if (!(dv <= ov)) return false;
              break;
            case "contains":
              if (typeof dv === "string") {
                if (!String(dv).includes(String(ov))) return false;
              } else if (Array.isArray(dv)) {
                if (!dv.includes(ov)) return false;
              } else return false;
              break;
            default:
              return false;
          }
        }
      } else {
        if (dv !== v) return false;
      }
    }
    return true;
  }

  private sortDocs(arr: any[], sort?: Sort): any[] {
    if (!sort?.field) return arr;
    const dir = sort.direction === "desc" ? -1 : 1;
    const f = sort.field;
    return [...arr].sort((a, b) => (a[f] > b[f] ? dir : a[f] < b[f] ? -dir : 0));
  }

  async find(schema: NormalizedSchema, opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort }): Promise<any[]> {
    const store = await this.load(schema);
    const filtered = store.data.filter((d) => this.matches(d, opts.filter));
    const sorted = this.sortDocs(filtered, opts.sort);
    const { limit = 50, offset = 0 } = opts.pagination ?? {};
    return sorted.slice(offset, offset + limit);
  }

  async findById(schema: NormalizedSchema, id: any): Promise<any | null> {
    const store = await this.load(schema);
    return store.byId.get(id) ?? null;
  }

  private nextSeq(schema: NormalizedSchema): number {
    const current = this.seqNext.get(schema.name) ?? schema.pk.start;
    this.seqNext.set(schema.name, current + schema.pk.step);
    return current;
  }

  async insert(schema: NormalizedSchema, doc: any): Promise<any> {
    const store = await this.load(schema);
    const now = new Date().toISOString();
    const pk = schema.primaryKey;
    let id = doc[pk];
    if (id === undefined && schema.pk.auto) {
      if (schema.pk.strategy === "uuid") id = uuidv4();
      else if (schema.pk.strategy === "sequence") id = this.nextSeq(schema);
    }
    const toInsert = id === undefined ? { ...doc } : { ...doc, [pk]: id };
    if (schema.timestamps) {
      toInsert.createdAt = now;
      toInsert.updatedAt = now;
    }
    store.data.push(toInsert);
    const key = toInsert[pk];
    if (key !== undefined) store.byId.set(key, toInsert);
    await this.persist(schema, store);
    return toInsert;
  }

  async update(schema: NormalizedSchema, id: any, patch: any): Promise<any | null> {
    const store = await this.load(schema);
    const pk = schema.primaryKey;
    const existing = store.byId.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    if (schema.timestamps) updated.updatedAt = new Date().toISOString();
    const idx = store.data.findIndex((d) => d[pk] === id);
    store.data[idx] = updated;
    store.byId.set(id, updated);
    await this.persist(schema, store);
    return updated;
  }

  async delete(schema: NormalizedSchema, id: any): Promise<boolean> {
    const store = await this.load(schema);
    const pk = schema.primaryKey;
    const idx = store.data.findIndex((d) => d[pk] === id);
    if (idx === -1) return false;
    store.data.splice(idx, 1);
    store.byId.delete(id);
    await this.persist(schema, store);
    return true;
  }
}
