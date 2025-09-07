import type { DBAdapter, FindFilter, Pagination, Sort } from "./dbAdapter";
import type { NormalizedSchema } from "../schemaLoader";
import { v4 as uuidv4 } from "uuid";

type BetterSqlite3Database = any;

export class SqliteAdapter implements DBAdapter {
  private db: BetterSqlite3Database | null = null;
  private initialized: Set<string> = new Set();

  constructor(private filePath: string) {}

  async connect() {
    try {
      const mod = await import("better-sqlite3");
      const Database = (mod as any).default || (mod as any);
      this.db = new Database(this.filePath);
      this.db.pragma("journal_mode = WAL");
    } catch (e) {
      throw new Error(
        "DB_ERROR: better-sqlite3 not installed or failed to load. Install optional dependency 'better-sqlite3' to use the SQLite adapter."
      );
    }
  }

  async disconnect() {
    if (this.db) this.db.close();
    this.db = null;
    this.initialized.clear();
  }

  private sqlType(t: string): string {
    switch (t) {
      case "string":
        return "TEXT";
      case "number":
        return "REAL";
      case "boolean":
        return "INTEGER";
      case "date":
        return "TEXT"; // ISO string
      case "json":
        return "TEXT"; // serialized JSON
      default:
        return "TEXT";
    }
  }

  private ensureDB() {
    if (!this.db) throw new Error("DB_ERROR: SQLite not connected");
    return this.db;
  }

  private ensureTable(schema: NormalizedSchema) {
    if (this.initialized.has(schema.name)) return;
    const db = this.ensureDB();
    const cols: string[] = [];
    for (const [name, def] of Object.entries(schema.fields)) {
      const baseType = this.sqlType(def.type);
      if (name === schema.primaryKey) {
        if (schema.pk.strategy === "sequence" && def.type === "number") {
          cols.push(`"${name}" INTEGER PRIMARY KEY AUTOINCREMENT`);
        } else {
          cols.push(`"${name}" ${baseType} PRIMARY KEY`);
        }
      } else {
        cols.push(`"${name}" ${baseType}`);
      }
    }
    const sql = `CREATE TABLE IF NOT EXISTS "${schema.name}" (${cols.join(", ")})`;
    db.prepare(sql).run();
    this.initialized.add(schema.name);
  }

  private toDbValue(schema: NormalizedSchema, field: string, value: any) {
    const def = schema.fields[field];
    if (!def) return value;
    if (def.type === "boolean") return value ? 1 : 0;
    if (def.type === "json") return value == null ? null : JSON.stringify(value);
    return value;
  }

  private fromDbRow(schema: NormalizedSchema, row: any) {
    if (!row) return row;
    const out: any = { ...row };
    for (const [field, def] of Object.entries(schema.fields)) {
      const v = out[field];
      if (v === null || v === undefined) continue;
      if (def.type === "boolean") out[field] = v === 1 || v === true;
      if (def.type === "json" && typeof v === "string") {
        try {
          out[field] = JSON.parse(v);
        } catch {}
      }
    }
    return out;
  }

  private buildWhere(filter?: FindFilter) {
    if (!filter || Object.keys(filter).length === 0) return { clause: "", params: [] as any[] };
    const parts: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [op, ov] of Object.entries<any>(v)) {
          switch (op) {
            case "eq":
              parts.push(`"${k}" = ?`);
              params.push(ov);
              break;
            case "in":
              if (!Array.isArray(ov) || ov.length === 0) {
                parts.push("1=0");
              } else {
                parts.push(`"${k}" IN (${ov.map(() => "?").join(",")})`);
                params.push(...ov);
              }
              break;
            case "gt":
              parts.push(`"${k}" > ?`);
              params.push(ov);
              break;
            case "gte":
              parts.push(`"${k}" >= ?`);
              params.push(ov);
              break;
            case "lt":
              parts.push(`"${k}" < ?`);
              params.push(ov);
              break;
            case "lte":
              parts.push(`"${k}" <= ?`);
              params.push(ov);
              break;
            case "contains":
              parts.push(`"${k}" LIKE ?`);
              params.push(`%${ov}%`);
              break;
            default:
              break;
          }
        }
      } else {
        parts.push(`"${k}" = ?`);
        params.push(v);
      }
    }
    const clause = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
    return { clause, params };
  }

  async find(schema: NormalizedSchema, opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort }): Promise<any[]> {
    this.ensureTable(schema);
    const db = this.ensureDB();
    const { clause, params } = this.buildWhere(opts.filter);
    const sort = opts.sort?.field ? `ORDER BY "${opts.sort.field}" ${opts.sort?.direction === "desc" ? "DESC" : "ASC"}` : "";
    const limit = opts.pagination?.limit ?? 50;
    const offset = opts.pagination?.offset ?? 0;
    const sql = `SELECT * FROM "${schema.name}" ${clause} ${sort} LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset);
    return rows.map((r: any) => this.fromDbRow(schema, r));
  }

  async findById(schema: NormalizedSchema, id: any): Promise<any | null> {
    this.ensureTable(schema);
    const db = this.ensureDB();
    const row = db.prepare(`SELECT * FROM "${schema.name}" WHERE "${schema.primaryKey}" = ?`).get(id);
    return row ? this.fromDbRow(schema, row) : null;
  }

  async insert(schema: NormalizedSchema, doc: any): Promise<any> {
    this.ensureTable(schema);
    const db = this.ensureDB();
    const pk = schema.primaryKey;
    const now = new Date().toISOString();
    const id = doc[pk] ?? uuidv4();
    const toInsert: any = { ...doc, [pk]: id };
    if (schema.timestamps) {
      toInsert.createdAt = now;
      toInsert.updatedAt = now;
    }
    let fields = Object.keys(schema.fields);
    if (schema.pk.strategy === "sequence" && toInsert[pk] === undefined) {
      fields = fields.filter((f) => f !== pk);
    }
    const cols = fields.map((f) => `"${f}"`).join(", ");
    const placeholders = fields.map(() => "?").join(", ");
    const values = fields.map((f) => this.toDbValue(schema, f, toInsert[f]));
    const sql = `INSERT INTO "${schema.name}" (${cols}) VALUES (${placeholders})`;
    db.prepare(sql).run(...values);
    const finalId = toInsert[pk] ?? db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
    return await this.findById(schema, finalId);
  }

  async update(schema: NormalizedSchema, id: any, patch: any): Promise<any | null> {
    this.ensureTable(schema);
    const db = this.ensureDB();
    const existing = await this.findById(schema, id);
    if (!existing) return null;
    const updated: any = { ...existing, ...patch };
    if (schema.timestamps) updated.updatedAt = new Date().toISOString();
    const fields = Object.keys(schema.fields).filter((f) => f !== schema.primaryKey);
    const setClause = fields.map((f) => `"${f}" = ?`).join(", ");
    const values = fields.map((f) => this.toDbValue(schema, f, updated[f]));
    const sql = `UPDATE "${schema.name}" SET ${setClause} WHERE "${schema.primaryKey}" = ?`;
    db.prepare(sql).run(...values, id);
    return await this.findById(schema, id);
  }

  async delete(schema: NormalizedSchema, id: any): Promise<boolean> {
    this.ensureTable(schema);
    const db = this.ensureDB();
    const res = db.prepare(`DELETE FROM "${schema.name}" WHERE "${schema.primaryKey}" = ?`).run(id);
    return res.changes > 0;
  }
}
