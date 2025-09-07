import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchema } from "../schemaLoader";

export function applyBeforeSave(config: InternalConfig, schema: NormalizedSchema, doc: any): any {
  const sconf = config.schemas[schema.name];
  const ops = sconf.transform?.operations?.beforeSave;
  if (!sconf.transform?.enabled || !ops) return doc;
  const out = { ...doc };
  for (const [field, fn] of Object.entries(ops)) {
    try {
      if (field in out) out[field] = (fn as any)(out[field], out);
    } catch (e) {
      throw new Error(`TRANSFORM_ERROR:${schema.name}.${field}: ${(e as Error).message}`);
    }
  }
  return out;
}

export function applyAfterRead(config: InternalConfig, schema: NormalizedSchema, doc: any): any {
  const sconf = config.schemas[schema.name];
  const ops = sconf.transform?.operations?.afterRead;
  if (!sconf.transform?.enabled || !ops) return doc;
  const out = { ...doc };
  for (const [field, fn] of Object.entries(ops)) {
    try {
      if (field in out) out[field] = (fn as any)(out[field], out);
    } catch (e) {
      throw new Error(`TRANSFORM_ERROR:${schema.name}.${field}: ${(e as Error).message}`);
    }
  }
  return out;
}

