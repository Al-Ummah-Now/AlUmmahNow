# Al Ummah Now - Source Tree Analysis

## Project Overview

**Repository Type:** Monorepo with 5 distinct parts  
**Primary Language:** TypeScript  
**Runtime:** Node.js (Cloudflare Workers)  
**Package Manager:** pnpm with workspaces  
**Build System:** Turborepo  

## Complete Directory Structure

```
al-ummah-now/                          # Root monorepo
├── apps/                              # Main applications (4 parts)
│   ├── web/                           # Next.js 15 frontend (Part: web)
│   │   ├── src/                       # Main source directory
│   │   │   ├── app/                   # Next.js App Router pages
│   │   │   │   ├── en/               # English routes (LTR)
│   │   │   │   │   ├── analytics/     # Analytics dashboard
│   │   │   │   │   ├── channel/       # Channel pages
│   │   │   │   │   ├── feed/          # Home feed
│   │   │   │   │   ├── moderation/    # Content moderation
│   │   │   │   │   ├── profile/       # User profiles
│   │   │   │   │   ├── search/        # Search interface
│   │   │   │   │   ├── subscriptions/ # Subscription management
│   │   │   │   │   ├── upload/        # Video upload
│   │   │   │   │   └── video/         # Video player page
│   │   │   │   ├── api/               # API routes (server-side)
│   │   │   │   │   ├── analytics/     # Analytics API
│   │   │   │   │   └── callback/      # OAuth callback
│   │   │   │   ├── layout.tsx         # Root layout (bilingual)
│   │   │   │   ├── page.tsx           # Home page
│   │   │   │   └── not-found.tsx      # 404 page
│   │   │   ├── components/             # Reusable UI components
│   │   │   │   ├── AuthProvider/      # Authentication context
│   │   │   │   ├── Header/           # Navigation header (RTL/LTR)
│   │   │   │   ├── analytics/         # Analytics components
│   │   │   │   ├── commentsSection/   # Comment system
│   │   │   │   ├── login/            # Login/logout components
│   │   │   │   ├── relatedVideo/     # Related videos
│   │   │   │   ├── videoMetrics/      # Video metrics display
│   │   │   │   └── videoUpload/      # Upload interface
│   │   │   ├── lib/                   # Core libraries and utilities
│   │   │   │   ├── actions/          # Server actions
│   │   │   │   ├── api/              # API client libraries
│   │   │   │   ├── auth/             # Authentication utilities
│   │   │   │   ├── clients/          # API clients
│   │   │   │   ├── constants/        # Configuration constants
│   │   │   │   ├── storage/          # Storage management
│   │   │   │   ├── utils/            # Utility functions
│   │   │   │   ├── video/            # Video player utilities
│   │   │   │   └── websocket/       # WebSocket integration
│   │   │   ├── interfaces/            # TypeScript interfaces
│   │   │   ├── styles/               # CSS styles
│   │   │   └── types/                # Type definitions
│   │   ├── public/                   # Static assets
│   │   ├── docs/                     # Component documentation
│   │   ├── test-results/              # Test results
│   │   ├── next.config.ts             # Next.js configuration
│   │   ├── tailwind.config.ts         # Tailwind CSS config
│   │   ├── wrangler.*.jsonc          # Cloudflare Workers configs
│   │   └── package.json              # Dependencies and scripts
│   │
│   ├── api-videos/                   # Hono API backend (Part: api-videos)
│   │   ├── src/                      # Main source directory
│   │   │   ├── endpoints/            # API endpoint handlers
│   │   │   │   ├── video/           # Video management endpoints
│   │   │   │   ├── profile/         # User profile endpoints
│   │   │   │   ├── playlist/        # Playlist management
│   │   │   │   ├── channel/         # Channel management
│   │   │   │   ├── watch-history/   # Watch history system
│   │   │   │   ├── live/            # Live streaming
│   │   │   │   ├── analytics/       # Analytics endpoints
│   │   │   │   ├── moderation/      # Content moderation
│   │   │   │   └── monitoring/      # Health/metrics endpoints
│   │   │   ├── middleware/          # Request middleware
│   │   │   │   └── auth.ts          # Authentication middleware
│   │   │   └── index.ts            # Main application entry
│   │   ├── scripts/                 # Utility scripts
│   │   ├── .github/                 # GitHub templates
│   │   ├── wrangler.jsonc            # Cloudflare Workers config
│   │   └── package.json             # Dependencies and scripts
│   │
│   ├── processor/                    # Queue consumer (Part: processor)
│   │   ├── src/                     # Main source directory
│   │   │   ├── __tests__/           # Unit tests
│   │   │   ├── lib/                 # Core libraries
│   │   │   │   └── websocket-notify.ts # WebSocket notifications
│   │   │   ├── index.ts             # Main entry point
│   │   │   ├── logger.ts            # Logging utilities
│   │   │   └── types.ts             # Type definitions
│   │   ├── wrangler.toml             # Cloudflare Workers config
│   │   └── package.json             # Dependencies and scripts
│   │
│   └── websocket-server/             # WebSocket server (Part: websocket-server)
│       ├── src/                      # Main source directory
│       │   ├── auth.ts              # Authentication handling
│       │   ├── channels.ts          # Channel management
│       │   ├── index.ts             # Main entry point
│       │   ├── messages.ts          # Message handling
│       │   ├── notify-helpers.ts    # Notification helpers
│       │   ├── presence.ts          # Presence tracking
│       │   └── websocket.ts         # WebSocket implementation
│       ├── DEPLOYMENT.md            # Deployment guide
│       ├── DOCUMENTATION.md         # Technical documentation
│       ├── wrangler.jsonc           # Cloudflare Workers config
│       └── package.json             # Dependencies and scripts
│
├── packages/                         # Shared packages (1 part)
│   └── shared-types/               # Shared TypeScript types (Part: shared-types)
│       ├── src/                    # Type definitions
│       │   ├── video.ts            # Video-related types
│       │   ├── channel.ts          # Channel-related types
│       │   ├── user.ts             # User-related types
│       │   ├── playlist.ts         # Playlist types
│       │   ├── comment.ts          # Comment types
│       │   ├── analytics.ts        # Analytics types
│       │   ├── watch-history.ts    # Watch history types
│       │   ├── common.ts           # Common utility types
│       │   └── index.ts           # Main exports
│       ├── package.json            # Package configuration
│       └── tsconfig.json          # TypeScript configuration
│
├── bmad/                           # Business Analysis Framework (internal)
│   ├── bmm/                       # Business Model Management
│   │   ├── agents/                 # AI agent definitions
│   │   ├── docs/                   # Documentation
│   │   ├── tasks/                  # Task definitions
│   │   ├── teams/                  # Team configurations
│   │   ├── workflows/              # Workflow definitions
│   │   └── config.yaml             # Configuration
│   └── core/                      # Core framework
│
├── docs/                           # Project documentation
│   ├── architecture/               # Architecture documentation
│   ├── infrastructure/            # Infrastructure docs
│   ├── legacy/                    # Legacy documentation
│   ├── migration/                # Migration guides
│   └── README.md                 # Documentation index
│
├── .github/                        # GitHub configuration
│   ├── workflows/                 # CI/CD pipelines
│   ├── ISSUE_TEMPLATE/            # Issue templates
│   ├── chatmodes/                # Chat mode configs
│   └── CLAUDE.md                # Claude Code instructions
│
├── .cursor/                        # Cursor IDE config
├── .gemini/                        # Gemini AI config
├── package.json                    # Root package configuration
├── pnpm-workspace.yaml           # pnpm workspace config
├── turbo.json                    # Turborepo configuration
├── tsconfig.json                 # Root TypeScript config
└── README.md                     # Project overview
```

## Critical Directories Analysis

### Frontend (apps/web/src/)

**Core Application Structure:**
- `app/` - Next.js App Router with bilingual support (en/ar)
- `components/` - Reusable UI components with RTL variants
- `lib/` - Core business logic and utilities

**Key Integration Points:**
- `lib/api/` - API client layer → Calls api-videos service
- `lib/websocket/` - WebSocket integration → Connects to websocket-server
- `lib/auth/` - OpenAuth integration → Uses auth.alummahnow.net

**Component Architecture:**
- Each component has RTL variant in `rtl/` subfolder
- Shared interfaces in `interfaces/` directory
- Comprehensive test coverage in `__tests__/`

### Backend Services

**API Videos (apps/api-videos/src/)**
- `endpoints/` - 50+ REST endpoints across 7 categories
- `middleware/auth.ts` - JWT authentication via OpenAuth
- OpenAPI 3.1 with interactive Swagger UI

**Processor (apps/processor/src/)**
- Queue consumer for `al-ummah-now-videos` queue
- Processes 35+ message types (videos, profiles, channels, etc.)
- R2 storage for message persistence

**WebSocket Server (apps/websocket-server/src/)**
- Durable Objects for WebSocket connections
- KV storage for presence tracking
- Real-time notifications and presence

### Shared Infrastructure

**Shared Types (packages/shared-types/src/)**
- Comprehensive TypeScript interfaces
- Used by all apps via workspace protocol
- Ensures type safety across monorepo

## Integration Architecture

### Data Flow Patterns

```
Frontend (web) 
    ↓ HTTP/HTTPS
API Videos (api-videos)
    ↓ Queue Messages
Processor (processor)
    ↓ WebSocket Events
WebSocket Server (websocket-server)
    ↓ Real-time Updates
Frontend (web)
```

### Authentication Flow

```
Frontend → OpenAuth (auth.alummahnow.net) → JWT Token
    ↓
All services validate JWT via shared middleware
```

### Storage Architecture

```
Bunny.net CDN ←→ Cloudflare R2 ←→ Queue Messages
    ↓                    ↓              ↓
Video Streaming      Data Persistence   Event Processing
```

## Entry Points

### Application Entry Points

1. **Web Frontend**: `apps/web/src/app/layout.tsx`
   - Next.js App Router entry
   - Bilingual routing (en/ar)
   - Authentication and WebSocket providers

2. **API Backend**: `apps/api-videos/src/index.ts`
   - Hono application with OpenAPI
   - 50+ REST endpoints
   - Interactive Swagger UI at root

3. **Queue Processor**: `apps/processor/src/index.ts`
   - Cloudflare Queue consumer
   - Message processing and analytics
   - R2 storage integration

4. **WebSocket Server**: `apps/websocket-server/src/index.ts`
   - Durable Objects implementation
   - Real-time communication
   - Presence tracking

### Development Entry Points

```bash
# All services
pnpm dev

# Individual services
pnpm web:dev         # http://localhost:3000
pnpm api:dev          # http://127.0.0.1:3086
pnpm processor:dev    # http://localhost:3088
pnpm websocket:dev    # http://localhost:3087
```

## Configuration Patterns

### Monorepo Configuration
- `pnpm-workspace.yaml` - Workspace definition
- `turbo.json` - Build orchestration
- `tsconfig.json` - Project references

### Service Configuration
- Each app has `wrangler.*.jsonc` for Cloudflare Workers
- Environment-specific configs (preview/staging/production)
- Shared secrets via Cloudflare Secrets Store

### Development Configuration
- `package.json` scripts for each service
- Jest testing configuration
- ESLint and TypeScript validation

## Critical Files Summary

| File | Purpose | Criticality |
|------|---------|-------------|
| `pnpm-workspace.yaml` | Monorepo workspace definition | 🔴 Critical |
| `turbo.json` | Build orchestration | 🔴 Critical |
| `packages/shared-types/src/index.ts` | Shared type definitions | 🔴 Critical |
| `apps/web/src/app/layout.tsx` | Frontend entry point | 🔴 Critical |
| `apps/api-videos/src/index.ts` | API backend entry point | 🔴 Critical |
| `apps/processor/src/index.ts` | Queue processor entry | 🔴 Critical |
| `apps/websocket-server/src/index.ts` | WebSocket server entry | 🔴 Critical |
| `apps/web/src/lib/websocket/WebSocketProvider.tsx` | Real-time integration | 🟡 Important |
| `apps/api-videos/src/middleware/auth.ts` | Authentication middleware | 🔴 Critical |

This source tree analysis provides a comprehensive view of the Al Ummah Now monorepo structure, integration points, and architectural patterns.