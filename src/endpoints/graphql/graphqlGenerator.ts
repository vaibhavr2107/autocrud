import type { InternalConfig } from "../../config/internalConfig";
import type { NormalizedSchemas, NormalizedSchema, FieldDef } from "../../core/schemaLoader";
import type { DBAdapter } from "../../core/db/dbAdapter";
import { applyAfterRead, applyBeforeSave } from "../../core/transform/transformer";
import { compileCreateValidator, compileUpdateValidator } from "../../core/validation/validators";

function gqlType(f: FieldDef): string {
  switch (f.type) {
    case "string":
      return "String";
    case "number":
      return "Float";
    case "boolean":
      return "Boolean";
    case "date":
      return "String"; // ISO string for MVP
    case "json":
      return "String"; // serialize JSON as string for MVP simplicity
  }
}

function scalarFilterInput(f: FieldDef): string {
  switch (f.type) {
    case "string":
      return "StringFilter";
    case "number":
      return "NumberFilter";
    case "boolean":
      return "BooleanFilter";
    case "date":
      return "DateFilter";
    case "json":
      return "JsonFilter";
  }
}

function buildTypeDefs(config: InternalConfig, schemas: NormalizedSchemas) {
  const types: string[] = [
    "scalar JSON",
    "type Query { _: Boolean }",
    "type Mutation { _: Boolean }",
    // Common filter/sort inputs
    "enum SortDirection { asc desc }",
    "input PaginationInput { limit: Int, offset: Int }",
    "input StringFilter { eq: String, contains: String, in: [String!] }",
    "input NumberFilter { eq: Float, gt: Float, gte: Float, lt: Float, lte: Float, in: [Float!] }",
    "input BooleanFilter { eq: Boolean }",
    "input DateFilter { eq: String, gt: String, gte: String, lt: String, lte: String }",
    "input JsonFilter { eq: String }",
  ];
  const q: string[] = [];
  const m: string[] = [];
  for (const schema of Object.values(schemas)) {
    const fields = Object.entries(schema.fields)
      .map(([n, f]) => `${n}: ${gqlType(f)}`)
      .join("\n  ");
    types.push(`type ${schema.name[0].toUpperCase()}${schema.name.slice(1)} {\n  ${fields}\n}`);
    const typeName = schema.name[0].toUpperCase() + schema.name.slice(1);
    // Per-schema filter and sort
    const filterFields = Object.entries(schema.fields)
      .map(([n, f]) => `${n}: ${scalarFilterInput(f)}`)
      .join("\n  ");
    const sortEnum = `enum ${typeName}SortField { ${Object.keys(schema.fields).join(" ")} }`;
    const sortInput = `input ${typeName}Sort { field: ${typeName}SortField, direction: SortDirection }`;
    const filterInput = `input ${typeName}Filter {\n  ${filterFields}\n}`;
    types.push(sortEnum);
    types.push(sortInput);
    types.push(filterInput);
    const ops = config.schemas[schema.name]?.ops ?? {};
    if (ops.readOne !== false) q.push(`${schema.name}(id: ID!): ${typeName}`);
    if (ops.read !== false)
      q.push(`${schema.name}List(filter: ${typeName}Filter, pagination: PaginationInput, sort: ${typeName}Sort): [${typeName}!]!`);
    if (ops.create !== false) m.push(`create${typeName}(input: JSON!): ${typeName}`);
    if (ops.update !== false) m.push(`update${typeName}(id: ID!, input: JSON!): ${typeName}`);
    if (ops.delete !== false) m.push(`delete${typeName}(id: ID!): Boolean!`);
  }
  const query = `extend type Query {\n  ${q.join("\n  ")}\n}`;
  const mutation = `extend type Mutation {\n  ${m.join("\n  ")}\n}`;
  return [types.join("\n\n"), query, mutation].join("\n\n");
}

export function generateGraphQL(config: InternalConfig, schemas: NormalizedSchemas, adapter: DBAdapter) {
  const typeDefs = buildTypeDefs(config, schemas);
  const resolvers: any = {
    Query: {},
    Mutation: {},
    JSON: {
      __serialize: (v: any) => v,
      __parseValue: (v: any) => v,
      __parseLiteral: (ast: any) => (ast?.value ?? null),
    },
  };

  function toFindFilter(input: any): any {
    const findFilter: any = {};
    if (!input) return findFilter;
    for (const [field, ops] of Object.entries<any>(input)) {
      if (ops == null) continue;
      const obj: any = {};
      for (const [op, val] of Object.entries<any>(ops)) {
        if (val === undefined || val === null) continue;
        if (["eq", "in", "gt", "gte", "lt", "lte", "contains"].includes(op)) obj[op] = val;
      }
      if (Object.keys(obj).length) findFilter[field] = obj;
    }
    return findFilter;
  }
  for (const schema of Object.values(schemas)) {
    const typeName = schema.name[0].toUpperCase() + schema.name.slice(1);
    const validateCreate = compileCreateValidator(schema);
    const validateUpdate = compileUpdateValidator(schema);
    if ((config.schemas[schema.name]?.ops?.readOne ?? true) !== false) {
      resolvers.Query[schema.name] = async (_: any, { id }: any) => {
        const found = await adapter.findById(schema, id);
        return found ? applyAfterRead(config, schema, found) : null;
      };
    }
    if ((config.schemas[schema.name]?.ops?.read ?? true) !== false) {
      resolvers.Query[`${schema.name}List`] = async (_: any, { filter, pagination, sort }: any) => {
        const findFilter = toFindFilter(filter);
        const sortOpt = sort?.field ? { field: sort.field as string, direction: sort.direction === "desc" ? "desc" : "asc" } : undefined;
        const pagOpt = pagination ? { limit: pagination.limit, offset: pagination.offset } : undefined;
        const rows = await adapter.find(schema, { filter: findFilter, pagination: pagOpt, sort: sortOpt });
        return rows.map((d) => applyAfterRead(config, schema, d));
      };
    }
    if ((config.schemas[schema.name]?.ops?.create ?? true) !== false) {
      resolvers.Mutation[`create${typeName}`] = async (_: any, { input }: any) => {
        const ok = validateCreate(input);
        if (!ok) throw new Error(`VALIDATION_ERROR: ${JSON.stringify(validateCreate.errors)}`);
        const created = await adapter.insert(schema, applyBeforeSave(config, schema, input));
        return applyAfterRead(config, schema, created);
      };
    }
    if ((config.schemas[schema.name]?.ops?.update ?? true) !== false) {
      resolvers.Mutation[`update${typeName}`] = async (_: any, { id, input }: any) => {
        const ok = validateUpdate(input);
        if (!ok) throw new Error(`VALIDATION_ERROR: ${JSON.stringify(validateUpdate.errors)}`);
        const updated = await adapter.update(schema, id, applyBeforeSave(config, schema, input));
        if (!updated) return null;
        return applyAfterRead(config, schema, updated);
      };
    }
    if ((config.schemas[schema.name]?.ops?.delete ?? true) !== false) {
      resolvers.Mutation[`delete${typeName}`] = async (_: any, { id }: any) => {
        return await adapter.delete(schema, id);
      };
    }
  }
  // Join queries with nested types
  let extraDefs = "";
  if (config.joins) {
    for (const [name, j] of Object.entries(config.joins)) {
      const baseType = j.base[0].toUpperCase() + j.base.slice(1);
      const joinType = `Join${name[0].toUpperCase()}${name.slice(1)}`;
      const relationFields = j.relations
        .map((r) => {
          const t = r.schema[0].toUpperCase() + r.schema.slice(1);
          return `${r.as}: [${t}!]!`;
        })
        .join("\n  ");
      extraDefs += `\n\n type ${joinType} {\n  base: ${baseType}!\n  ${relationFields}\n }`;
      // Build query field with typed relation-level args
      const relArgs = j.relations
        .map((r) => {
          const t = r.schema[0].toUpperCase() + r.schema.slice(1);
          return `, ${r.as}Filter: ${t}Filter, ${r.as}Sort: ${t}Sort, ${r.as}Pagination: PaginationInput`;
        })
        .join("");
      const fieldName = `join${name[0].toUpperCase()}${name.slice(1)}List`;
      extraDefs += `\n extend type Query { ${fieldName}(filter: ${baseType}Filter, pagination: PaginationInput, sort: ${baseType}Sort${relArgs}): [${joinType}!]! }`;
      (resolvers as any).Query[fieldName] = async (_: any, args: any) => {
        const { executeJoin } = await import("../../core/join/joinExecutor");
        const relOpts: any = {};
        for (const r of j.relations) {
          const rFilter = args[`${r.as}Filter`];
          const rSort = args[`${r.as}Sort`];
          const rPag = args[`${r.as}Pagination`];
          relOpts[r.as] = {
            filter: toFindFilter(rFilter),
            sort: rSort?.field ? { field: rSort.field as string, direction: rSort.direction === "desc" ? "desc" : "asc" } : undefined,
            pagination: rPag ? { limit: rPag.limit, offset: rPag.offset } : undefined,
          };
        }
        const baseFilter = toFindFilter(args.filter);
        const baseSort = args.sort?.field ? { field: args.sort.field as string, direction: args.sort.direction === "desc" ? "desc" : "asc" } : undefined;
        const basePag = args.pagination ? { limit: args.pagination.limit, offset: args.pagination.offset } : undefined;
        const rows = await executeJoin(
          { name, base: j.base, relations: j.relations } as any,
          { filter: baseFilter, pagination: basePag, sort: baseSort, relations: relOpts },
          schemas,
          adapter
        );
        return rows.map((row: any) => {
          const base = { ...row };
          for (const r of j.relations) delete base[r.as];
          const obj: any = { base };
          for (const r of j.relations) obj[r.as] = row[r.as] ?? [];
          return obj;
        });
      };
    }
  }
  const finalTypeDefs = `${typeDefs}${extraDefs}`;
  return { typeDefs: finalTypeDefs, resolvers };
}
