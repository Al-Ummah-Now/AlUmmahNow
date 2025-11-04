# Architecture

## Executive Summary

Al Ummah Now is a mature microservices platform deployed on Cloudflare Workers, consisting of four coordinated services providing video streaming, real-time communication, and content management with bilingual support. The architecture demonstrates serverless-first design with strong separation of concerns and comprehensive type safety.

## Project Structure

```
/home/meywd/AlUmmahNow/
├── apps/                           # Applications (4 services)
│   ├── web/                       # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/              # App Router structure
│   │   │   │   ├── en/           # English routes (LTR)
│   │   │   │   │   ├── (auth)/   # Auth group routes
│   │   │   │   │   ├── dashboard/ # User dashboard
│   │   │   │   │   ├── videos/   # Video browsing
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── ar/           # Arabic routes (RTL)
│   │   │   │   │   ├── (auth)/   # Auth group routes
│   │   │   │   │   ├── dashboard/ # User dashboard
│   │   │   │   │   ├── videos/   # Video browsing
│   │   │   │   │   └── layout.tsx
│   │   │   │   └── layout.tsx    # Root layout
│   │   │   ├── components/       # React components
│   │   │   │   ├── [component]/
│   │   │   │   │   ├── index.tsx # LTR version
│   │   │   │   │   └── rtl/
│   │   │   │   │       └── index.tsx # RTL version
│   │   │   │   ├── ui/          # Base UI components
│   │   │   │   ├── layout/      # Layout components
│   │   │   │   └── providers/   # Context providers
│   │   │   ├── lib/             # Utilities and actions
│   │   │   │   ├── actions.ts   # Server actions
│   │   │   │   ├── api/         # API clients
│   │   │   │   └── utils.ts    # Helper functions
│   │   │   └── types/           # Local type definitions
│   │   ├── public/               # Static assets
│   │   ├── package.json
│   │   ├── wrangler.preview.jsonc
│   │   ├── wrangler.staging.jsonc
│   │   └── wrangler.production.jsonc
│   │
│   ├── api-videos/               # Hono v4 API backend
│   │   ├── src/
│   │   │   ├── endpoints/       # API endpoint definitions
│   │   │   │   ├── videos/      # Video management endpoints
│   │   │   │   ├── channels/    # Channel endpoints
│   │   │   │   ├── users/       # User management endpoints
│   │   │   │   ├── analytics/   # Analytics endpoints
│   │   │   │   └── auth/        # Authentication endpoints
│   │   │   ├── repositories/    # Data access layer
│   │   │   │   ├── base/        # Base repository interfaces
│   │   │   │   ├── video/       # Video data management
│   │   │   │   ├── channel/     # Channel data management
│   │   │   │   ├── user/        # User data management
│   │   │   │   └── analytics/   # Analytics data management
│   │   │   ├── middleware/      # Request processing
│   │   │   │   ├── auth.ts      # JWT authentication
│   │   │   │   ├── validation.ts # Request validation
│   │   │   │   ├── cors.ts      # CORS handling
│   │   │   │   └── errorHandler.ts # Error handling
│   │   │   ├── types/           # Type definitions
│   │   │   └── index.ts         # Application entry point
│   │   ├── package.json
│   │   └── wrangler.toml
│   │
│   ├── processor/                # Queue consumer
│   │   ├── src/
│   │   │   ├── handlers/        # Message type handlers
│   │   │   │   ├── VideoHandler.ts # Video-related events
│   │   │   │   ├── ProfileHandler.ts # User profile events
│   │   │   │   ├── ChannelHandler.ts # Channel events
│   │   │   │   ├── PlaylistHandler.ts # Playlist events
│   │   │   │   ├── CommentHandler.ts # Comment events
│   │   │   │   ├── SubscriptionHandler.ts # Subscription events
│   │   │   │   └── WatchHistoryHandler.ts # Watch history events
│   │   │   ├── repositories/    # Data access layer
│   │   │   │   ├── base/        # Base repository interfaces
│   │   │   │   ├── analytics/   # Analytics data management
│   │   │   │   └── watch-history/ # Watch history management
│   │   │   ├── middleware/      # Processing middleware
│   │   │   │   ├── auth.ts      # Authentication validation
│   │   │   │   ├── validation.ts # Message validation
│   │   │   │   ├── retry.ts     # Retry logic
│   │   │   │   └── errorHandler.ts # Error handling
│   │   │   ├── types/           # Message type definitions
│   │   │   └── index.ts         # Queue handler entry point
│   │   ├── package.json
│   │   ├── jest.config.js
│   │   └── wrangler.toml
│   │
│   └── websocket-server/         # Real-time WebSocket server
│       ├── src/
│       │   ├── WebSocketServer.ts # Main Durable Object class
│       │   ├── handlers/         # Message handlers
│       │   │   ├── ConnectionHandler.ts # Connection management
│       │   │   ├── SubscriptionHandler.ts # Channel subscriptions
│       │   │   ├── MessageHandler.ts # Message processing
│       │   │   ├── PresenceHandler.ts # User presence tracking
│       │   │   └── BroadcastHandler.ts # Message broadcasting
│       │   ├── middleware/       # Processing middleware
│       │   │   ├── auth.ts       # JWT authentication
│       │   │   ├── rateLimit.ts  # Rate limiting
│       │   │   ├── validation.ts # Message validation
│       │   │   └── errorHandler.ts # Error handling
│       │   ├── repositories/    # Data access layer
│       │   │   ├── PresenceRepository.ts # Presence data management
│       │   │   └── types.ts      # Type definitions
│       │   └── types/           # Type system
│       │       ├── messages.ts   # WebSocket message types
│       │       ├── events.ts     # Event type definitions
│       │       ├── auth.ts       # Authentication types
│       │       └── presence.ts   # Presence tracking types
│       ├── package.json
│       └── wrangler.toml
│
├── packages/                     # Shared packages
│   └── shared-types/           # Shared TypeScript types
│       ├── src/
│       │   ├── video.ts        # Video-related types
│       │   ├── channel.ts      # Channel types
│       │   ├── user.ts         # User types
│       │   ├── comment.ts      # Comment types
│       │   ├── analytics.ts    # Analytics types
│       │   ├── playlist.ts     # Playlist types
│       │   ├── subscription.ts # Subscription types
│       │   └── index.ts       # Type exports
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                        # Documentation
├── .github/                     # CI/CD workflows
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml          # pnpm workspaces
├── turbo.json                   # Turborepo orchestration
└── tsconfig.json                # Root TypeScript project references
```

## Epic to Architecture Mapping

| Epic/Feature | Primary Service | Supporting Services | Data Storage |
|-------------|----------------|-------------------|--------------|
| Video Streaming | api-videos | web, processor | R2 + Bunny CDN |
| User Authentication | api-videos | web | R2 |
| Real-time Communication | websocket-server | web | KV |
| Content Management | api-videos | processor | R2 |
| Analytics Processing | processor | api-videos | R2 |
| Bilingual UI | web | - | - |
| Watch History | processor | api-videos | R2 |

## Technology Stack Details

### Core Technologies

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Frontend Framework** | Next.js | 15.x | React framework with App Router |
| **Frontend Runtime** | React | 19.x | UI component framework |
| **Backend Framework** | Hono | 4.x | Fast web framework for Workers |
| **Language** | TypeScript | 5.x | Type-safe development |
| **Styling** | Tailwind CSS | 3.x | Utility-first CSS framework |
| **Package Manager** | pnpm | 9.x | Monorepo package management |
| **Build System** | Turborepo | 2.x | Monorepo build orchestration |

### Integration Points

| Integration | Technology | Protocol | Purpose |
|-------------|------------|----------|---------|
| Frontend ↔ API | HTTP/HTTPS | REST | Primary data communication |
| Frontend ↔ WebSocket | WebSocket | WSS | Real-time updates |
| API ↔ Processor | Queue | Cloudflare Queue | Asynchronous event processing |
| All Services ↔ Storage | Object Storage | R2 API | Persistent data storage |
| Authentication | OpenAuth | OAuth2/JWT | User identity management |

## Implementation Patterns

These patterns ensure consistent implementation across all AI agents:

### Naming Conventions

**API Endpoints:**
- REST endpoints: `/api/{resource}` (plural)
- Route parameters: `/{id}` (snake_case)
- Query parameters: `camelCase`

**Database Objects:**
- R2 keys: `kebab-case` with prefixes
- File names: `kebab-case`
- Metadata: `camelCase`

**Components:**
- React components: `PascalCase`
- File names: `PascalCase.tsx`
- RTL variants: `rtl/index.tsx`

**Code Organization:**
- Directories: `kebab-case`
- Files: `PascalCase` for components, `camelCase` for utilities
- Constants: `UPPER_SNAKE_CASE`

### Structure Patterns

**Test Organization:**
- Unit tests: `__tests__/` or `*.test.ts` co-located
- Integration tests: `__tests__/integration/`
- E2E tests: `tests/e2e/`

**Component Organization:**
- By feature: `components/[feature]/`
- Shared UI: `components/ui/`
- Layout: `components/layout/`
- Providers: `components/providers/`

**Repository Organization:**
- Base interfaces: `repositories/base/`
- Entity-specific: `repositories/{entity}/`
- Types: `repositories/{entity}/types.ts`

### Format Patterns

**API Responses:**
```typescript
// Success response
{
  data: T,
  success: true,
  message?: string
}

// Error response
{
  error: {
    code: string,
    message: string,
    details?: any
  },
  success: false
}
```

**Date Handling:**
- JSON: ISO 8601 strings
- Database: UTC timestamps
- UI: Localized with user timezone

**WebSocket Messages:**
```typescript
{
  type: string,
  payload: any,
  timestamp: string,
  userId?: string
}
```

### Communication Patterns

**Events:**
- Event naming: `{entity}:{action}` (e.g., `video:viewed`)
- Event payload: Typed interfaces
- Event handlers: `on{Event}` naming

**State Updates:**
- Immutable updates only
- State normalization for complex data
- Optimistic updates for UI

**Inter-service Communication:**
- API: REST with OpenAPI documentation
- Async: Queue messages with retry logic
- Real-time: WebSocket with subscriptions

### Lifecycle Patterns

**Loading States:**
- UI: `{loading, error, data}` pattern
- API: Proper HTTP status codes
- WebSocket: Connection status tracking

**Error Recovery:**
- API: Exponential backoff for retries
- Queue: Dead letter queue after max retries
- UI: Graceful degradation with error boundaries

**Retries:**
- Network requests: 3 attempts with backoff
- Queue processing: Built-in retry with DLQ
- WebSocket: Auto-reconnect with backoff

### Location Patterns

**URL Structure:**
- API: `/api/v1/{resource}`
- Web: `/{lang}/{feature}`
- Static: `/static/{path}`

**Asset Organization:**
- Images: `/static/images/`
- Videos: Stored in Bunny CDN
- Documents: `/static/docs/`

**Config Placement:**
- Environment: `.env.{environment}`
- Build: `package.json`, `tsconfig.json`
- Deploy: `wrangler.{environment}.jsonc`

### Consistency Patterns

**UI Date Formats:**
- Display: User's locale format
- Forms: ISO 8601 for consistency
- Timezones: Always UTC backend, localized frontend

**Logging Format:**
```typescript
{
  timestamp: string,
  level: 'info' | 'warn' | 'error',
  service: string,
  message: string,
  context?: any,
  requestId?: string
}
```

**User-facing Errors:**
- Authentication: "Please sign in to continue"
- Permissions: "You don't have permission to perform this action"
- Network: "Connection failed. Please try again."
- Validation: "Please check your input and try again"

## Data Architecture

### Data Models and Relationships

**Core Entities:**
- User: Profile, preferences, authentication
- Video: Metadata, streaming info, analytics
- Channel: Organization, playlists, subscribers
- Comment: Threaded discussions, moderation
- Playlist: Curated video collections
- Subscription: User-channel relationships

**Storage Patterns:**
- R2 for structured data (JSON objects)
- Bunny CDN for video streaming
- KV for real-time presence data
- Queue for event processing

### Data Flow

1. **User Actions** → Frontend → API → R2 Storage
2. **Real-time Events** → WebSocket → KV Presence
3. **Analytics Events** → Queue → Processor → R2 Analytics
4. **Video Streaming** → Bunny CDN → Frontend Player

## API Contracts

### REST API Specifications

**Authentication:**
- Bearer token in Authorization header
- JWT tokens from OpenAuth service
- Token refresh handled automatically

**Response Format:**
- Consistent envelope with data/error
- Proper HTTP status codes
- OpenAPI 3.1 documentation

**Rate Limiting:**
- Per-user rate limits on API endpoints
- WebSocket message rate limiting
- Global abuse protection

## Security Architecture

### Authentication & Authorization

**OpenAuth Integration:**
- JWT-based authentication
- OAuth2 for social logins
- Role-based access control

**Data Protection:**
- Encryption in transit (HTTPS/WSS)
- Encryption at rest (R2)
- No sensitive data in logs

**Security Best Practices:**
- Input validation on all endpoints
- SQL injection prevention (R2 is object storage)
- XSS protection in frontend
- CSRF protection for state-changing operations

## Performance Considerations

### Caching Strategy

**CDN Caching:**
- Bunny CDN for video content
- Cloudflare CDN for static assets
- Edge caching for API responses

**Application Caching:**
- KV for frequently accessed data
- Browser caching for static assets
- Service worker for offline support

### Optimization

**Frontend:**
- Code splitting by route
- Lazy loading for components
- Image optimization and responsive loading

**Backend:**
- Efficient R2 queries
- Queue-based async processing
- Durable Objects for stateful operations

## Deployment Architecture

### Cloudflare Workers Deployment

**Services:**
- Web: `al-ummah-web.{env}.workers.dev`
- API: `al-ummah-api.{env}.workers.dev`
- Processor: `al-ummah-processor.{env}`
- WebSocket: `al-ummah-comms.{env}.workers.dev`

**Environments:**
- Preview: PR-based deployments
- Staging: Integration testing
- Production: Live service

### CI/CD Pipeline

**GitHub Actions:**
- Automated testing on PR
- Parallel deployment to staging
- Manual promotion to production
- Automatic cleanup of preview deployments

## Development Environment

### Prerequisites

- Node.js 18+ (for local development)
- pnpm 9.x (package manager)
- Cloudflare account (deployment)
- Git (version control)

### Setup Commands

```bash
# Clone and install
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow
pnpm install

# Build shared types first
pnpm --filter @al-ummah/shared-types build

# Start development
pnpm dev                    # All services
pnpm web:dev                # Frontend only
pnpm api:dev                # API only
pnpm processor:dev          # Processor only
pnpm websocket:dev          # WebSocket only

# Type checking and linting
pnpm type-check             # All packages
pnpm lint                   # All packages
pnpm build                  # All packages
```

## Architecture Decision Records (ADRs)

### ADR-001: Cloudflare Workers Platform
**Decision**: Deploy all services on Cloudflare Workers
**Rationale**: Global edge deployment, automatic scaling, cost efficiency
**Consequences**: Serverless constraints, Workers ecosystem limitations

### ADR-002: Microservices Architecture
**Decision**: Separate concerns into 4 distinct services
**Rationale**: Independent scaling, clear boundaries, specialized technology choices
**Consequences**: Inter-service communication complexity, operational overhead

### ADR-003: Repository Pattern for Data Access
**Decision**: Use repository pattern for all R2 operations
**Rationale**: Consistent data access, testability, abstraction over storage details
**Consequences**: Additional abstraction layer, more boilerplate code

### ADR-004: Bilingual Component Architecture
**Decision**: Separate LTR/RTL component implementations
**Rationale**: Proper RTL support, language-specific optimizations
**Consequences**: Duplicate component maintenance, increased complexity

### ADR-005: Queue-based Event Processing
**Decision**: Use Cloudflare Queue for async processing
**Rationale**: Reliability, retry handling, decoupling of services
**Consequences**: Eventual consistency, debugging complexity

---

_Generated by BMAD Decision Architecture Workflow v1.3.2_
_Date: 2025-11-03_
_For: meywd_