import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { createOrchestrator } from "../src/server/orchestrator";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";

const tmpDir = path.join(process.cwd(), ".tmp-test-data-graphql");

describe("GraphQL user CRUD (file adapter)", () => {
  let app: express.Express;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const config = normalizeConfig({
      server: { existingApp: express(), basePath: "/api", graphqlPath: "/graphql" },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
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

  it("creates and lists user via GraphQL", async () => {
    const createMutation = `mutation Create($input: JSON!) { createUser(input: $input) { id email } }`;
    const createRes = await request(app)
      .post("/graphql")
      .send({ query: createMutation, variables: { input: { email: "gq@ex.com", password: "p" } } })
      .expect(200);
    expect(createRes.body.data.createUser.id).toBeTruthy();

    const listQuery = `{ userList { id email } }`;
    const listRes = await request(app).post("/graphql").send({ query: listQuery }).expect(200);
    expect(Array.isArray(listRes.body.data.userList)).toBe(true);
    expect(listRes.body.data.userList.length).toBe(1);
  });
});

