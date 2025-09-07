import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { createOrchestrator } from "../src/server/orchestrator";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URL;
const maybeDescribe = MONGO_URL ? describe : describe.skip;

maybeDescribe("Mongo adapter e2e", () => {
  let app: express.Express;
  let stop: () => Promise<void>;
  const tmpSchemasDir = path.join(process.cwd(), ".tmp-mongo-schemas");
  let schemaName: string;
  let schemaFile: string;

  beforeAll(async () => {
    await fs.rm(tmpSchemasDir, { recursive: true, force: true });
    await fs.mkdir(tmpSchemasDir, { recursive: true });
    schemaName = `usermongo_${Date.now()}`;
    schemaFile = path.join(tmpSchemasDir, `${schemaName}.json`);
    await fs.writeFile(
      schemaFile,
      JSON.stringify(
        {
          name: schemaName,
          primaryKey: "id",
          timestamps: true,
          fields: { id: { type: "string", required: true }, email: { type: "string", required: true } }
        },
        null,
        2
      ),
      "utf8"
    );
    const config = normalizeConfig({
      server: { existingApp: express(), basePath: "/api", graphqlPath: "/graphql" },
      database: { type: "mongodb", url: MONGO_URL },
      schemas: { [schemaName]: { file: schemaFile } },
    });
    const schemas = await loadSchemas(config);
    const orch = createOrchestrator(config, schemas);
    app = orch.app;
    await orch.start();
    stop = orch.stop;
  });

  afterAll(async () => {
    await stop();
    await fs.rm(tmpSchemasDir, { recursive: true, force: true });
  });

  it("creates and retrieves via REST using Mongo", async () => {
    const create = await request(app)
      .post(`/api/${schemaName}`)
      .send({ email: "mg@ex.com" })
      .expect(201);
    const id = create.body.id;
    await request(app).get(`/api/${schemaName}/${id}`).expect(200);
  });
});

