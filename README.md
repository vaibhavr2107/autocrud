# Autocrud

Plug-and-play Node.js library that auto-generates CRUD REST + GraphQL endpoints and a functional API from simple JSON schemas. Ships with multiple database adapters, transforms, caching, joins, observability, and hot-reload.

Core ideas

- Define schemas as JSON files (or generate them). No code for CRUD.
- Get three ways to use them: Functions, REST, and GraphQL.
- Swap storage by adapter: File, SQLite, Postgres, or MongoDB.
- Opt-in transforms, caching, joins, observability, and live schema reload.

Installation

```bash
npm install autocrud-core
# Optional: for SQLite adapter
npm install better-sqlite3
```
Requirements: Node 18+

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
```
Or: start REST + GraphQL

```js
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

Configuration (table)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `server.port` | number | `4000` | HTTP port when creating a new Express app. |
| `server.basePath` | string | `/api` | Base path for REST and joins. |
| `server.graphqlPath` | string | `/graphql` | Path for GraphQL endpoint. |
| `server.restEnabled` | boolean | `true` | Mount REST endpoints. |
| `server.graphqlEnabled` | boolean | `true` | Mount GraphQL endpoint. |
| `server.loggingEnabled` | boolean | `true` | Structured request logs (Pino). |
| `server.logLevel` | string | `info` | Pino log level. |
| `server.tracingEnabled` | boolean | `true` | Adds `X-Request-Id` and logs it. |
| `server.metricsEnabled` | boolean | `true` | Prometheus metrics middleware. |
| `server.metricsPath` | string | `/autocurd-metrics` | Metrics endpoint path. |
| `server.healthEnabled` | boolean | `true` | Enables `/autocurd-health`. |
| `server.infoEnabled` | boolean | `true` | Enables `/autocurd-info`. |
| `server.listEnabled` | boolean | `true` | Enables `/autocurd-list`. |
| `server.schemaHotReloadEnabled` | boolean | `true` | Watch schemas and hot-reload routers/SDL. |
| `database.type` | enum | `file` | One of `file|sqlite|postgres|mongodb`. |
| `database.url` | string | `./data` | File dir (file), file path (sqlite), conn string (pg/mongo). |
| `cache.enabled` | boolean | `true` | Read-through cache for lists/items. |
| `cache.ttl` | number | `60` | TTL seconds. |
| `functional.enabled` | boolean | `true` | Generate functions API. |
| `schemas.<name>.file` | string | — | Path to schema JSON (required). |
| `schemas.<name>.transform.enabled` | boolean | `false` | Enable field-level before/after transforms. |
| `schemas.<name>.ops.create` | boolean | `true` | Enable create (REST/GraphQL). |
| `schemas.<name>.ops.read` | boolean | `true` | Enable list (REST/GraphQL). |
| `schemas.<name>.ops.readOne` | boolean | `true` | Enable get by id (REST/GraphQL). |
| `schemas.<name>.ops.update` | boolean | `true` | Enable update (REST/GraphQL). |
| `schemas.<name>.ops.delete` | boolean | `true` | Enable delete (REST/GraphQL). |
| `joins.<name>` | object | — | `{ base, relations:[{ schema, localField, foreignField, as, type }] }`. |

Protocol matrix (REST, GraphQL, Functions)

| Capability | REST | GraphQL | Functions |
| --- | --- | --- | --- |
| List | `GET /api/:schema?limit&offset&sort&dir` | `<schema>List(filter, pagination, sort)` | `functions[schema].find({ filter, pagination, sort })` |
| Get by id | `GET /api/:schema/:id` | `<schema>(id: ID!)` | `functions[schema].findById(id)` |
| Create | `POST /api/:schema` | `create<Schema>(input)` | `functions[schema].insert(doc)` |
| Update | `PATCH /api/:schema/:id` | `update<Schema>(id, input)` | `functions[schema].update(id, patch)` |
| Delete | `DELETE /api/:schema/:id` | `delete<Schema>(id)` | `functions[schema].delete(id)` |
| Join list | `GET /api/join/<name>` | `join<Name>List(filter, pagination, sort, <alias>Filter, <alias>Sort, <alias>Pagination)` | `functions.join.<name>({ filter, relations:{ alias:{ filter, sort, pagination }}})` |
| Typed filters | Basic (query params) | Yes (per-schema filter inputs) | Yes (filter object) |
| Sort | `sort`/`dir` query | `sort: <Schema>Sort` | `sort` option |
| Pagination | `limit`/`offset` query | `pagination: PaginationInput` | `pagination` option |
| ETag 304 | Yes on GET | N/A | N/A |

GraphQL typed filter, sort, pagination (reference)

| Input | Fields |
| --- | --- |
| `PaginationInput` | `limit: Int, offset: Int` |
| `SortDirection` | `asc`, `desc` |
| `StringFilter` | `eq`, `contains`, `in` |
| `NumberFilter` | `eq`, `gt`, `gte`, `lt`, `lte`, `in` |
| `BooleanFilter` | `eq` |
| `DateFilter` | `eq`, `gt`, `gte`, `lt`, `lte` |
| `<Schema>Filter` | Per-field scalar filters (e.g., `email: StringFilter`) |
| `<Schema>SortField` | Enum of schema fields |
| `<Schema>Sort` | `field: <Schema>SortField, direction: SortDirection` |

Schema features

Features (table)

| Feature | Default | Where | Notes |
| --- | --- | --- | --- |
| Field types | — | Schema | `string`, `number`, `boolean`, `date` (ISO), `json` |
| Constraints | — | Schema | `required`, `default`, `maxLength`, `min`, `max` |
| Primary key | `id`, `uuid` | Schema/DB | Object form supports `{ name, auto, strategy: uuid|sequence, start, step, type }` |
| PK by adapter | — | DB | File: uuid/sequence; SQLite: AUTOINCREMENT; Postgres: identity; Mongo: uuid only |
| Timestamps | `true` | Schema | Auto `createdAt`/`updatedAt` if `timestamps: true` |
| Validation | On | REST/GraphQL | AJV validators for create/update per schema |
| Transforms | Off | All ops | `beforeSave`/`afterRead` per field in config |
| Caching | On (ttl=60s) | Reads | List/item cache, id-level invalidation, ETags for REST GET |
| Joins | — | All | Config-driven, relation-level filter/sort/pagination |
| Hot reload | On | Server | Watches schema dirs; rebuilds REST/joins/GraphQL |
| Observability | On | Server | Logs, metrics, tracing; utility endpoints enabled by default |
| Docs endpoints | On | Server | `/autocurd-openapi.json`, `/autocurd-sdl` |

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

Database connections (samples)

- File (default for demos)
  - `{ type: "file", url: "./data" }`
- SQLite (requires better-sqlite3)
  - `{ type: "sqlite", url: "./data/dev.db" }`
- Postgres
  - `{ type: "postgres", url: "postgres://user:pass@host:5432/dbname" }`
- MongoDB
  - `{ type: "mongodb", url: "mongodb://localhost:27017/mydb" }`

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

Testing & CI/CD

- Run tests locally: `npm test`
- Typecheck: `npm run typecheck`
- Formatting check: `npm run format:check`
- GitHub Actions CI: `.github/workflows/ci.yml`
  - Runs typecheck, tests, build on push/PR (Node 18/20)
  - Publishes to npm on tag `v*` if `NPM_TOKEN` is set in repo secrets

Roadmap (advanced)

- Migrations and schema evolution
- Redis cache provider
- WebSockets for live updates
- Auth/RBAC and per-field permissions
- Cursor pagination across REST/GraphQL/joins
