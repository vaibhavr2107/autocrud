import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { generateFunctions } from "../src";

let hasSqlite = true;
try { await import("better-sqlite3"); } catch { hasSqlite = false; }
const maybeDescribe: any = hasSqlite ? describe : describe.skip;

const tmpDir = path.join(process.cwd(), ".tmp-seq-sqlite");
const dbFile = path.join(tmpDir, "test.db");

maybeDescribe("SQLite adapter sequence PK", () => {
  let api: any;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const { functions, stop: s } = await generateFunctions({
      database: { type: "sqlite", url: dbFile },
      schemas: { product: { file: "./src/schemas/product_seq.json" } },
    });
    api = functions;
    stop = s;
  });

  afterAll(async () => {
    await stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("DB assigns autoincrement ids when omitted", async () => {
    const a = await api.product.insert({ name: "A", price: 10 });
    const b = await api.product.insert({ name: "B", price: 20 });
    expect(typeof a.id).toBe("number");
    expect(typeof b.id).toBe("number");
    expect(b.id).toBe(a.id + 1);
  });
});

