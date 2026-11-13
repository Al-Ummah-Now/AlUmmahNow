# Al Ummah Now — Admin API

Admin REST API backend for the Al Ummah Now platform. Provides content moderation, report management, and platform administration capabilities.

## Overview

This Cloudflare Worker exposes an admin-only REST API built with Hono v4 and chanfana (OpenAPI 3.1). It connects to a D1 database for moderation reports and has read/write access to the R2 buckets that store videos, channels, profiles, playlists, and global settings. All endpoints require both JWT authentication and admin-role verification.

## Features

- Content moderation endpoints (flag, review, and action on videos/channels/profiles)
- Moderation report storage in Cloudflare D1 (`al-ummah-now-reports`)
- R2 read/write access for content management
- JWT authentication + admin-role middleware (OpenAuth)
- Staff passkeys: `403 passkey_required` after the staff deadline without a passkey sign-in, and `401 step_up_required` (sign-in older than 15 minutes) on high-risk actions ([docs/admin/STAFF_PASSKEYS.md](../../docs/admin/STAFF_PASSKEYS.md))
- Interactive Swagger UI at the root URL
- OpenAPI 3.1 schema via chanfana

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Hono v4 |
| OpenAPI | chanfana |
| Validation | Zod |
| Authentication | OpenAuth (JWT + admin middleware) |
| Database | Cloudflare D1 |
| Storage | Cloudflare R2 (read/write for moderation) |
| Runtime | Cloudflare Workers |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 9.15.4+
- Cloudflare account with Workers, D1, and R2 access

### Development

```bash
# From repo root
pnpm admin:dev

# Or from this directory
pnpm dev
```

The admin API starts at `http://127.0.0.1:3090`. Swagger UI is available at the root URL.

### Build & Validate

```bash
pnpm type-check
pnpm lint
```

## Deployment

### QA

```bash
# From repo root
pnpm admin:deploy:qa

# Or from this directory
pnpm deploy:qa
```

### Production

```bash
# From repo root
pnpm admin:deploy

# Or from this directory
pnpm deploy
```

CI/CD deploys this app automatically:
- `develop` branch → QA (`al-ummah-admin-api-qa` at `admin.qa.api.alummahnow.net`)
- `main` branch → Production (`al-ummah-admin-api`)

## Configuration

### Key Config Files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Production (default) wrangler config |
| `wrangler.qa.jsonc` | QA environment config |
| `src/index.ts` | App entry point, middleware registration |
| `src/routers/` | Route group registrations |
| `src/endpoints/` | Individual endpoint handlers |
| `src/middleware/auth.ts` | JWT + admin role middleware |
| `migrations/` | D1 database migrations |

### Bindings

- **D1 Database**: `REPORTS_DB` — moderation reports (`al-ummah-now-reports`)
- **R2 Buckets**: `videos`, `channels`, `profiles`, `playlists`, `global-settings`

### Environment Variables

- `Issuer` — OpenAuth issuer URL (e.g. `https://auth.alummahnow.net`); also the base of the `passkey_required` answer's `setup_url`
- `ADMIN_WEB_URL` — admin-web origin (evidence links; the `setup_url` comes back here)
- `STEP_UP_MAX_AGE_S` — local stack only: a longer step-up window for the admin E2E run; ignored on production and stage, never set in a deployed config
- `CORS_ORIGINS` — Allowed CORS origins

## Project Structure

```
src/
├── index.ts          # App entry point, global middleware, error handler
├── routers/          # Route group registrations
├── endpoints/        # Endpoint handlers (OpenAPIRoute subclasses)
├── middleware/
│   ├── auth.ts       # JWT authentication + admin role check
│   └── logging.ts    # Request logging
├── lib/
│   └── logger.ts     # Logger integration
└── base/             # Base route utilities
```

## Related Apps

- `apps/api-videos` — Public-facing video API
- `apps/admin-web` — Admin frontend that consumes this API
