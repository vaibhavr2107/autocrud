import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { createOrchestrator } from "../src/server/orchestrator";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";

const tmpDir = path.join(process.cwd(), ".tmp-test-data");

describe("REST user CRUD (file adapter)", () => {
  let app: express.Express;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const config = normalizeConfig({
      server: { existingApp: express(), basePath: "/api", graphqlPath: "/graphql" },
      database: { type: "file", url: tmpDir },
      schemas: {
        user: { file: "./src/schemas/user.json" },
      },
    });
    const schemas = await loadSchemas(config);
    const orch = createOrchestrator(config, schemas);
    app = orch.app;
    await orch.start();
    stop = orch.stop;
  });

  afterAll(async () => {
    await stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates, reads, updates, deletes a user", async () => {
    const create = await request(app)
      .post("/api/user")
      .send({ email: "a@b.com", password: "secret", role: "admin" })
      .expect(201);
    expect(create.body.id).toBeTruthy();

    const id = create.body.id;

    const read = await request(app).get(`/api/user/${id}`).expect(200);
    expect(read.body.email).toBe("a@b.com");

    const list = await request(app).get(`/api/user`).expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBe(1);

    const upd = await request(app).patch(`/api/user/${id}`).send({ role: "user" }).expect(200);
    expect(upd.body.role).toBe("user");

    await request(app).delete(`/api/user/${id}`).expect(200);

    await request(app).get(`/api/user/${id}`).expect(404);
  });
});

