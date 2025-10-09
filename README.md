# Al Ummah Now - Monorepo

Islamic content platform with video portal, API backend, and shared services.

## 🏗️ Monorepo Structure

```
al-ummah-now/
├── apps/
│   ├── web/              Next.js frontend (Cloudflare Workers)
│   └── api-videos/       Video API backend (Fastify)
├── packages/
│   └── shared-types/     Shared TypeScript types
├── package.json          Workspace root
├── turbo.json            Turborepo configuration
└── pnpm-workspace.yaml   pnpm workspaces
```

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Build shared types (required first)
pnpm --filter @al-ummah/shared-types build

# Development
pnpm web:dev         # Frontend on :3000
pnpm api:dev         # API on :3001
pnpm dev             # All apps

# Build
pnpm build           # Build all packages

# Deploy
pnpm web:deploy      # Deploy frontend to Cloudflare
```

## 📦 Apps & Packages

### apps/web - Frontend
- Next.js 15 with App Router
- Cloudflare Workers deployment
- OpenAuth authentication
- Bilingual (English/Arabic) with RTL support
- Video.js player with quality selection

### apps/api-videos - Backend API
- Fastify REST API
- Shared TypeScript types
- Cloudflare D1 + R2 integration
- OpenAPI specification

### packages/shared-types
Shared types for type-safe development:
- Video, Channel, Playlist, User, Comment, Analytics types
- Used by both frontend and backend

## 🔧 Development

```bash
# First time setup
pnpm install
pnpm --filter @al-ummah/shared-types build

# Start dev servers
pnpm web:dev      # Frontend: http://localhost:3000
pnpm api:dev      # API: http://localhost:3001
```

## 📖 Documentation

- [CLAUDE.md](./CLAUDE.md) - AI assistant guidance
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide
- [ROADMAP.md](./ROADMAP.md) - Development roadmap

## 🚢 Deployment

Frontend deploys to Cloudflare Workers via GitHub Actions:
- **Preview**: PRs get `al-ummah-now-pr-{PR_NUMBER}.workers.dev`
- **Staging**: Automatic on merge to main
- **Production**: After staging validation

## 🔗 Links

- **Live Demo**: https://al-ummah-now.templates.workers.dev
- **Project Board**: https://github.com/users/meywd/projects/1
- **Repository**: https://github.com/meywd/AlUmmahNow

---

Built with Turborepo, Next.js, Fastify, and Cloudflare Workers.
