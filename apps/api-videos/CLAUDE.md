# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Al-Ummah Now Videos API is a Cloudflare Worker application built with Hono and chanfana for OpenAPI 3.1 integration. The API provides video content management with JWT authentication (via OpenAuth), privacy controls, and comprehensive documentation.

**Key characteristics:**
- Serverless architecture using Cloudflare Workers runtime
- R2 object storage for videos, profiles, channels, and playlists (no traditional database)
- Bunny.net integration for video streaming and image storage
- OAuth2/JWT authentication via OpenAuth (SST)
- OpenAPI 3.1 with interactive Swagger UI

## Development Commands

### Setup and Dependencies
```bash
npm install                   # Install dependencies (~10-15 seconds)
npx wrangler login           # One-time Cloudflare authentication
```

### Development Server
```bash
npm run dev                  # Start dev server at http://127.0.0.1:8686 (takes 10-15 seconds, NEVER CANCEL)
npm run dev:node            # Alternative: run with Node.js directly (with hot reload)
```

### Validation and Testing
```bash
npx tsc --noEmit            # Type check TypeScript (~2-3 seconds)
npx wrangler deploy --dry-run  # Validate deployment bundle (~1-2 seconds)

# Manual API testing
curl http://127.0.0.1:8686/api/videos              # Test public endpoint
curl http://127.0.0.1:8686/auth-test               # Test auth endpoint (dev mode)
curl http://127.0.0.1:8686/openapi.json | jq .     # Verify OpenAPI schema
```

### Deployment
```bash
npm run deploy              # Deploy to Cloudflare Workers (~5-10 seconds)
wrangler deploy             # Alternative deployment command
```

**IMPORTANT:** All build and deployment commands complete in under 15 seconds. Always use timeouts of 30-60+ seconds and NEVER CANCEL operations.

## Architecture

### Core Technology Stack
- **Runtime:** Cloudflare Workers with `nodejs_compat` flag
- **Framework:** Hono v4+ (fast edge web framework)
- **OpenAPI:** chanfana v2+ (OpenAPI 3.1 integration for Hono)
- **Validation:** Zod v3+ (schema validation and TypeScript types)
- **Authentication:** @openauthjs/openauth (JWT/OAuth2)
- **Storage:** Cloudflare R2 (object storage), KV (key-value store)
- **Streaming:** Bunny.net Stream API and Storage SDK

### Project Structure
```
src/
├── index.ts                 # Main router, middleware setup, OpenAPI configuration
├── endpoints/               # API endpoint implementations (organized by feature)
│   ├── video/              # Video CRUD, likes, comments, search, upload
│   ├── profile/            # Profile CRUD, avatar/cover, watch history
│   ├── channel/            # Channel CRUD, subscriptions
│   ├── playlist/           # Playlist CRUD, video management
│   ├── live/               # Live streaming endpoints
│   ├── analytics/          # Analytics and metrics
│   ├── moderation/         # Content moderation and reporting
│   ├── auth/               # Authentication test endpoints
│   └── monitoring/         # Health checks, metrics, status page
├── middleware/
│   ├── auth.ts             # JWT authentication middleware
│   ├── auth-config.ts      # Auth configuration (issuer, audience, subjects)
│   └── auth-subjects.ts    # OpenAuth subject definitions
└── lib/
    ├── bunny/              # Bunny.net Stream and Storage integration
    ├── model/              # Data models (input and view types)
    ├── openapi-auth.ts     # OpenAPI auth helpers (addAuthToSchema)
    ├── openauth-client.ts  # OpenAuth client factory
    ├── r2Repo.ts          # Generic R2 repository pattern
    ├── queue.ts           # Event queue helpers
    ├── transformations.ts  # Data transformation utilities
    └── types.ts           # TypeScript type definitions
```

### Data Storage Pattern

**R2 Repository Pattern:** All data entities use a generic repository pattern (`src/lib/r2Repo.ts`) for CRUD operations:
- Videos stored in `videos` bucket (key = video ID, value = JSON)
- Profiles stored in `profiles` bucket
- Channels stored in `channels` bucket
- Playlists stored in `playlists` bucket

**No database:** This application uses R2 object storage as the primary data store. Each entity is stored as a JSON object with the entity ID as the key. Pagination is handled via R2 list operations with cursor-based pagination.

### Authentication Flow

**Two validation modes** (configured in `src/middleware/auth-config.ts`):

1. **Basic JWT validation** (`VERIFY_JWT_SIGNATURE = false`):
   - Decodes JWT payload and checks expiration
   - No signature verification
   - Used for development/testing

2. **Full signature validation** (`VERIFY_JWT_SIGNATURE = true`):
   - Uses OpenAuth client (`@openauthjs/openauth`) for signature verification
   - Validates against configured subjects (`AUTH_SUBJECTS`)
   - Production-ready with issuer/audience validation
   - Dynamic auth config from environment variables

**Middleware types:**
- `authMiddleware`: Requires valid JWT token (returns 401 if missing/invalid)
- `optionalAuthMiddleware`: Sets auth context if token present, continues without auth if missing

**Auth context:** After successful authentication, endpoints access user info via:
```typescript
const auth = c.get('auth'); // { userId, email, payload }
const userId = c.get('userId'); // Backward compatibility
```

### OpenAPI Integration

**Authentication documentation pattern:**
```typescript
import { addAuthToSchema } from "../../lib/openapi-auth";

export class MyEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    // ... your schema
  }, 'required'); // 'required' | 'optional' | 'public'
}
```

**OpenAPI security:** The main router (`src/index.ts`) manually adds security requirements to authenticated endpoints in the `/openapi.json` override. Both OAuth2 and Bearer token authentication are supported in the Swagger UI.

### Cloudflare Workers Bindings

Configured in `wrangler.jsonc`:
- **R2 Buckets:** `videos`, `profiles`, `channels`, `playlists` (with preview buckets)
- **KV Namespaces:** `TUS_SESSIONS` for resumable upload sessions, `RATE_LIMIT_KV` for rate limiting
- **Queues:** `queue` for event tracking and analytics
- **Secrets Store:** `bunny-stream-key`, `bunny_stream_library_id`, `image_storage_key`
- **Environment Variables:** `ZONE` for Bunny.net image storage zone

Access bindings via `c.env` in endpoints:
```typescript
const videoRepo = new R2Repository(c.env.videos);
const bunnyKey = await c.env["bunny-stream-key"].text();
```

## Common Workflows

### Adding New Endpoints

1. Create endpoint file in appropriate `src/endpoints/[category]/` directory
2. Import endpoint class in `src/index.ts`
3. Register with OpenAPI router: `openapi.get("/api/path", EndpointClass)`
4. Add authentication middleware if needed:
   ```typescript
   app.use('/api/path', authMiddleware); // For auth required
   // or use conditional middleware for mixed GET (public) / POST/PUT/DELETE (auth)
   ```
5. Use `addAuthToSchema()` helper for OpenAPI documentation
6. Add path to `authenticatedPaths` array in `/openapi.json` override if auth required
7. Test with Swagger UI at http://127.0.0.1:8686/

### Authentication Testing Workflow

After making auth-related changes, run these scenarios:
```bash
# 1. Public endpoints (should work without token)
curl http://127.0.0.1:8686/api/videos

# 2. Auth test endpoint (works in dev without token)
curl http://127.0.0.1:8686/auth-test

# 3. Protected operations (should return 401)
curl -X POST http://127.0.0.1:8686/api/videos

# 4. With invalid token (should return 401)
curl -H "Authorization: Bearer invalid" http://127.0.0.1:8686/auth-test
```

### Working with R2 Storage

1. Import the R2Repository class: `import R2Repository from '../../lib/r2Repo'`
2. Create repository instance: `const repo = new R2Repository<YourType>(c.env.bucketName)`
3. Use repository methods:
   - `listObjects(limit, cursor)` - Paginated list
   - `getObject(id)` - Fetch single object
   - `putObject(id, data)` - Create/update object
   - `deleteObject(id)` - Delete object

**Important:** R2Repository automatically handles JSON serialization/deserialization.

### Bunny.net Integration

**Video streaming:** Use functions from `src/lib/bunny/stream.ts`:
- `createVideo(env, data)` - Create video in Bunny.net Stream
- `getVideo(env, id)` - Fetch video metadata
- `updateVideo(env, id, data)` - Update video
- `deleteVideo(env, id)` - Delete video

**Image storage:** Use Bunny.net Storage SDK (`@bunny.net/storage-sdk`) via `src/lib/bunny/storage.ts`

### Privacy and Content Filtering

Videos have a `isPrivate` boolean field. The `src/lib/transformations.ts` utility provides filtering:
- Public endpoints: Filter out private videos unless user is the owner
- Authenticated endpoints: Show user's own private videos

### Queue-Based Analytics

Video views, likes, and other events are queued using `src/lib/queue.ts`:
```typescript
await queueVideoViewEvent(c.env.queue, videoId, userId);
```

## Key Implementation Notes

### TypeScript Configuration
- **Module resolution:** `bundler` mode (not Node.js)
- **Strict mode:** Disabled (`strict: false`)
- **Target:** ESNext
- **No build step:** TypeScript compiled on-the-fly by Wrangler

### CORS Configuration
- All origins allowed (`origin: '*'`)
- Custom headers supported: `channelId`, `userId`
- Preflight requests handled with explicit OPTIONS handlers

### Environment Isolation
- Development uses "preview" bindings (e.g., `videos-preview` bucket)
- Production uses production bindings (e.g., `videos` bucket)
- No environment variables file - uses Cloudflare Workers secrets

### OpenAPI Customization
The main router overrides `/openapi.json` and `/` routes to:
- Add OAuth2 and Bearer token security schemes
- Inject authentication requirements for protected endpoints
- Initialize OAuth2 in Swagger UI with client ID and scopes

### No Traditional Testing
- No unit test framework configured
- No CI/CD pipeline
- Testing is manual using Swagger UI and curl commands
- Critical to test all scenarios after changes

## Common Pitfalls

1. **Don't use traditional Node.js patterns** - This runs on Cloudflare Workers, not Node.js. Use Workers APIs.
2. **Don't assume database exists** - All data is in R2 object storage (JSON files)
3. **Don't skip authentication testing** - Auth is complex; always test with and without tokens
4. **Don't cancel builds** - All operations complete quickly; canceling causes issues
5. **Don't forget preview bindings** - Dev mode uses separate buckets/resources
6. **Don't modify `wrangler.jsonc` bindings without Cloudflare setup** - Bindings must exist in Cloudflare dashboard
7. **Don't use relative imports for bindings** - Access via `c.env.bindingName`

## Documentation References

For detailed information, see:
- `README.md` - Quick start and setup
- `TECHNICAL_DOCUMENTATION.md` - Complete API reference and architecture
- `AUTHENTICATION.md` - API user guide for authentication
- `DEVELOPER_AUTH_GUIDE.md` - Developer guide for adding auth to endpoints
- `ROADMAP.md` - Feature roadmap and phases
- `.github/copilot-instructions.md` - Detailed AI assistant instructions (source of this file)
