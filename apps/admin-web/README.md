# Al Ummah Now — Admin Web

Admin frontend for the Al Ummah Now platform. Provides a management dashboard for content moderation, user administration, and platform settings.

## Overview

This Next.js 16 application is deployed as a Cloudflare Worker via @opennextjs/cloudflare. It communicates with the admin API (`apps/admin-api`) and the public video API (`apps/api-videos`). Authentication is handled via OpenAuth with the same JWT-based flow used across the platform.

## Features

- Content moderation dashboard (review flagged videos, channels, profiles)
- User and channel management
- Platform settings configuration
- Live streaming (`/live-streaming`): which provider new live streams go to (round-robin, weighted split or one provider), per-provider switches, caps and rates, channel overrides, sessions, and a side-by-side provider comparison
- TanStack Query for server-state management and caching
- OpenAuth authentication (JWT/OAuth2)
- Staff passkeys: the "Passkey needed" page (`/passkey-needed`), the grace banner and step-up sign-in (`prompt=login&max_age=900`) ([docs/admin/STAFF_PASSKEYS.md](../../docs/admin/STAFF_PASSKEYS.md))
- Deployed as a Cloudflare Worker via OpenNext

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Runtime Adapter | @opennextjs/cloudflare |
| State Management | TanStack Query v5 |
| Styling | Tailwind CSS v4 |
| Validation | Valibot |
| Authentication | OpenAuth (JWT/OAuth2) |
| Deployment | Cloudflare Workers |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 9.15.4+
- Cloudflare account
- `apps/admin-api` running locally (for API calls)

### Development

```bash
# From repo root
pnpm admin-web:dev

# Or from this directory
pnpm dev
```

The admin web app starts at `http://localhost:3091`.

The dev server expects the admin API at `http://127.0.0.1:3090` and the public API at `http://127.0.0.1:3086`.

### Build

```bash
# Next.js build
pnpm build

# Cloudflare Workers build (OpenNext)
pnpm build:worker

# Preview locally with Wrangler
pnpm preview
```

### Type Check & Lint

```bash
pnpm type-check
pnpm lint
```

## Deployment

### QA

```bash
# From repo root
pnpm admin-web:deploy:qa

# Or from this directory
pnpm deploy:qa
```

### Production

```bash
# From this directory (no root alias available)
pnpm deploy
```

CI/CD deploys this app automatically:
- `develop` branch → QA (`al-ummah-admin-web-qa` at `admin.qa.alummahnow.net`)
- `main` branch → Production (`al-ummah-admin-web`) using `wrangler.production.jsonc`

## Configuration

### Key Config Files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Default (local dev) wrangler config |
| `wrangler.qa.jsonc` | QA environment config |
| `wrangler.production.jsonc` | Production environment config |
| `open-next.config.ts` | OpenNext Cloudflare adapter config |
| `next.config.ts` | Next.js configuration |
| `src/app/globals.css` | Tailwind v4 setup and the admin's colours, read from the site's active theme (Fanous tokens) |
| `src/components/shell/` | The admin frame: grouped sidebar (rail, phone drawer), top bar with breadcrumbs, ⌘K search |

### Environment Variables (via wrangler.jsonc)

| Variable | Description |
|----------|-------------|
| `Issuer` | OpenAuth issuer URL |
| `API_URL` | Public API URL (server-side) |
| `ADMIN_API_URL` | Admin API URL (server-side) |
| `NEXT_PUBLIC_API_URL` | Public API URL (client-side) |
| `NEXT_PUBLIC_BASE_URL` | Base URL for this app |
| `NEXTJS_ENV` | Next.js environment name |

### Bindings

- **ASSETS**: Static asset binding (OpenNext)

## Project Structure

```
src/
├── app/              # Next.js App Router pages and layouts
├── components/       # React components
├── lib/
│   ├── api/          # API client functions
│   └── auth/         # Authentication utilities
public/               # Static assets
```

## Related Apps

- `apps/admin-api` — Admin REST API backend consumed by this app
- `apps/api-videos` — Public video API (also consumed for read operations)
- `apps/web` — Public-facing user frontend (separate deployment)
