import path from "node:path";
import { assertConfigShape, type Config } from "./validators";

export type InternalConfig = {
  server: { port: number; existingApp: any | null; basePath: string; graphqlPath: string; restEnabled: boolean; graphqlEnabled: boolean; loggingEnabled: boolean; logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace"; tracingEnabled: boolean; metricsEnabled: boolean; metricsPath: string; healthEnabled: boolean; infoEnabled: boolean; listEnabled: boolean; schemaHotReloadEnabled: boolean };
  database: { type: "file" | "mongodb" | "postgres" | "sqlite"; url: string };
  schemas: Record<string, { file: string; transform?: Config["schemas"][string]["transform"]; ops?: Partial<{ create: boolean; read: boolean; readOne: boolean; update: boolean; delete: boolean }> }>;
  cache: { enabled: boolean; ttl: number };
  functional: { enabled: boolean };
  cwd: string;
  joins?: Record<string, {
    base: string;
    relations: Array<{ schema: string; localField: string; foreignField: string; as: string; type: "inner" | "left" }>;
  }>;
};

export type { Config };

export function normalizeConfig(userConfig: unknown): InternalConfig {
  assertConfigShape(userConfig);
  const cwd = process.cwd();
  const db = userConfig.database ?? { type: "file", url: path.join(cwd, "data") };
  const server = userConfig.server ?? {};

  const schemas: InternalConfig["schemas"] = {};
  for (const [name, s] of Object.entries(userConfig.schemas)) {
    const filePath = path.isAbsolute(s.file) ? s.file : path.join(cwd, s.file);
    schemas[name] = {
      file: filePath,
      transform: s.transform,
      ops: s.ops,
    };
  }

  return {
    cwd,
    server: {
      port: server.port ?? 4000,
      existingApp: server.existingApp ?? null,
      basePath: server.basePath ?? "/api",
      graphqlPath: server.graphqlPath ?? "/graphql",
      restEnabled: server.restEnabled ?? true,
      graphqlEnabled: server.graphqlEnabled ?? true,
      loggingEnabled: server.loggingEnabled ?? true,
      logLevel: (server.logLevel as any) ?? "info",
      tracingEnabled: server.tracingEnabled ?? true,
      metricsEnabled: server.metricsEnabled ?? true,
      metricsPath: server.metricsPath ?? "/autocurd-metrics",
      healthEnabled: server.healthEnabled ?? true,
      infoEnabled: server.infoEnabled ?? true,
      listEnabled: server.listEnabled ?? true,
      schemaHotReloadEnabled: server.schemaHotReloadEnabled ?? true,
    },
    database: db as any,
    schemas,
    cache: {
      enabled: userConfig.cache?.enabled ?? true,
      ttl: userConfig.cache?.ttl ?? 60,
    },
    functional: { enabled: userConfig.functional?.enabled ?? true },
    joins: userConfig.joins
      ? Object.fromEntries(
          Object.entries(userConfig.joins).map(([name, j]) => [
            name,
            {
              base: j.base,
              relations: j.relations.map((r) => ({
                schema: r.schema,
                localField: r.localField,
                foreignField: r.foreignField,
                as: r.as,
                type: (r.type as any) ?? "inner",
              })),
            },
          ])
        )
      : undefined,
  };
}
