import type { InternalConfig } from "../../config/internalConfig";
import type { DBAdapter, FindFilter, Pagination, Sort } from "../db/dbAdapter";
import type { NormalizedSchemas } from "../schemaLoader";

export type JoinSpec = {
  name: string;
  base: string;
  relations: Array<{ schema: string; localField: string; foreignField: string; as: string; type: "inner" | "left" }>;
};

export function listJoins(config: InternalConfig): JoinSpec[] {
  if (!config.joins) return [];
  return Object.entries(config.joins).map(([name, j]) => ({ name, base: j.base, relations: j.relations }));
}

export type RelationOptions = { filter?: FindFilter; sort?: Sort; pagination?: Pagination };

export async function executeJoin(
  join: JoinSpec,
  opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort; relations?: Record<string, RelationOptions> } = {},
  schemas: NormalizedSchemas,
  adapter: DBAdapter
) {
  const baseSchema = schemas[join.base];
  if (!baseSchema) throw new Error(`JOIN_ERROR: base schema '${join.base}' not found for join '${join.name}'`);
  // Fetch base rows
  const baseRows = await adapter.find(baseSchema, opts);
  if (baseRows.length === 0) return [];
  // For each relation, fetch related rows in bulk
  const out = baseRows.map((b) => ({ ...b }));
  for (const rel of join.relations) {
    const foreignSchema = schemas[rel.schema];
    if (!foreignSchema) throw new Error(`JOIN_ERROR: foreign schema '${rel.schema}' not found for join '${join.name}'`);
    const values = Array.from(new Set(baseRows.map((b) => b[rel.localField]).filter((v) => v !== undefined)));
    if (values.length === 0) {
      for (const row of out) (row as any)[rel.as] = rel.type === "inner" ? [] : [];
      continue;
    }
    const relOpts: RelationOptions | undefined = opts.relations?.[rel.as];
    const combinedFilter: FindFilter = { [rel.foreignField]: { in: values }, ...(relOpts?.filter ?? {}) } as any;
    const foreignRows = await adapter.find(foreignSchema, { filter: combinedFilter });
    const index = new Map<any, any[]>();
    for (const fr of foreignRows) {
      const key = fr[rel.foreignField];
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(fr);
    }
    for (const row of out) {
      const key = row[rel.localField];
      let matches = index.get(key) ?? [];
      // Sort per relation options
      if (relOpts?.sort?.field) {
        const dir = relOpts.sort.direction === "desc" ? -1 : 1;
        const f = relOpts.sort.field;
        matches = [...matches].sort((a, b) => (a[f] > b[f] ? dir : a[f] < b[f] ? -dir : 0));
      }
      if (relOpts?.pagination) {
        const { limit = matches.length, offset = 0 } = relOpts.pagination;
        matches = matches.slice(offset, offset + limit);
      }
      (row as any)[rel.as] = matches;
    }
  }
  return out;
}
