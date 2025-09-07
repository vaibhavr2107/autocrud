import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { createOrchestrator } from "../src/server/orchestrator";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";

const PG_URL = process.env.PG_URL || process.env.POSTGRES_URL;

// Only run if PG_URL provided
const maybeDescribe = PG_URL ? describe : describe.skip;

maybeDescribe("Postgres adapter e2e", () => {
  let app: express.Express;
  let stop: () => Promise<void>;
  let schemaFile: string;
  const tmpSchemasDir = path.join(process.cwd(), ".tmp-pg-schemas");

  beforeAll(async () => {
    await fs.rm(tmpSchemasDir, { recursive: true, force: true });
    await fs.mkdir(tmpSchemasDir, { recursive: true });
    // Create a unique schema name to avoid conflicts
    const unique = `userpg_${Date.now()}`;
    schemaFile = path.join(tmpSchemasDir, `${unique}.json`);
    await fs.writeFile(
      schemaFile,
      JSON.stringify(
        {
          name: unique,
          primaryKey: "id",
          timestamps: true,
          fields: {
            id: { type: "string", required: true },
            email: { type: "string", required: true },
            password: { type: "string" }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    const config = normalizeConfig({
      server: { existingApp: express(), basePath: "/api", graphqlPath: "/graphql" },
      database: { type: "postgres", url: PG_URL },
      schemas: { [unique]: { file: schemaFile } },
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

  it("creates and retrieves via REST using Postgres", async () => {
    // Infer schema name from temp schema file
    const schemaName = path.basename(schemaFile, ".json");
    const create = await request(app)
      .post(`/api/${schemaName}`)
      .send({ email: "pg@ex.com", password: "p" })
      .expect(201);
    const id = create.body.id;
    await request(app).get(`/api/${schemaName}/${id}`).expect(200);
  });
});
