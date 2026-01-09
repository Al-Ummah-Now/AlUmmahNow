# Al Ummah Now - Technology Stack

## Package Management & Build System

| Technology | Version | Purpose |
|-----------|---------|---------|
| **pnpm** | v10.22.0 | Package manager with workspaces |
| **Turborepo** | v2 | Monorepo build orchestration with caching |
| **TypeScript** | Latest | Type-safe development across all apps |
| **Node.js** | v18+ | Runtime environment |

## Frontend (apps/web)

### Core Framework
- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **@opennextjs/cloudflare** - Cloudflare Workers adapter for Next.js

### Styling
- **Tailwind CSS** - Utility-first CSS framework
- **CSS Modules** - Component-scoped styles
- **Dark/Light themes** - Built-in theme support

### Video Player
- **Video.js** - HTML5 video player
- **Quality selection** - Multi-resolution support
- **Bunny.net integration** - Video streaming

### State Management
- **React Context** - Global state (auth, language, theme)
- **Custom hooks** - Reusable stateful logic

### i18n (Internationalization)
- **Custom i18n system** - Bilingual support (EN/AR)
- **RTL support** - Right-to-left layout for Arabic
- **Translation files** - JSON-based translations
- **useLanguage hook** - React hook for translations

### Testing
- **Jest** - Testing framework
- **React Testing Library** - Component testing
- **Playwright** (e2e) - End-to-end testing

## Backend API (apps/api-videos)

### Web Framework
- **Hono v4** - Fast web framework for edge computing
- **chanfana** - OpenAPI 3.1 integration for Hono
- **Zod** - Schema validation

### OpenAPI
- **OpenAPI 3.1** - API specification
- **Swagger UI** - Interactive API documentation
- **Type-safe schemas** - Zod validation schemas

### Storage
- **Cloudflare R2** - Object storage (primary data store)
- **Repository pattern** - Data access abstraction
- **No traditional database** - R2 buckets as data source

### Authentication
- **JWT** - Token-based authentication
- **OpenAuth** - OAuth2/JWT service (external)
- **Custom middleware** - Auth validation

### CDN
- **Bunny.net** - Video streaming and image delivery
- **Stream API** - Video transcoding and delivery
- **Storage API** - Image and thumbnail storage

## Queue Processor (apps/processor)

### Queue System
- **Cloudflare Queues** - Message queue service
- **Queue name**: `al-ummah-now-videos`
- **Batch processing** - Up to 100 messages per batch

### Message Types (13+)
- Video events (views, likes, dislikes)
- Profile events (create, update, delete)
- Channel events (create, update, delete, subscribe, unsubscribe)
- Playlist events (create, update, delete, add/remove videos)
- Comment events (create, update, delete, like, dislike)
- Subscription events
- Watch history events

### Storage
- **R2 bucket**: `al-ummah-now-messages` - All message logs
- **R2 bucket**: `watch-history` - Production watch history
- **R2 bucket**: `watch-history-preview` - Preview/dev watch history

### Testing
- **Jest** - Unit and integration tests
- **Test fixtures** - Message type fixtures

## WebSocket Server (apps/websocket-server)

### Real-time Framework
- **Cloudflare Durable Objects** - Stateful WebSocket server
- **WebSocket API** - Native WebSocket support
- **Hibernation API** - Efficient connection management

### Features
- **Channel subscriptions** - User, video, channel, live stream channels
- **Presence tracking** - Online/offline status
- **Rate limiting** - 100 messages/minute per connection
- **Broadcasting** - Multi-client message delivery

### Storage
- **Cloudflare KV** - Presence state storage
- **KV namespace**: `al-ummah-now-analytics-kv`

### Authentication
- **JWT validation** - OpenAuth token verification
- **Connection-level auth** - Per-connection authentication

## Log Service (apps/log-service)

### Logging Infrastructure
- **Centralized logging** - Aggregates logs from all apps
- **Server-Sent Events (SSE)** - Real-time log streaming
- **Web viewer** - Browser-based log viewing
- **Filtering** - By level, app, time

### Features
- **Real-time streaming**: `/logs/stream/realtime`
- **Snapshot API**: `/logs/stream`
- **Web viewer**: `/viewer/viewer.html`
- **Multi-app aggregation** - All apps send logs here

## Shared Packages

### shared-types (packages/shared-types)
- **TypeScript interfaces** - Video, Channel, Playlist, User, Comment
- **Shared types** - Analytics, Message, WebSocket events
- **Used by all apps** - Via workspace protocol

### logger (packages/logger)
- **Structured logging** - Consistent log format
- **Context support** - Attach metadata to logs
- **Server/client variants** - Different implementations

## Deployment & Infrastructure

### Cloudflare Platform
- **Cloudflare Workers** - Serverless compute (all 4 apps)
- **Cloudflare R2** - Object storage (videos, messages, data)
- **Cloudflare KV** - Key-value store (presence, analytics)
- **Cloudflare Durable Objects** - Stateful WebSocket server
- **Cloudflare Queues** - Message queue service
- **Cloudflare Cron Triggers** - Scheduled tasks

### Deployment Tools
- **Wrangler v3** - Cloudflare Workers CLI
- **GitHub Actions** - CI/CD pipeline
- **Multi-environment** - Preview, Staging, Production

### Configuration Files
- **wrangler.toml** - Workers configuration
- **wrangler.{preview,staging,production}.jsonc** - Environment-specific configs

## External Services

### Authentication
- **OpenAuth** - JWT/OAuth2 service
- **Domain**: auth.alummahnow.net
- **Features**: User management, JWT tokens, OAuth2 providers

### CDN
- **Bunny.net** - Video and image CDN
- **Stream API** - Video transcoding and delivery
- **Storage API** - Image and file storage
- **Pull zones** - Content delivery

## Development Tools

### Code Quality
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting
- **TypeScript strict mode** - Enhanced type checking

### Testing
- **Jest** - Unit and integration testing
- **Playwright** - E2E testing (web app)
- **Test coverage** - Coverage reporting

### Version Control
- **Git** - Source control
- **GitHub** - Repository hosting
- **Conventional Commits** - Commit message format
- **GitHub Actions** - CI/CD automation

## API Documentation

### OpenAPI Specification
- **OpenAPI 3.1** - Latest spec version
- **chanfana** - Hono integration
- **Swagger UI** - Interactive docs at API root
- **Type-safe** - Generated from Zod schemas

## Language & Runtime

- **TypeScript** - All applications
- **JavaScript (ES2022)** - Compiled target
- **Cloudflare Workers runtime** - Edge execution environment

## Database Alternative

**No traditional database used**. Instead:
- **R2 buckets** - Object storage for structured data
- **JSON files** - Data serialization format
- **Repository pattern** - Abstraction layer for data access
- **Key-based lookups** - Efficient object retrieval

## Performance

- **Edge computing** - Low latency via Cloudflare Workers
- **Global distribution** - Deployed worldwide
- **CDN integration** - Bunny.net for video delivery
- **Durable Objects** - Stateful WebSocket with hibernation
- **KV caching** - Fast key-value lookups

## Security

- **JWT authentication** - Secure token-based auth
- **OAuth2** - Third-party authentication
- **CORS** - Cross-origin resource sharing
- **Rate limiting** - API and WebSocket protection
- **Environment variables** - Secrets management via Cloudflare
