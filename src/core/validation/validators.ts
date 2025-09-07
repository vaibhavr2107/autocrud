import Ajv from "ajv";
import type { NormalizedSchema, FieldDef } from "../schemaLoader";

const ajv = new Ajv({ allErrors: true, coerceTypes: true, removeAdditional: false });

function jsonSchemaType(field: FieldDef) {
  switch (field.type) {
    case "string":
      return { type: "string", maxLength: field.maxLength };
    case "number":
      return { type: "number", minimum: field.min, maximum: field.max };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string" };
    case "json":
      return {};
  }
}

function buildSchemaObject(schema: NormalizedSchema, partial: boolean) {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [name, def] of Object.entries(schema.fields)) {
    properties[name] = jsonSchemaType(def);
    const isServerManaged = name === schema.primaryKey || name === "createdAt" || name === "updatedAt";
    if (!partial && def.required && !isServerManaged) required.push(name);
  }
  const obj: any = { type: "object", properties, additionalProperties: false };
  if (!partial && required.length) obj.required = required;
  return obj;
}

export function compileCreateValidator(schema: NormalizedSchema) {
  const jsonSchema = buildSchemaObject(schema, false);
  return ajv.compile(jsonSchema);
}

export function compileUpdateValidator(schema: NormalizedSchema) {
  const jsonSchema = buildSchemaObject(schema, true);
  return ajv.compile(jsonSchema);
}

