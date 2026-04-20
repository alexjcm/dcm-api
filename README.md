# contributions-api

Family Contributions Management API using Hono + Drizzle + Cloudflare Workers + D1.

## Authentication and Authorization (Auth0)
- Validation of JWT RS256 access token against Auth0 JWKS.
- Mandatory validations: `iss` (`AUTH0_ISSUER`) and `aud` (`AUTH0_AUDIENCE`).
- Master Authorization Document: **[RBAC.md](../contributions-web/docs/RBAC.md)**.

## Environments (official)
- `local`: development with local D1 (`--local`) and variables in `.dev.vars`.
- `production`: canonical single remote Worker `contributions-api`.

## Migrations
- The local migration history was consolidated into a single initial base:
  - `migrations/0000_initial_schema.sql`

## Local Development

### Prerequisites
- **Node.js**: Version 24 or higher (management recommended with `fnm`).
- **NPM**: Dependency installation.

```bash
npm install
```

Copy `.dev.vars.example` → `.dev.vars` and complete the values.

### Development Server
```bash
npm run dev
```

`npm run dev` uses `wrangler.dev.jsonc` and local D1. It does not hit production.

### Worker Bindings Types
```bash
npm run types:wrangler
```

Execute every time you change `wrangler.jsonc`.

### Local D1
```bash
# Leaves the local DB clean and applies migrations
npm run d1:reset:local

# Loads idempotent local seed
npm run d1:seed:local

# Shortcut: reset + seed
npm run d1:bootstrap:local
```

#### Technical Tools (`tools/`)
The `tools/` directory contains automation scripts for data flows:
- `d1-reset-local.sh`: Purges the local database and applies all migrations from scratch.
- `d1-seed-local.sh`: Inserts test data (contributors, initial contributions).
- `d1-snapshot-local.sh`: Creates a `.sql` backup of the current state of your local DB in `.wrangler/d1-snapshots/`.
- `d1-restore-local.sh`: Allows restoring a specific snapshot.
- `smoke-rbac-production.sh`: Runs smoke tests against the production API to validate that Auth0 permissions are correctly mapped.

### Schema (Drizzle)
```bash
# Generates a new migration from the schema
npm run d1:generate

# Checks for conflicts between migrations
npm run d1:check
```

Apply migration locally:
```bash
npm run d1:migrate:local
```

---

## Production

> **Required environment variables:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

### Deploy
```bash
npm run deploy:prod
```

### Migrations
```bash
npm run d1:migrate:prod
```

### Inspection and Smoke Tests
```bash
# Inspect remote DB status
npm run tool:d1:inspect:prod

# Production RBAC smoke test
npm run tool:smoke:rbac:prod
```
