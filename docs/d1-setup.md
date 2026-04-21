# Cloudflare D1 setup

This repo operates only with:
- Local D1 for development (`--local`)
- Production D1 for remote environment


## Repository migration state

- The repo maintains a single consolidated base migration:
  - `migrations/0000_initial_schema.sql`
- This migration already reflects the current schema for `contributors`, `contributions`, and `settings`.

## Apply migrations

```bash
npm run d1:generate
npm run d1:migrate:local
npm run d1:migrate:prod
```

## Recommended local workflow (DX)

```bash
npm run d1:reset:local
npm run d1:seed:local
# or both:
npm run d1:bootstrap:local
```

Local snapshots (data-only):

```bash
npm run d1:snapshot:local
npm run d1:restore:local -- --file ./.wrangler/d1-snapshots/<file>.sql
```

## Note
- The initial migration is in `migrations/0000_initial_schema.sql`.
- Current data access uses `drizzle-orm/d1` directly; an additional adapter layer is not maintained because it currently adds no real value to the project.
