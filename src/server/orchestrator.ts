import express from "express";
import { ApolloServer } from "apollo-server-express";
import http from "node:http";
import type { InternalConfig } from "../config/internalConfig";
import type { NormalizedSchemas } from "../core/schemaLoader";
import { FileAdapter } from "../core/db/fileAdapter";
import { MongoAdapter } from "../core/db/mongoAdapter";
import { PostgresAdapter } from "../core/db/postgresAdapter";
import { SqliteAdapter } from "../core/db/sqliteAdapter";
import type { DBAdapter } from "../core/db/dbAdapter";
import { generateRestRouter } from "../endpoints/rest/restGenerator";
import { generateGraphQL } from "../endpoints/graphql/graphqlGenerator";
import { generateJoinRestRouter } from "../endpoints/rest/joinRest";
import { createLogger } from "../core/observability/logger";
import { Metrics } from "../core/observability/metrics";
import os from "node:os";
import { createRequire } from "node:module";
import { getCRUD } from "../endpoints/functions/functionGenerator";
import fs from "node:fs";
import path from "node:path";
import { loadSchemas as reloadSchemas } from "../core/schemaLoader";

function createAdapter(config: InternalConfig): DBAdapter {
  const { type, url } = config.database;
  if (type === "file") return new FileAdapter(url);
  if (type === "sqlite") return new SqliteAdapter(url);
  if (type === "mongodb") return new MongoAdapter(url);
  if (type === "postgres") return new PostgresAdapter(url);
  throw new Error(`DB_ERROR: unknown database type ${type}`);
}

export function createOrchestrator(config: InternalConfig, schemas: NormalizedSchemas) {
  const adapter = createAdapter(config);
  let app = config.server.existingApp ?? express();
  let httpServer: http.Server | null = null;
  let apollo: ApolloServer | null = null;
  let functions = getCRUD(config, schemas, adapter);
  let latestSDL: string | null = null;
  let watchedDirs: string[] = [];
  let lastReloadAt: string | null = null;
  let lastSchemaError: { message: string; at: string } | null = null;

  // Observability
  const { logger, requestIdMiddleware, requestLoggerMiddleware } = createLogger(config);
  const metrics = new Metrics(config);
  if (config.server.tracingEnabled) app.use(requestIdMiddleware);
  if (config.server.loggingEnabled) app.use(requestLoggerMiddleware);
  if (config.server.metricsEnabled) app.use(metrics.middleware());
  if (config.server.metricsEnabled) {
    app.get(config.server.metricsPath, (_req, res) => {
      res.setHeader("Content-Type", "text/plain; version=0.0.4");
      res.send(metrics.renderPrometheus());
    });
    // Backward-compatible default path at /autocurd-metrics
    if (config.server.metricsPath !== "/autocurd-metrics") {
      app.get("/autocurd-metrics", (_req, res) => {
        res.setHeader("Content-Type", "text/plain; version=0.0.4");
        res.send(metrics.renderPrometheus());
      });
    }
  }

  // Health endpoint
  if (config.server.healthEnabled) {
    app.get("/autocurd-health", (_req, res) => {
      const ok = lastSchemaError == null;
      res.json({ status: ok ? "ok" : "degraded", uptime: process.uptime(), now: new Date().toISOString(), schema: { status: ok ? "ok" : "error", lastError: lastSchemaError } });
    });
  }

  // Info endpoint
  if (config.server.infoEnabled) {
    app.get("/autocurd-info", (_req, res) => {
      let version = "unknown";
      try {
        const require = createRequire(import.meta.url);
        version = require("../../package.json").version ?? version;
      } catch {}
      const info = {
        library: { name: "autocrud_v1", version },
        runtime: { node: process.version, pid: process.pid, platform: process.platform, arch: process.arch, hostname: os.hostname() },
        server: {
          basePath: config.server.basePath,
          graphqlPath: config.server.graphqlPath,
          restEnabled: config.server.restEnabled,
          graphqlEnabled: config.server.graphqlEnabled,
          metricsEnabled: config.server.metricsEnabled,
          metricsPath: config.server.metricsPath,
          loggingEnabled: config.server.loggingEnabled,
          tracingEnabled: config.server.tracingEnabled,
        },
        database: { type: config.database.type },
        schemas: Object.keys(schemas),
        joins: config.joins ? Object.keys(config.joins) : [],
        watch: { dirs: watchedDirs, lastReloadAt },
      };
      res.json(info);
    });
  }

  // Endpoint list
  if (config.server.listEnabled) {
    app.get("/autocurd-list", (_req, res) => {
      const list: any[] = [];
      const baseUrl = `http://localhost:${config.server.port}`;
      // REST per schema
      for (const s of Object.values(schemas)) {
        const ops = config.schemas[s.name]?.ops ?? {};
        if (config.server.restEnabled) {
          if ((ops.read ?? true) !== false) list.push({ method: "GET", path: `${config.server.basePath}/${s.name}`, detail: `List ${s.name}`, curl: `curl -s "${baseUrl}${config.server.basePath}/${s.name}?limit=10"` });
          if ((ops.readOne ?? true) !== false) list.push({ method: "GET", path: `${config.server.basePath}/${s.name}/:id`, detail: `Get ${s.name} by id`, curl: `curl -s "${baseUrl}${config.server.basePath}/${s.name}/<ID>"` });
          if ((ops.create ?? true) !== false) list.push({ method: "POST", path: `${config.server.basePath}/${s.name}`, detail: `Create ${s.name}`, curl: `curl -s -X POST "${baseUrl}${config.server.basePath}/${s.name}" -H "Content-Type: application/json" -d '{"key":"value"}'` });
          if ((ops.update ?? true) !== false) list.push({ method: "PATCH", path: `${config.server.basePath}/${s.name}/:id`, detail: `Update ${s.name}`, curl: `curl -s -X PATCH "${baseUrl}${config.server.basePath}/${s.name}/<ID>" -H "Content-Type: application/json" -d '{"key":"new"}'` });
          if ((ops.delete ?? true) !== false) list.push({ method: "DELETE", path: `${config.server.basePath}/${s.name}/:id`, detail: `Delete ${s.name}`, curl: `curl -s -X DELETE "${baseUrl}${config.server.basePath}/${s.name}/<ID>"` });
        }
      }
      // REST joins
      if (config.server.restEnabled && config.joins) {
        for (const [name, j] of Object.entries(config.joins)) {
          const p = `${config.server.basePath}/join/${name}`;
          const curl = `curl -s "${baseUrl}${p}?limit=10&${j.relations[0]?.as ?? "rel"}SortField=id"`;
          list.push({ method: "GET", path: p, detail: `Join ${name}`, curl });
        }
      }
      // GraphQL
      if (config.server.graphqlEnabled) {
        const p = config.server.graphqlPath;
        const sampleQ = Object.keys(schemas).length ? `${Object.keys(schemas)[0]}List(limit: 5) { ${schemas[Object.keys(schemas)[0]].primaryKey} }` : "_";
        const curlQ = `curl -s -X POST "${baseUrl}${p}" -H "Content-Type: application/json" -d '{"query":"{ ${sampleQ} }"}'`;
        list.push({ method: "POST", path: p, detail: "GraphQL endpoint", curl: curlQ });
      }
      // Observability
      if (config.server.healthEnabled) list.push({ method: "GET", path: "/autocurd-health", detail: "Health", curl: `curl -s "${baseUrl}/autocurd-health"` });
      if (config.server.metricsEnabled) list.push({ method: "GET", path: config.server.metricsPath, detail: "Metrics", curl: `curl -s "${baseUrl}${config.server.metricsPath}"` });
      if (config.server.infoEnabled) list.push({ method: "GET", path: "/autocurd-info", detail: "Info", curl: `curl -s "${baseUrl}/autocurd-info"` });
      res.json(list);
    });
  }

  // Dynamic mount points to support hot-reload of schemas
  const restMount = express.Router();
  const joinMount = express.Router();
  const gqlMount = express.Router();
  app.use(config.server.basePath, restMount);
  app.use(config.server.basePath, joinMount);
  app.use(config.server.graphqlPath, gqlMount);

  let currentRestRouter = generateRestRouter(config, schemas, adapter);
  let currentJoinRouter = generateJoinRestRouter(config, schemas, adapter);
  let currentGraphRouter = express.Router();
  restMount.use((req, res, next) => currentRestRouter(req, res, next));
  joinMount.use((req, res, next) => currentJoinRouter(req, res, next));
  gqlMount.use((req, res, next) => (currentGraphRouter as any)(req, res, next));

  // Docs endpoints: OpenAPI + SDL
  function buildOpenAPI() {
    const require = createRequire(import.meta.url);
    let version = "0.0.0";
    try { version = require("../../package.json").version ?? version; } catch {}
    const basePath = config.server.basePath || "/api";
    const doc: any = { openapi: "3.0.3", info: { title: "autocrud_v1", version }, paths: {} };
    for (const s of Object.values(schemas)) {
      const ops = config.schemas[s.name]?.ops ?? {};
      const base = `${basePath}/${s.name}`;
      if ((ops.read ?? true) !== false) {
        doc.paths[base] = doc.paths[base] || {};
        doc.paths[base].get = { summary: `List ${s.name}`, parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ], responses: { 200: { description: "OK" } } };
      }
      if ((ops.create ?? true) !== false) {
        doc.paths[base] = doc.paths[base] || {};
        doc.paths[base].post = { summary: `Create ${s.name}`, requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } }, responses: { 201: { description: "Created" } } };
      }
      const byId = `${base}/{id}`;
      if ((ops.readOne ?? true) !== false) {
        doc.paths[byId] = doc.paths[byId] || {};
        doc.paths[byId].get = { summary: `Get ${s.name} by id`, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "OK" }, 404: { description: "Not Found" } } };
      }
      if ((ops.update ?? true) !== false) {
        doc.paths[byId] = doc.paths[byId] || {};
        doc.paths[byId].patch = { summary: `Update ${s.name}`, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } }, responses: { 200: { description: "OK" } } };
      }
      if ((ops.delete ?? true) !== false) {
        doc.paths[byId] = doc.paths[byId] || {};
        doc.paths[byId].delete = { summary: `Delete ${s.name}`, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "OK" }, 404: { description: "Not Found" } } };
      }
    }
    if (config.joins) {
      for (const name of Object.keys(config.joins)) {
        const p = `${basePath}/join/${name}`;
        doc.paths[p] = doc.paths[p] || {};
        doc.paths[p].get = { summary: `Join ${name}`, responses: { 200: { description: "OK" } } };
      }
    }
    return doc;
  }
  app.get("/autocurd-openapi.json", (_req, res) => {
    try { res.json(buildOpenAPI()); } catch (e) { res.status(500).json({ error: String(e) }); }
  });
  app.get("/autocurd-sdl", (_req, res) => {
    if (!latestSDL) {
      const graph = generateGraphQL(config, schemas, adapter);
      latestSDL = graph.typeDefs as string;
    }
    res.setHeader("Content-Type", "text/plain");
    res.send(latestSDL);
  });

  let watchers: fs.FSWatcher[] = [];
  const orchestrator: any = {
    app,
    adapter,
    functions,
    async start() {
      await adapter.connect();
      if (config.server.restEnabled) {
        currentRestRouter = generateRestRouter(config, schemas, adapter);
        currentJoinRouter = generateJoinRestRouter(config, schemas, adapter);
      }
      if (config.server.graphqlEnabled) {
        // Build GraphQL server on a sub-router for hot-swap
        const graph = generateGraphQL(config, schemas, adapter);
        apollo = new ApolloServer({ typeDefs: graph.typeDefs, resolvers: graph.resolvers });
        await apollo.start();
        currentGraphRouter = express.Router();
        apollo.applyMiddleware({ app: currentGraphRouter, path: "/" });
        latestSDL = graph.typeDefs as string;
      }
      if (!config.server.existingApp) {
        await new Promise<void>((resolve) => {
          httpServer = app.listen(config.server.port, () => resolve());
        });
      }
      if (config.server.schemaHotReloadEnabled) {
        this.watchSchemas();
      }
      return { app, server: httpServer, apollo };
    },
    async stop() {
      await adapter.disconnect();
      if (apollo) await apollo.stop();
      if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close((e) => (e ? reject(e) : resolve())));
      // Close watchers if any
      for (const w of watchers) try { w.close(); } catch {}
    },
    async watchSchemas() {
      const dirs = Array.from(new Set(Object.values(config.schemas).map((s) => path.dirname(s.file))));
      watchedDirs = dirs;
      let debounce: NodeJS.Timeout | null = null;
      const reload = async () => {
        try {
          // Discover new schema files
          for (const dir of dirs) {
            try {
              const files = fs.readdirSync(dir);
              for (const f of files) {
                if (!f.endsWith('.json')) continue;
                const full = path.join(dir, f);
                const already = Object.values(config.schemas).some((s) => path.resolve(s.file) === path.resolve(full));
                if (!already) {
                  try {
                    const txt = fs.readFileSync(full, 'utf8');
                    const parsed = JSON.parse(txt);
                    if (parsed && typeof parsed.name === 'string' && !config.schemas[parsed.name]) {
                      config.schemas[parsed.name] = { file: full } as any;
                    }
                  } catch {}
                }
              }
            } catch {}
          }
          // Reload schemas
          const newSchemas = await reloadSchemas(config);
          schemas = newSchemas;
          // Rebuild components
          functions = getCRUD(config, schemas, adapter);
          orchestrator.functions = functions;
          if (config.server.restEnabled) {
            currentRestRouter = generateRestRouter(config, schemas, adapter);
            currentJoinRouter = generateJoinRestRouter(config, schemas, adapter);
          }
          if (config.server.graphqlEnabled) {
            if (apollo) await apollo.stop();
            const graph = generateGraphQL(config, schemas, adapter);
            apollo = new ApolloServer({ typeDefs: graph.typeDefs, resolvers: graph.resolvers });
            await apollo.start();
            currentGraphRouter = express.Router();
            apollo.applyMiddleware({ app: currentGraphRouter, path: "/" });
            latestSDL = graph.typeDefs as string;
          }
          lastReloadAt = new Date().toISOString();
          lastSchemaError = null;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          lastSchemaError = { message: msg, at: new Date().toISOString() };
          console.error('Schema hot-reload failed:', e);
        }
      };
      const trigger = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => reload(), 200);
      };
      for (const dir of dirs) {
        try {
          const watcher = fs.watch(dir, { persistent: true }, (_event) => trigger());
          watchers.push(watcher);
        } catch {}
      }
    },
  };

  return orchestrator;
}
