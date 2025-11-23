# Al Ummah Now - Project Overview

## Project Purpose

Al Ummah Now is an Islamic content platform providing video streaming, live broadcasts, and community features with comprehensive bilingual support (English/Arabic with RTL).

**Repository**: https://github.com/meywd/AlUmmahNow

## Architecture

This is a **monorepo** using pnpm workspaces and Turborepo for orchestration. All applications are deployed on **Cloudflare Workers** infrastructure.

### Core Applications (6 apps)

1. **web** (`apps/web/`) - Frontend application
   - Next.js 15 with App Router
   - Deployed via @opennextjs/cloudflare
   - Bilingual routes: `/en/*` (LTR) and `/ar/*` (RTL)
   - OpenAuth JWT authentication
   - Video.js player with quality selection
   - Responsive design with dark/light themes
   - Port: 3001 (dev)

2. **api-videos** (`apps/api-videos/`) - REST API backend
   - Hono v4 web framework
   - OpenAPI 3.1 with chanfana integration
   - R2 object storage (no traditional database)
   - Bunny.net CDN integration for streaming
   - Interactive Swagger UI at root URL
   - Port: 3086 (dev)

3. **processor** (`apps/processor/`) - Queue consumer
   - Processes Cloudflare Queue messages
   - Handles: video views, likes, comments, subscriptions, watch history
   - Saves all messages to R2 bucket `al-ummah-now-messages`
   - Tracks watch history in R2 buckets
   - Port: 3088 (dev)

4. **websocket-server** (`apps/websocket-server/`) - Real-time server
   - Cloudflare Durable Objects
   - WebSocket API for real-time communication
   - JWT authentication via OpenAuth
   - Channel subscriptions and presence tracking
   - Rate limiting (100 messages/minute)
   - Port: 3087 (dev)
   - Production: wss://ws.alummahnow.net

5. **log-service** (`apps/log-service/`) - Centralized logging
   - Aggregates logs from all applications
   - Real-time log streaming (SSE)
   - Web viewer with filtering
   - Port: 3089 (dev)
   - URL: http://localhost:3089/

6. **scheduler** (`apps/scheduler/`) - Scheduled tasks
   - Cloudflare Cron Triggers
   - Handles periodic maintenance tasks

### Shared Packages (2 packages)

1. **shared-types** (`packages/shared-types/`)
   - Shared TypeScript interfaces and types
   - Used by all applications via workspace protocol
   - **MUST be built before other apps**

2. **logger** (`packages/logger/`)
   - Centralized logging library
   - Used by all applications
   - Structured logging with context

## Directory Structure

```
al-ummah-now/
├── apps/
│   ├── web/              # Next.js frontend
│   │   └── src/
│   │       ├── app/      # Next.js App Router pages
│   │       ├── components/ # React components (LTR + RTL)
│   │       ├── lib/      # Utilities and API clients
│   │       ├── hooks/    # Custom React hooks
│   │       └── interfaces/ # TypeScript interfaces
│   ├── api-videos/       # Hono API backend
│   │   └── src/
│   │       ├── endpoints/ # API route handlers
│   │       ├── middleware/ # Auth and validation
│   │       └── lib/      # Repositories and utilities
│   ├── processor/        # Queue consumer
│   │   └── src/
│   │       ├── handlers/ # Message type handlers
│   │       └── lib/      # R2 utilities
│   ├── websocket-server/ # Real-time server
│   ├── log-service/      # Centralized logging
│   └── scheduler/        # Scheduled tasks
├── packages/
│   ├── shared-types/     # Shared TypeScript types
│   └── logger/           # Logging library
├── docs/                 # Additional documentation
├── .github/              # GitHub Actions workflows
├── package.json          # Root workspace config
├── pnpm-workspace.yaml   # pnpm workspaces
├── turbo.json            # Turborepo configuration
├── CLAUDE.md             # This guidance file
└── BEFORE YOU CODE.MD    # Development workflow (CRITICAL)
```

## Key Features

### Bilingual Support (EN/AR)
- Complete i18n implementation
- RTL layout for Arabic
- Localized routes: `/en/*` and `/ar/*`
- Translation files in `apps/web/src/lib/i18n/translations/`

### Authentication
- OpenAuth service (separate from monorepo)
- JWT tokens for authentication
- OAuth2 support
- Service URL: auth.alummahnow.net

### Storage
- **R2 Buckets**: Primary data storage (videos, messages, watch history)
- **KV Namespaces**: Presence tracking, analytics
- **Bunny.net CDN**: Video streaming and image delivery

### Real-time Features
- WebSocket connections via Durable Objects
- Channel subscriptions (user, video, channel, live streams)
- Presence tracking
- Live chat and notifications

## Development Workflow

**CRITICAL**: Always follow the 10-step development process in `BEFORE YOU CODE.MD`:
1. LOG EVERYTHING
2. TDD (Test-Driven Development)
3. BUILD
4. RUN TESTS
5. DEBUG ISSUES SYSTEMATICALLY
6. RESEARCH
7. CHECK CODEBASE & DOCUMENTATION
8. PULL, COMMIT, PUSH
9. REVIEW CODE
10. OPEN PRs

## CI/CD Pipeline

**GitHub Actions** (`.github/workflows/deploy.yml`):
- **Trigger**: Push to `main` or pull requests
- **Preview Deployments**: Opt-in via `deploy-preview` label on PRs
- **Staging**: Deployed on push to main
- **Production**: Deployed after staging validation

## Important Notes

1. **Always use pnpm**, never npm or yarn
2. **Build shared-types first** before other apps
3. **Never use console.log** - use centralized logger
4. **Never use TODO comments** - create GitHub issues instead
5. **All user-facing text** must use i18n (never hardcode strings)
6. **Test bilingual support** - verify both `/en/*` and `/ar/*` routes
7. **Auth service is separate** - not part of this monorepo

## External Services

- **OpenAuth**: auth.alummahnow.net (JWT authentication)
- **Bunny.net**: CDN for video streaming and images
- **Cloudflare**: Workers, R2, KV, Durable Objects, Queues

## Contact & Resources

- **GitHub**: https://github.com/meywd/AlUmmahNow
- **Project Board**: https://github.com/users/meywd/projects/1
- **Issues**: Use templates in `.github/ISSUE_TEMPLATE/`
