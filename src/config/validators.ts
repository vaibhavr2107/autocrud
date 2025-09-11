export type TransformMap = {
  beforeSave?: Record<string, (val: any, doc?: any) => any>;
  afterRead?: Record<string, (val: any, doc?: any) => any>;
};

export type SchemaConfig = {
  file: string;
  transform?: {
    enabled?: boolean;
    outputFile?: string;
    operations?: TransformMap;
  };
  ops?: Partial<{ create: boolean; read: boolean; readOne: boolean; update: boolean; delete: boolean }>;
};

export type DatabaseType = "file" | "mongodb" | "postgres" | "sqlite";

export type Config = {
  server?: {
    port?: number;
    portFallback?: "error" | "increment" | "auto";
    maxPortRetries?: number;
    existingApp?: any | null;
    basePath?: string; // REST base path, default /api
    graphqlPath?: string; // default /graphql
    restEnabled?: boolean; // default true
    graphqlEnabled?: boolean; // default true
    loggingEnabled?: boolean; // default true
    logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    tracingEnabled?: boolean; // default true (request id)
    metricsEnabled?: boolean; // default true
    metricsPath?: string; // default /autocurd-metrics
    healthEnabled?: boolean; // default true (mount /autocurd-health)
    infoEnabled?: boolean; // default true (mount /autocurd-info)
    listEnabled?: boolean; // default true (mount /autocurd-list)
    schemaHotReloadEnabled?: boolean; // default true
  };
  database?: {
    type: DatabaseType;
    url: string; // connection string or file path directory
  };
  schemas: Record<string, SchemaConfig>;
  joins?: Record<string, {
    base: string; // base schema name
    relations: Array<{
      schema: string; // foreign schema name
      localField: string; // field in base
      foreignField: string; // field in foreign
      as: string; // output field name on base object
      type?: "inner" | "left"; // default inner
    }>;
  }>;
  cache?: {
    enabled?: boolean;
    ttl?: number; // seconds
  };
  functional?: {
    enabled?: boolean;
  };
};

export function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

export function assertConfigShape(candidate: unknown): asserts candidate is Config {
  if (!isObject(candidate)) throw new Error("CONFIG_INVALID: config must be an object");
  if (!("schemas" in candidate)) throw new Error("CONFIG_INVALID: missing 'schemas'");
  if (!isObject((candidate as any).schemas)) throw new Error("CONFIG_INVALID: 'schemas' must be an object");
  const db = (candidate as any).database;
  if (db) {
    if (!isObject(db)) throw new Error("CONFIG_INVALID: 'database' must be an object");
    if (!db.type || !db.url) throw new Error("CONFIG_INVALID: database requires 'type' and 'url'");
  }
  const joins = (candidate as any).joins;
  if (joins) {
    if (!isObject(joins)) throw new Error("CONFIG_INVALID: 'joins' must be an object");
    for (const [name, j] of Object.entries<any>(joins)) {
      if (!isObject(j)) throw new Error(`CONFIG_INVALID: joins.${name} must be object`);
      if (!j.base || !Array.isArray(j.relations)) throw new Error(`CONFIG_INVALID: joins.${name} requires base and relations[]`);
      for (const [i, rel] of (j.relations as any[]).entries()) {
        if (!rel.schema || !rel.localField || !rel.foreignField || !rel.as) {
          throw new Error(`CONFIG_INVALID: joins.${name}.relations[${i}] missing required fields`);
        }
      }
    }
  }
}
