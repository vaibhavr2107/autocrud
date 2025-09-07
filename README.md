# Autocrud

Plug-and-play Node.js library that auto-generates CRUD REST + GraphQL endpoints and a functional API from simple JSON schemas. Ships with multiple database adapters, transforms, caching, joins, observability, and hot-reload.

Core ideas

- Define schemas as JSON files (or generate them). No code for CRUD.
- Get three ways to use them: Functions, REST, and GraphQL.
- Swap storage by adapter: File, SQLite, Postgres, or MongoDB.
- Opt-in transforms, caching, joins, observability, and live schema reload.

Install

- Requires Node 18+
- Optional native deps for SQLite: `better-sqlite3`

Quick start (pick one)

- Functions only (no HTTP):
  - `npm run demo`
  - See `examples/demo.ts`
- REST + GraphQL server:
  - `npm run dev:server`
  - Uses `examples/server.ts` + `examples/config.ts`

1) Define schemas (JSON)

Example `src/schemas/user.json`
```json
{
  "name": "user",
  "primaryKey": { "name": "id", "auto": true, "strategy": "uuid", "type": "string" },
  "timestamps": true,
  "fields": {
    "id": { "type": "string", "required": true },
    "email": { "type": "string", "required": true },
    "password": { "type": "string", "required": true },
    "role": { "type": "string" }
  }
}
```
Example `src/schemas/product_seq.json` (numeric sequence PK)
```json
{
  "name": "product",
  "primaryKey": { "name": "id", "auto": true, "strategy": "sequence", "type": "number", "start": 100, "step": 1 },
  "timestamps": true,
  "fields": {
    "id": { "type": "number", "required": true },
    "name": { "type": "string", "required": true },
    "price": { "type": "number", "required": true }
  }
}
```
2) Create a config

Simplest config (file adapter) — see `examples/config.ts` for a fuller version.
```js
export default {
  server: { port: 4000, basePath: "/api", graphqlPath: "/graphql" },
  database: { type: "file", url: "./data" },
  schemas: {
    user: { file: "./src/schemas/user.json", ops: { delete: false } },
    product: { file: "./src/schemas/product_seq.json" }
  },
  joins: {
    userOrders: { base: "user", relations: [ { schema: "order", localField: "id", foreignField: "userId", as: "orders", type: "left" } ] }
  },
  cache: { enabled: true, ttl: 60 },
  functional: { enabled: true }
}
```
3) Use it: functions first
```js
import { generateFunctions } from "autocrud-core";

const { functions, stop } = await generateFunctions(config);
await functions.user.insert({ email: "a@b.com", password: "p" });
const list = await functions.user.find({ pagination: { limit: 10 } });
const joined = await functions.join.userOrders({ filter: { id: { eq: list[0].id } } });
await stop();

Or: start REST + GraphQL

import { buildAutoCRUD } from "autocrud-core";

const orch = await buildAutoCRUD(config);
await orch.start();
```
HTTP overview

- REST per schema (respects ops flags):
  - GET    `/:schema`         list (filter via query)
  - GET    `/:schema/:id`     by id
  - POST   `/:schema`         create
  - PATCH  `/:schema/:id`     update
  - DELETE `/:schema/:id`     delete
  - Example: `curl -s "http://localhost:4000/api/user?limit=10"`
- REST joins:
  - GET `/api/join/<name>?limit=&offset=&sort=&dir=&relations=<json>&<alias>Filter=<json>&<alias>SortField=&<alias>SortDir=&<alias>Limit=&<alias>Offset=`
- GraphQL (auto-generated):
  - Query: `user(id: ID!): User`
  - Typed filters: `userList(filter: UserFilter, pagination: PaginationInput, sort: UserSort): [User!]!`
  - Mutations: `createUser(input)`, `updateUser(id, input)`, `deleteUser(id)`
  - Joins: `join<Name>List(filter, limit, offset, <alias>Filter, <alias>SortField, <alias>SortDir, <alias>Limit, <alias>Offset)`

GraphQL typed filter, sort, pagination

- Common inputs:
  - `input PaginationInput { limit: Int, offset: Int }`
  - `enum SortDirection { asc desc }`
- Per schema (e.g., `User`):
  - `input UserFilter { email: StringFilter, role: StringFilter, ... }`
  - `enum UserSortField { id email password role createdAt updatedAt }`
  - `input UserSort { field: UserSortField, direction: SortDirection }`
  - Scalar filter inputs:
    - `input StringFilter { eq: String, contains: String, in: [String!] }`
    - `input NumberFilter { eq: Float, gt: Float, gte: Float, lt: Float, lte: Float, in: [Float!] }`
    - `input BooleanFilter { eq: Boolean }`
    - `input DateFilter { eq: String, gt: String, gte: String, lt: String, lte: String }`

Schema features

- Types: string, number, boolean, date (ISO), json
- Constraints: required, default, maxLength, min, max
- Primary key:
  - String name or object
  - Object fields: `name`, `auto`, `strategy` (uuid|sequence), `start`, `step`, `type`
  - Defaults: `{ name: "id", auto: true, strategy: "uuid" }`
  - Adapter specifics:
    - File: uuid or in-process numeric sequence
    - SQLite: INTEGER PRIMARY KEY AUTOINCREMENT (sequence), or uuid
    - Postgres: identity column (sequence), or uuid
    - Mongo: uuid only when auto
- Timestamps: auto `createdAt`/`updatedAt` if `timestamps: true`

Validation

- AJV-based per-schema input validation for REST/GraphQL (create/update)
- Dates are strings (ISO recommended)

Transforms

- Per-schema `transform` hooks in config:
  - `beforeSave`: applied on insert/update, per field
  - `afterRead`: applied on reads, per field (e.g., hide `password`)

Caching

- In-memory TTL cache for reads; id-level keys + list keys
- Automatic invalidation on writes (by schema and id)
- REST GETs return ETag; send `If-None-Match` for 304

Joins

- Define in config under `joins`:
  - `{ base, relations: [{ schema, localField, foreignField, as, type }] }`
- Call via functions: `functions.join.<name>({ filter, sort, pagination, relations: { alias: { filter, sort, pagination }}})`
- REST joins endpoint (see above) and GraphQL nested types (`Join<Name>` with `base` + relation arrays)

Adapters

- File (default for demos)
  - Single-process in-memory index of `data/<schema>.json`
  - Atomic writes via `.tmp` + `.bak`; recovers from `.bak` on parse errors
  - Great for prototyping, light writes, local dev
- SQLite (better-sqlite3, optional dep)
  - Single-file DB, strong concurrency, identity PK
- Postgres
  - Pool-based adapter, identity PK, JSONB, parameterized queries
- MongoDB
  - Official driver, uses `_id` from your PK when present

Observability

- Structured logs (Pino) with request IDs
- Prometheus metrics
  - `/autocurd-metrics` (or set `server.metricsPath`)
  - `autocrud_requests_total{method,route,code}`
  - `autocrud_request_duration_ms_sum|count{route}`
- Tracing via `X-Request-Id`

Utility endpoints (toggle in server config)

- `GET /autocurd-health` → { status: ok|degraded, schema.lastError }
- `GET /autocurd-info` → version, config summary, schemas/joins, watch.dirs, watch.lastReloadAt
- `GET /autocurd-list` → lists REST/GraphQL endpoints with sample curl
- `GET /autocurd-openapi.json` → OpenAPI 3.0 for REST
- `GET /autocurd-sdl` → GraphQL SDL

Hot reload (default on)

- Watches schema directories; on add/change:
  - Discovers new `*.json` schemas with `name`
  - Reloads normalized schemas, rebuilds functions, REST/joins routers, and GraphQL SDL/server
  - Surfaces last error in `/autocurd-health`; last reload time in `/autocurd-info`
- Disable via `server.schemaHotReloadEnabled: false`

Config reference (summary)

- `server`: `{ port, existingApp, basePath, graphqlPath, restEnabled, graphqlEnabled, loggingEnabled, logLevel, tracingEnabled, metricsEnabled, metricsPath, healthEnabled, infoEnabled, listEnabled, schemaHotReloadEnabled }`
- `database`: `{ type: "file"|"sqlite"|"postgres"|"mongodb", url }`
- `schemas[name]`: `{ file, transform?, ops? }` — `ops`: `{ create?, read?, readOne?, update?, delete? }`
- `joins[name]`: `{ base, relations: [{ schema, localField, foreignField, as, type? }] }`
- `cache`: `{ enabled?, ttl? }`
- `functional`: `{ enabled? }`

Tips & limits

- File adapter: single-process only; use SQLite/Postgres/Mongo for multi-process deployments or heavy writes.
- Tests: Postgres/Mongo integration are opt-in via `PG_URL`/`MONGO_URL` env vars.
- Windows + better-sqlite3: requires native build tools; if not installed, SQLite stays optional and tests skip.

Roadmap (advanced)

- Migrations and schema evolution
- Redis cache provider
- WebSockets for live updates
- Auth/RBAC and per-field permissions
- Cursor pagination across REST/GraphQL/joins
