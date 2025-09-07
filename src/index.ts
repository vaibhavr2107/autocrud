import type { InternalConfig } from "./config/internalConfig";
import { normalizeConfig } from "./config/internalConfig";
import { loadSchemas } from "./core/schemaLoader";
import { createOrchestrator } from "./server/orchestrator";
import { getCRUD } from "./endpoints/functions/functionGenerator";
import { FileAdapter } from "./core/db/fileAdapter";
import { MongoAdapter } from "./core/db/mongoAdapter";
import { PostgresAdapter } from "./core/db/postgresAdapter";
import { SqliteAdapter } from "./core/db/sqliteAdapter";
import type { DBAdapter } from "./core/db/dbAdapter";

export type { Config, InternalConfig } from "./config/internalConfig";
export type { SchemaDefinition, NormalizedSchemas } from "./core/schemaLoader";
export type { DBAdapter } from "./core/db/dbAdapter";

export async function buildAutoCRUD(userConfig: unknown) {
  const config: InternalConfig = normalizeConfig(userConfig);
  const schemas = await loadSchemas(config);
  const orchestrator = createOrchestrator(config, schemas);
  return orchestrator;
}

export async function startAutoCRUD(userConfig: unknown) {
  const orchestrator = await buildAutoCRUD(userConfig);
  return orchestrator.start();
}

export { getCRUD } from "./endpoints/functions/functionGenerator";

function createAdapter(config: InternalConfig): DBAdapter {
  const { type, url } = config.database;
  if (type === "file") return new FileAdapter(url);
  if (type === "sqlite") return new SqliteAdapter(url);
  if (type === "mongodb") return new MongoAdapter(url);
  if (type === "postgres") return new PostgresAdapter(url);
  throw new Error(`DB_ERROR: unknown database type ${type}`);
}

export async function generateFunctions(userConfig: unknown) {
  const config: InternalConfig = normalizeConfig(userConfig);
  const schemas = await loadSchemas(config);
  const adapter = createAdapter(config);
  await adapter.connect();
  const functions = getCRUD(config, schemas, adapter);
  return {
    functions,
    stop: async () => {
      await adapter.disconnect();
    },
  };
}
