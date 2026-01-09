# GitHub Copilot Instructions for Al Ummah Now

> **Primary Reference**: See `/CLAUDE.md` for complete project guidance, development process, and code standards.

## Quick Reference

**This is a pnpm monorepo** - always use `pnpm` instead of `npm`.

### Essential Commands
```bash
pnpm install                              # Install dependencies
pnpm --filter @al-ummah/shared-types build # Build shared types (required first)
pnpm dev                                  # Run all apps in parallel
pnpm type-check                           # Type check all packages
pnpm lint                                 # Lint all packages
```

### App Ports
- **Web**: http://localhost:3001
- **API**: http://127.0.0.1:3086
- **WebSocket**: http://localhost:3087
- **Processor**: http://localhost:3088
- **Log Service**: http://localhost:3089

### Key Principles

1. **Follow `/BEFORE_YOU_CODE.md`** - Mandatory 10-step development workflow
2. **Use centralized logger** - Never use `console.log`, use `logger` from `@/lib/logger`
3. **Use i18n for all text** - Never hardcode user-facing strings
4. **No TODO comments** - Implement now or create GitHub issue
5. **Bilingual support** - Test both `/en/*` and `/ar/*` routes

### Project Structure
```
apps/
├── web/              # Next.js 15 frontend (Cloudflare Workers)
├── api-videos/       # Hono API backend (OpenAPI 3.1)
├── admin-api/        # Admin API backend
├── admin-web/        # Admin dashboard
├── processor/        # Queue consumer
└── websocket-server/ # Real-time WebSocket (Durable Objects)

packages/
└── shared-types/     # Shared TypeScript types (@al-ummah/shared-types)
```

### Technology Stack
- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Backend**: Hono, chanfana (OpenAPI), Zod
- **Auth**: OpenAuth (JWT/OAuth2)
- **Storage**: Cloudflare R2, KV
- **Streaming**: Bunny.net CDN

## App-Specific Docs

- **API**: `apps/api-videos/CLAUDE.md`
- **Processor**: `apps/processor/README.md`
- **WebSocket**: `apps/websocket-server/README.md`
- **Docs Index**: `docs/README.md`
