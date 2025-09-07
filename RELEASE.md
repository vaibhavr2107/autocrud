# Release 0.1.0

This document captures the notes for the 0.1.0 release and the steps to publish to npm.

## Highlights

See CHANGELOG.md for the full list. Key features:
- Auto CRUD for REST + GraphQL from JSON schemas
- Functional API, joins, transforms, caching
- DB adapters: File, SQLite, Postgres, MongoDB
- Observability + utility endpoints
- Hot schema reload
- Typed GraphQL filters/sort/pagination

## Verify before release

1. Set repository metadata in `package.json` (done).
2. Ensure license is Apache-2.0 (done) and `LICENSE` is present (done).
3. Build succeeds: `npm run build` → emits `dist/`
4. Tests pass: `npm test`
5. Example runs:
   - `npm run demo`
   - `npm run dev:server`

## Tag & GitHub release

```bash
# Ensure clean working tree
git status

# Commit current changes
git add .
git commit -m "chore(release): v0.1.0"

# Tag
git tag v0.1.0

# Push
git push -u origin main --tags
```

Create a GitHub release for tag `v0.1.0` and paste the notes from CHANGELOG.

## Publish to npm

```bash
# Login once
npm login

# Build (prepublishOnly also does this)
npm run build

# Publish as public package
npm publish --access public
```

If using a scoped name (e.g. `@yourorg/autocrud`), ensure the scope allows public packages or omit `--access public` if scope defaults to public.

## Post-publish

- Verify install: `npm i autocrud-core` (or your scoped name) and run a quick demo.
- Update README with npm badge if desired.
- Open roadmap issues: migrations, Redis cache, docker-compose for DB tests, join typed filters for REST, etc.

## Next version ideas

- 0.2.0: migrations, Redis cache provider, OpenTelemetry tracing, Swagger UI, GraphQL Playground toggle, Docker-based integration tests.
- 0.3.0: auth/RBAC, cursor pagination, relation-aware query planner for joins.
