import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { generateFunctions } from "../src";

const tmpDir = path.join(process.cwd(), ".tmp-seq-file");

describe("File adapter sequence PK", () => {
  let api: any;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const { functions, stop: s } = await generateFunctions({
      database: { type: "file", url: tmpDir },
      schemas: { product: { file: "./src/schemas/product_seq.json" } },
    });
    api = functions;
    stop = s;
  });

  afterAll(async () => {
    await stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("auto-increments ids when omitted", async () => {
    const a = await api.product.insert({ name: "A", price: 10 });
    const b = await api.product.insert({ name: "B", price: 20 });
    expect(typeof a.id).toBe("number");
    expect(typeof b.id).toBe("number");
    expect(b.id).toBe(a.id + 1);
    const got = await api.product.findById(a.id);
    expect(got?.name).toBe("A");
  });
});

