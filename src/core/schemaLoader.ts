import fs from "node:fs/promises";
import path from "node:path";
import type { InternalConfig } from "../config/internalConfig";

export type FieldType = "string" | "number" | "boolean" | "date" | "json";

export type FieldDef = {
  type: FieldType;
  required?: boolean;
  default?: any;
  maxLength?: number;
  min?: number;
  max?: number;
};

export type PrimaryKeyConfig =
  | string
  | {
      name: string;
      auto?: boolean;
      strategy?: "uuid" | "sequence";
      start?: number;
      step?: number;
      type?: FieldType; // default based on strategy
    };

export type SchemaDefinition = {
  name: string;
  primaryKey?: PrimaryKeyConfig; // default { name: "id", auto: true, strategy: "uuid" }
  timestamps?: boolean; // createdAt, updatedAt
  fields: Record<string, FieldDef>;
};

export type NormalizedSchema = Required<Pick<SchemaDefinition, "name" | "fields">> & {
  primaryKey: string;
  timestamps: boolean;
  pk: { name: string; auto: boolean; strategy: "uuid" | "sequence"; start: number; step: number; type: FieldType };
};

export type NormalizedSchemas = Record<string, NormalizedSchema>;

function validateSchema(name: string, data: any): asserts data is SchemaDefinition {
  if (typeof data !== "object" || data == null) throw new Error(`SCHEMA_INVALID:${name}: root must be object`);
  if (!data.fields || typeof data.fields !== "object") throw new Error(`SCHEMA_INVALID:${name}: missing fields`);
  for (const [fname, f] of Object.entries<any>(data.fields)) {
    if (typeof f !== "object" || f == null) throw new Error(`SCHEMA_INVALID:${name}.${fname}: field must be object`);
    if (!f.type) throw new Error(`SCHEMA_INVALID:${name}.${fname}: missing type`);
    if (!["string", "number", "boolean", "date", "json"].includes(f.type))
      throw new Error(`SCHEMA_INVALID:${name}.${fname}: invalid type '${f.type}'`);
  }
}

function normalizeOne(name: string, raw: SchemaDefinition): NormalizedSchema {
  let pkName = "id";
  let pkAuto = true;
  let pkStrategy: "uuid" | "sequence" = "uuid";
  let pkStart = 1;
  let pkStep = 1;
  let pkType: FieldType = "string";
  if (typeof raw.primaryKey === "string") {
    pkName = raw.primaryKey;
  } else if (typeof raw.primaryKey === "object" && raw.primaryKey) {
    pkName = raw.primaryKey.name ?? pkName;
    pkAuto = raw.primaryKey.auto ?? pkAuto;
    pkStrategy = (raw.primaryKey.strategy as any) ?? pkStrategy;
    pkStart = raw.primaryKey.start ?? pkStart;
    pkStep = raw.primaryKey.step ?? pkStep;
    pkType = raw.primaryKey.type ?? (pkStrategy === "sequence" ? "number" : "string");
  }
  const timestamps = raw.timestamps ?? true;
  const fields: Record<string, FieldDef> = { ...raw.fields };
  if (!fields[pkName]) {
    fields[pkName] = { type: pkType, required: true };
  }
  if (timestamps) {
    fields["createdAt"] = fields["createdAt"] ?? { type: "date" };
    fields["updatedAt"] = fields["updatedAt"] ?? { type: "date" };
  }
  return {
    name,
    primaryKey: pkName,
    timestamps,
    fields,
    pk: { name: pkName, auto: pkAuto, strategy: pkStrategy, start: pkStart, step: pkStep, type: pkType },
  };
}

export async function loadSchemas(config: InternalConfig): Promise<NormalizedSchemas> {
  const out: NormalizedSchemas = {};
  for (const [name, s] of Object.entries(config.schemas)) {
    const filePath = s.file;
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    validateSchema(name, data);
    out[name] = normalizeOne(name, data);
  }
  return out;
}

export function ensureDataDir(baseDir: string) {
  return fs.mkdir(baseDir, { recursive: true });
}

export function schemaDataFile(baseDir: string, schemaName: string) {
  return path.join(baseDir, `${schemaName}.json`);
}
