import type { NormalizedSchema } from "../schemaLoader";

export type FindFilter = Record<string, any>;
export type Pagination = { limit?: number; offset?: number };
export type Sort = { field?: string; direction?: "asc" | "desc" };

export interface DBAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  find(schema: NormalizedSchema, opts: { filter?: FindFilter; pagination?: Pagination; sort?: Sort }): Promise<any[]>;
  findById(schema: NormalizedSchema, id: any): Promise<any | null>;
  insert(schema: NormalizedSchema, doc: any): Promise<any>;
  update(schema: NormalizedSchema, id: any, patch: any): Promise<any | null>;
  delete(schema: NormalizedSchema, id: any): Promise<boolean>;
}

