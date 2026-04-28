# Cloudflare D1 setup

This repo operates only with:
- Local D1 for development (`--local`)
- Production D1 for remote environment
- **Note:** There is no `staging` environment for D1 in this workspace.

## Repository migration state

- The repo maintains a single consolidated base migration:
  - `migrations/0000_initial_schema.sql`
- This migration already reflects the current schema for `contributors`, `contributions`, and `settings`.

## Apply migrations

```bash
npm run d1:generate
npm run d1:check          # Verify schema sync
npm run d1:migrate:local  # Apply to local DB
npm run d1:migrate:prod   # Apply to Cloudflare (remote)
```

## Recommended local workflow (DX)

```bash
npm run d1:reset:local
npm run d1:seed:local
# or both:
npm run d1:bootstrap:local
```

## Troubleshooting & Maintenance

### D1 Binding sync
- **Error:** `Cannot read properties of undefined (reading 'prepare')`.
- **Cause:** DB binding missing or renamed but not redeployed.
- **Fix:** Update `wrangler.jsonc` and run `npm run deploy` to sync metadata with Cloudflare Workers.

### Data Migration (D1)
- **Export:** `npx wrangler d1 export <DB_NAME> --remote --output backup.sql`
- **Import:** `npx wrangler d1 execute <DB_NAME> --remote --file backup.sql`
- **Use case:** Moving data between different Database IDs or creating manual backups.
```

Local snapshots (data-only):

```bash
npm run d1:snapshot:local
npm run d1:restore:local -- --file ./.wrangler/d1-snapshots/<file>.sql
```

## Note
- The initial migration is in `migrations/0000_initial_schema.sql`.
- Current data access uses `drizzle-orm/d1` directly; an additional adapter layer is not maintained because it currently adds no real value to the project.
