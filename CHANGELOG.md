# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-09-07

Initial MVP release.

Highlights
- Config manager and schema loader (JSON schemas → normalized config)
- DB adapters: File (stable), SQLite (optional dep), Postgres, MongoDB
- Functional API generation (use without server)
- REST and GraphQL generators
- Transforms (beforeSave/afterRead)
- Caching (in-memory TTL) with id-level invalidation and REST ETags
- Joins across schemas (functions, REST, GraphQL) with relation-level options
- Hot reload of schemas (auto-discover + rebuild routes and SDL)
- Observability: structured logs, request tracing, Prometheus metrics
- Utility endpoints: /autocurd-health, /autocurd-info, /autocurd-list, /autocurd-openapi.json, /autocurd-sdl
- File adapter durability: atomic writes, backups, recovery
- GraphQL typed filter/sort/pagination inputs (no JSON required)

Breaking changes
- None (first release)

Docs
- README with quick start, examples, config reference, and feature overview

## [0.1.2] - 2025-09-11

Changed
- ESM-first package exports with CJS compatibility. `exports.import` -> `dist/index.js`, `exports.require` -> `dist/index.cjs`.
- README: Added usage examples for both ESM `import` and CJS `require`.

Notes
- Build still emits both ESM and CJS bundles and type declarations.

## [0.1.3] - 2025-09-11

Added
- Configurable port conflict handling when Autocrud creates the server:
  - `server.portFallback`: `error | increment | auto` (default `increment`).
  - `server.maxPortRetries`: number (default `10`).
  - Respects `process.env.PORT` if provided.
- Orchestrator now exposes `actualPort` in `/autocurd-info` and uses it in `/autocurd-list` sample URLs.

Docs
- README: Documented server port behavior and new `server` options.
