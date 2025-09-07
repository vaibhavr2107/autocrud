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
