import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { generateFunctions } from "../src";

const tmpDir = path.join(process.cwd(), ".tmp-test-funcs");

describe("Functional CRUD API (file adapter)", () => {
  let api: any;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const { functions, stop: s } = await generateFunctions({
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    api = functions;
    stop = s;
  });

  afterAll(async () => {
    await stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("performs CRUD via functions", async () => {
    const created = await api.user.insert({ email: "fx@ex.com", password: "p" });
    expect(created.id).toBeTruthy();
    const id = created.id;
    const one = await api.user.findById(id);
    expect(one.email).toBe("fx@ex.com");
    const list = await api.user.find();
    expect(list.length).toBe(1);
    const upd = await api.user.update(id, { role: "member" });
    expect(upd.role).toBe("member");
    const ok = await api.user.delete(id);
    expect(ok).toBe(true);
  });
});

