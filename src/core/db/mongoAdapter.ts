import type { DBAdapter, FindFilter, Pagination, Sort } from "./dbAdapter";
import { v4 as uuidv4 } from "uuid";
import type { NormalizedSchema } from "../schemaLoader";

type MongoClient = any;

export class MongoAdapter implements DBAdapter {
  private url: string;
  private client: MongoClient | null = null;
  private db: any | null = null;

  constructor(url: string) {
    this.url = url;
  }

  async connect() {
    const mod = await import("mongodb");
    const { MongoClient } = (mod as any);
    this.client = new MongoClient(this.url);
    await this.client.connect();
    // Use db from URL or default
    const dbName = (this.client as any).options?.dbName || new URL(this.url).pathname.replace(/^\//, "") || "test";
    this.db = this.client.db(dbName);
  }

  async disconnect() {
    if (this.client) await this.client.close();
    this.client = null;
    this.db = null;
  }

  private ensureDB() {
    if (!this.db) throw new Error("DB_ERROR: Mongo not connected");
    return this.db;
  }

  private collection(schema: NormalizedSchema) {
    const db = this.ensureDB();
    return db.collection(schema.name);
  }

  private toMongoFilter(schema: NormalizedSchema, filter?: FindFilter) {
    if (!filter) return {};
    const q: any = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const sub: any = {};
        for (const [op, ov] of Object.entries<any>(v)) {
          switch (op) {
            case "eq":
              sub.$eq = ov; break;
            case "in":
              sub.$in = Array.isArray(ov) ? ov : [ov]; break;
            case "gt":
              sub.$gt = ov; break;
            case "gte":
              sub.$gte = ov; break;
            case "lt":
              sub.$lt = ov; break;
            case "lte":
              sub.$lte = ov; break;
            case "contains":
              sub.$regex = String(ov);
              sub.$options = "i";
              break;
            default:
              break;
          }
        }
        q[k] = sub;
      } else {
        q[k] = v;
      }
    }
    return q;
  }

  async find(schema: NormalizedSchema, opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort }): Promise<any[]> {
    const col = this.collection(schema);
    const q = this.toMongoFilter(schema, opts.filter);
    const cursor = col.find(q);
    if (opts.sort?.field) cursor.sort({ [opts.sort.field]: opts.sort.direction === "desc" ? -1 : 1 });
    const limit = opts.pagination?.limit ?? 50;
    const offset = opts.pagination?.offset ?? 0;
    const rows = await cursor.skip(offset).limit(limit).toArray();
    return rows.map((r: any) => {
      const { _id, ...rest } = r;
      return rest;
    });
  }

  async findById(schema: NormalizedSchema, id: any): Promise<any | null> {
    const col = this.collection(schema);
    const doc = await col.findOne({ [schema.primaryKey]: id });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }

  async insert(schema: NormalizedSchema, doc: any): Promise<any> {
    const col = this.collection(schema);
    const now = new Date().toISOString();
    const pk = schema.primaryKey;
    const toInsert: any = { ...doc };
    if (schema.timestamps) {
      toInsert.createdAt = toInsert.createdAt ?? now;
      toInsert.updatedAt = toInsert.updatedAt ?? now;
    }
    // Autogen PK if missing (uuid only for Mongo)
    let id = toInsert[pk];
    if (id === undefined && schema.pk.auto) {
      id = uuidv4();
      toInsert[pk] = id;
    }
    if (toInsert[pk]) toInsert._id = toInsert[pk];
    await col.insertOne(toInsert);
    const { _id, ...rest } = toInsert;
    return rest;
  }

  async update(schema: NormalizedSchema, id: any, patch: any): Promise<any | null> {
    const col = this.collection(schema);
    const toSet: any = { ...patch };
    if (schema.timestamps) toSet.updatedAt = new Date().toISOString();
    const res = await col.findOneAndUpdate(
      { [schema.primaryKey]: id },
      { $set: toSet },
      { returnDocument: "after" }
    );
    if (!res.value) return null;
    const { _id, ...rest } = res.value;
    return rest;
  }

  async delete(schema: NormalizedSchema, id: any): Promise<boolean> {
    const col = this.collection(schema);
    const res = await col.deleteOne({ [schema.primaryKey]: id });
    return res.deletedCount > 0;
  }
}
