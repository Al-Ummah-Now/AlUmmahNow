# Al Ummah Now - Islamic Content Platform

[![Deploy](https://github.com/meywd/AlUmmahNow/actions/workflows/deploy.yml/badge.svg)](https://github.com/meywd/AlUmmahNow/actions/workflows/deploy.yml)

A comprehensive Islamic content platform built as a Turborepo monorepo with three Cloudflare Workers applications.

## 🌟 Features

- **Bilingual Support**: Full English/Arabic with RTL layout
- **Video Platform**: Upload, stream, and manage Islamic video content
- **Authentication**: Secure OpenAuth integration with JWT tokens
- **Real-time Features**: WebSocket server for notifications and live updates
- **Real-time Processing**: Queue-based event processing and analytics
- **Modern Stack**: Next.js 16, Hono, Cloudflare Workers, Bunny.net CDN
- **Type-Safe**: Shared TypeScript types across all applications

## 🏗️ Monorepo Structure

```
al-ummah-now/
├── apps/
│   ├── web/                Next.js 16 frontend
│   ├── api-videos/         Hono API backend with OpenAPI
│   ├── processor/          Queue consumer for events
│   └── websocket-server/   WebSocket server (Durable Objects)
├── packages/
│   └── shared-types/       Shared TypeScript types
├── pnpm-workspace.yaml     Workspace configuration
├── turbo.json              Build orchestration
└── package.json            Root scripts
```

### Applications

| App | Description | Port | Docs |
|-----|-------------|------|------|
| **web** | Next.js frontend with bilingual support | 3001 | [README](apps/web/README.md) |
| **api-videos** | Hono API backend with OpenAPI/Swagger | 3086 | [CLAUDE.md](apps/api-videos/CLAUDE.md) |
| **processor** | Cloudflare Queue consumer | 3088 | [README](apps/processor/README.md) |
| **websocket-server** | Real-time WebSocket server (Durable Objects) | 3087 | [DOCUMENTATION.md](apps/websocket-server/DOCUMENTATION.md) |
| **log-service** | Centralized logging service | 3089 | - |
| **shared-types** | Shared TypeScript types | - | Built package |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm 9.15.4+
- Cloudflare account (for deployment)

### Setup

```bash
# Clone repository
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow

# Install dependencies
pnpm install

# Build shared types (required first)
pnpm --filter @al-ummah/shared-types build
```

### Development

```bash
# Run all apps in parallel
pnpm dev

# Or run individual apps
pnpm web:dev          # Frontend: http://localhost:3001
pnpm api:dev          # API: http://127.0.0.1:3086 (Swagger UI at root)
pnpm processor:dev    # Processor: http://localhost:3088
pnpm websocket:dev    # WebSocket: http://localhost:3087
```

### Build & Test

```bash
# Build all packages
pnpm build

# Type check all packages
pnpm type-check

# Lint all packages
pnpm lint
```

## 📦 Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS, shadcn/ui |
| **API** | Hono v4, chanfana (OpenAPI 3.1), Zod validation |
| **Processing** | Cloudflare Queue Consumer, TypeScript |
| **Authentication** | OpenAuth (JWT/OAuth2) |
| **Real-time** | Cloudflare Durable Objects (WebSocket) |
| **Storage** | Cloudflare R2 (object storage), KV (key-value) |
| **CDN** | Bunny.net (video streaming + images) |
| **Deployment** | Cloudflare Workers (all apps) |
| **Package Manager** | pnpm v9.15.4 with workspaces |
| **Build System** | Turborepo v2 with caching |

## 🎯 Key Features by App

### Web App (`apps/web`)
- 🌐 Bilingual routes: `/en/*` (LTR) and `/ar/*` (RTL)
- 🎥 Video.js player with quality selection
- 🔐 OpenAuth authentication with JWT tokens
- 🎨 Dark/light theme support
- 📱 Fully responsive design
- ⚡ Deployed via @opennextjs/cloudflare

### API Videos (`apps/api-videos`)
- 📚 OpenAPI 3.1 with interactive Swagger UI
- 🗄️ R2 object storage (no traditional database)
- 🎬 Bunny.net integration for video streaming
- 🔒 JWT authentication middleware
- ✅ Zod schema validation
- 📊 Complete REST API for videos, channels, playlists, profiles

### Processor (`apps/processor`)
- 📨 Cloudflare Queue consumer
- 📊 Processes 13+ message types (views, likes, comments, subscriptions)
- 💾 Saves events to R2 for analytics
- 🔄 Retry logic with dead letter queue
- 🏥 Health check and monitoring endpoints

### WebSocket Server (`apps/websocket-server`)
- 🔌 Real-time WebSocket connections via Durable Objects
- 🔐 JWT authentication with OpenAuth
- 📢 Channel-based pub/sub messaging
- 👥 User presence tracking (online/offline)
- 🚦 Rate limiting (100 messages/minute per connection)
- 📊 Server statistics and monitoring

## 🔑 Secrets per app

Names and purposes only. Values live in Cloudflare Secrets Store (`default_secrets_store`) and GitHub secrets, never in git.
The source of truth is [`scripts/release/secrets-manifest.ts`](scripts/release/secrets-manifest.ts) (production and stage worker names come from `scripts/release/apps.ts`). Update it in the same PR as any code that reads a new secret.

| App | Worker (prod / qa / stage) | Secret binding → Secrets Store name (prod / qa / stage) | Purpose |
|---|---|---|---|
| api-videos | `videos` / `videos-qa` / `videos-stage` | `bunny-stream-key` → `bunny-stream-key` / `bunny-stream-key-qa` / `bunny-stream-key-qa` | Bunny Stream API key (create, upload, update videos) |
| | | `bunny_stream_library_id` → `bunny_stream_library_id` / `bunny-stream-library-id-qa` / `bunny-stream-library-id-qa` | Bunny Stream library id |
| | | `BUNNY_TOKEN_KEY` → `bunny-stream-token-key` / `bunny-stream-token-key-qa` / `bunny-stream-token-key-qa` | Signs Bunny CDN playback and thumbnail URLs (`BUNNY_SIGN_URLS=true`) |
| | | `image_storage_key` → `al-ummah-now-images-key` (all envs) | Bunny Storage key for thumbnails and avatars |
| | | `INTERNAL_API_KEY` → `internal-api-key` / `internal-api-key-qa` / `internal-api-key-stage` | `X-API-Key` for `/internal/*` and calls to other Workers |
| admin-api | `al-ummah-admin-api` / `-qa` / `-stage` | `INTERNAL_API_KEY` | as above; also checks the Contact us route's `X-API-Key` on `/internal/contact` |
| | | `RESEND_API_KEY` → `RESEND_API_KEY` (all envs; the auth server's send-only key) | Contact us: support-inbox notification, sender acknowledgement and staff replies |
| | | `AUTH_MODERATION_CLIENT_SECRET` (worker secret, one value per env) | Client secret of `AUTH_MODERATION_CLIENT_ID`: moderation requests to auth ([docs/admin/AUTH_MODERATION_REQUESTS.md](docs/admin/AUTH_MODERATION_REQUESTS.md)) |
| websocket-server | `al-ummah-now-comms` / `-qa` / `-stage` | `INTERNAL_API_KEY` | Authenticates broadcast calls from api-videos, processor and scheduler |
| processor | `al-ummah-now-processor` / `-qa` / `-stage` | `INTERNAL_API_KEY` | as above |
| scheduler | `al-ummah-scheduler` / `-qa` / `-stage` | `INTERNAL_API_KEY` | Scheduled-publish broadcasts. Needs wrangler 4: wrangler 3 silently drops `secrets_store_secrets` |
| web | `al-ummah-now-production` / `al-ummah-web-qa` / `al-ummah-now-stage` | `INTERNAL_API_KEY` → `internal-api-key` / `internal-api-key-qa` / `internal-api-key-stage` | Contact us route (`/api/contact`) → admin-api `/internal/contact` |
| admin-web | `al-ummah-admin-web` / `-qa` / `-stage` | none | |

Stage shares the QA Bunny library and its keys; only `INTERNAL_API_KEY` has its own stage secret.

**Build secrets** (GitHub Actions, read by the OpenNext build of web and admin-web; `BUILD_SECRETS` in the manifest):

| Secret | Builds | Purpose |
|---|---|---|
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | release (stage + production share the build) | Stable Server Action ids and encrypted action arguments across deploys |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_QA` | `deploy.yml` (QA; PR builds get none) | as above, for QA |

Skew protection (pages open during a deploy keep working) also sets `CF_WORKER_NAME` and `CF_PREVIEW_DOMAIN` vars on web and admin-web; see [docs/release-pipeline/SKEW-PROTECTION.md](docs/release-pipeline/SKEW-PROTECTION.md).

**Must never be set:** `NEXT_PUBLIC_BUNNY_API_KEY` (and any other `NEXT_PUBLIC_*` secret). Next inlines `NEXT_PUBLIC_*` into the browser bundle.

**OAuth client ids** (`ClientId` var) must exist, enabled, in that env's auth D1 (`oauth_clients` in AlUmmahNowAuth):

| App | prod | qa | stage | Notes |
|---|---|---|---|---|
| web | `f0de3c30-…` | `e0de3c30-…` | `f0de3c30-…` | Starts logins, so required |
| admin-web | `a24e39de-…` | `b24e39de-…` | `a24e39de-…` | Starts logins, so required |
| api-videos | `b1770235-…` | `c1770235-…` | `b1770235-…` | Verification only; checked when set |
| websocket-server, admin-api | not set | not set | not set | Verification only; checked when set |
| admin-api `AUTH_MODERATION_CLIENT_ID` | `d7464de8-…` | `d7464de8-…` | `d7464de8-…` | "Videos Admin (moderation requests)", required |

Stage's auth D1 registers the same client ids as production.

Only admin-api uses an OAuth client *secret*: `AUTH_MODERATION_CLIENT_SECRET` for client `d7464de8-…` (set and rotated with `scripts/release/rotate-client-secret.ts` in AlUmmahNowAuth, `--worker al-ummah-admin-api[-qa|-stage]:AUTH_MODERATION_CLIENT_SECRET`). The other M2M clients in auth D1 (API Videos, Admin API, Admin Web, WebSocket Server) have hashed secrets that no Worker consumes yet. If one starts using `client_credentials`, rotate its secret with `scripts/release/rotate-client-secret.ts` in AlUmmahNowAuth and add it to the manifest.

GitHub secrets:

| Secret | Used by |
|---|---|
| `CLOUDFLARE_API_TOKEN` (org secret), `CLOUDFLARE_ACCOUNT_ID` | deploys, release, rollback, cleanup, seed, secrets check. The secrets check also needs Workers Scripts:Read, D1:Read and Secrets Store:Read |
| `E2E_CODE_SINK_SECRET_QA` / `_STAGE` | release E2E, legacy E2E and the stage seed read verification codes from the auth server's code sink |
| `TEST_PROMOTE_SECRET_QA` / `_STAGE` | release E2E admin case (`/test/promote`) |
| `QA_SEED_PASSWORD`, `STAGE_SEED_PASSWORD` | QA and stage seed accounts |
| `RESEND_API_KEY` | production signed-in check (release) and the QA seed |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude workflows |

**Check:** `pnpm check:secrets [--env production|qa|stage]` reads what is *deployed* and fails on a missing Worker, a missing required secret, a Secrets Store binding to a deleted or inactive secret, a test-only secret in production, or a client id missing or disabled in that env's auth D1. It prints names and client ids only, never values (exit 1: findings, 2: could not run). It runs (`.github/workflows/secrets-check.yml`) daily, on PRs that touch wrangler configs or the check, by hand, and in every release: stage after its deploy and production before the promote, both gating the production job.

## 🚢 Deployment

### Environments

- **Preview**: PR-specific deployments
  - `al-ummah-web-pr-{number}.workers.dev`
  - `al-ummah-api-pr-{number}.workers.dev`
  - `al-ummah-processor-pr-{number}`

- **Staging**: Automatic on merge to `main`
- **Production**: After staging validation

### Deploy Manually

```bash
# Deploy web app
pnpm web:deploy:production

# Deploy API
pnpm api:deploy

# Deploy processor
pnpm processor:deploy

# Deploy WebSocket server
pnpm websocket:deploy
```

### CI/CD Pipeline

GitHub Actions workflow automatically:
1. ✅ Type checks and lints all packages
2. 🏗️ Builds shared-types and web app
3. ✅ Validates API and processor
4. 🚀 Deploys previews for PRs (all 3 apps)
5. 🎯 Deploys to staging on merge to main
6. 🌐 Deploys to production after staging validation

**Required Secret**: `CLOUDFLARE_API_TOKEN`

## 📖 Documentation

### Getting Started
- **[CLAUDE.md](./CLAUDE.md)** - AI assistant guidance for development
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Development guidelines

### App-Specific
- **[Web App](.github/CLAUDE.md)** - Frontend development guide
- **[API Videos](./apps/api-videos/CLAUDE.md)** - API architecture and development
- **[API Authentication](./apps/api-videos/AUTHENTICATION.md)** - API authentication guide
- **[Processor](./apps/processor/README.md)** - Queue processor documentation
- **[WebSocket Server](./apps/websocket-server/DOCUMENTATION.md)** - Real-time WebSocket infrastructure

### Legacy Docs
- **[MONOREPO_MIGRATION.md](./MONOREPO_MIGRATION.md)** - Migration history
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Original architecture (pre-monorepo)

## 🔧 Development Workflow

### Adding Dependencies

```bash
# Add to specific app
pnpm --filter @al-ummah/web add package-name
pnpm --filter @al-ummah/api-videos add package-name

# Add to root devDependencies
pnpm add -D -w package-name
```

### Working with Shared Types

```bash
# Edit types
vim packages/shared-types/src/video.ts

# Rebuild
pnpm --filter @al-ummah/shared-types build

# Use in apps
import { VideoObject } from '@al-ummah/shared-types'
```

### Common Commands

```bash
# Build specific app
pnpm --filter @al-ummah/web build

# Type check specific app
pnpm --filter @al-ummah/api-videos type-check

# Run tests
pnpm --filter @al-ummah/processor test

# Deploy staging
pnpm processor:deploy:staging
```

## 🐛 Troubleshooting

### Cannot find module '@al-ummah/shared-types'
```bash
pnpm --filter @al-ummah/shared-types build
# Then restart VS Code TypeScript server:
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

### VS Code IntelliSense errors
```bash
# Reload VS Code window
# Ctrl+Shift+P → "Developer: Reload Window"
```

### Using npm instead of pnpm
This is a **pnpm monorepo**. Always use `pnpm` instead of `npm`.

## 🔗 Links

- **Repository**: https://github.com/meywd/AlUmmahNow
- **Project Board**: https://github.com/users/meywd/projects/1
- **Issues**: https://github.com/meywd/AlUmmahNow/issues

## 📝 License

MIT

## 👥 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm type-check` and `pnpm lint`
5. Submit a pull request

---

Built with ❤️ using Turborepo, Next.js, Hono, and Cloudflare Workers.
