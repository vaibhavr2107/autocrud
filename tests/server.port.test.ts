import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import request from "supertest";
import { normalizeConfig } from "../src/config/internalConfig";
import { loadSchemas } from "../src/core/schemaLoader";
import { createOrchestrator } from "../src/server/orchestrator";

const tmpDir = path.join(process.cwd(), ".tmp-test-data-port");

describe("Server port fallback behavior", () => {
  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws on conflict with fallback=error", async () => {
    // Start first instance on ephemeral port
    const baseConfig = normalizeConfig({
      server: { port: 4000, basePath: "/api", graphqlPath: "/graphql", portFallback: "auto" as any },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const baseSchemas = await loadSchemas(baseConfig);
    const orch1 = createOrchestrator(baseConfig, baseSchemas);
    const { server: srv1 } = await orch1.start();
    const bound = (srv1!.address() as any).port as number;

    // Try second instance on the same port with fallback=error
    const conflictConfig = normalizeConfig({
      server: { port: bound, basePath: "/api", graphqlPath: "/graphql", portFallback: "error" as any },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const conflictSchemas = await loadSchemas(conflictConfig);
    const orch2 = createOrchestrator(conflictConfig, conflictSchemas);
    await expect(orch2.start()).rejects.toThrow(/PORT_ERROR|EADDRINUSE/);
    await orch1.stop();
  });

  it("increments port on conflict when fallback=increment", async () => {
    // First server on ephemeral
    const baseConfig = normalizeConfig({
      server: { port: 4000, basePath: "/api", graphqlPath: "/graphql", portFallback: "auto" as any },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const baseSchemas = await loadSchemas(baseConfig);
    const orch1 = createOrchestrator(baseConfig, baseSchemas);
    const { server: srv1 } = await orch1.start();
    const bound = (srv1!.address() as any).port as number;

    // Second server attempts same port but with increment fallback
    const incConfig = normalizeConfig({
      server: { port: bound, basePath: "/api", graphqlPath: "/graphql", portFallback: "increment" as any, maxPortRetries: 3 },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const incSchemas = await loadSchemas(incConfig);
    const orch2 = createOrchestrator(incConfig, incSchemas);
    const { server: srv2 } = await orch2.start();
    const bound2 = (srv2!.address() as any).port as number;
    expect(bound2).not.toBe(bound);
    const info = await request(`http://localhost:${bound2}`).get("/autocurd-info").expect(200);
    expect(info.body.server.actualPort).toBe(bound2);
    await orch2.stop();
    await orch1.stop();
  });

  it("binds to ephemeral port when fallback=auto", async () => {
    // First server on ephemeral
    const baseConfig = normalizeConfig({
      server: { port: 4000, basePath: "/api", graphqlPath: "/graphql", portFallback: "auto" as any },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const baseSchemas = await loadSchemas(baseConfig);
    const orch1 = createOrchestrator(baseConfig, baseSchemas);
    const { server: srv1 } = await orch1.start();
    const bound = (srv1!.address() as any).port as number;

    // Second server auto-picks a different port
    const autoConfig = normalizeConfig({
      server: { port: bound, basePath: "/api", graphqlPath: "/graphql", portFallback: "auto" as any },
      database: { type: "file", url: tmpDir },
      schemas: { user: { file: "./src/schemas/user.json" } },
    });
    const autoSchemas = await loadSchemas(autoConfig);
    const orch2 = createOrchestrator(autoConfig, autoSchemas);
    const { server: srv2 } = await orch2.start();
    const bound2 = (srv2!.address() as any).port as number;
    expect(bound2).toBeTypeOf("number");
    expect(bound2).not.toBe(bound);
    const info = await request(`http://localhost:${bound2}`).get("/autocurd-info").expect(200);
    expect(info.body.server.actualPort).toBe(bound2);
    await orch2.stop();
    await orch1.stop();
  });
});
