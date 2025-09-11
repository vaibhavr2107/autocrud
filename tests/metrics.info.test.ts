import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { createOrchestrator } from "../src/server/orchestrator";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";

const tmpDir = path.join(process.cwd(), ".tmp-test-data-info");

describe("/autocurd-info reports metricsPathFull", () => {
  let app: express.Express;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    const config = normalizeConfig({
      server: { existingApp: express(), basePath: "/api", graphqlPath: "/graphql", metricsPath: "/autocurd-metrics" },
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

  it("includes full metrics path with base", async () => {
    const res = await request(app).get("/autocurd-info").expect(200);
    expect(res.body?.server?.metricsPathFull).toBe("/api/autocurd-metrics");
  });
});

