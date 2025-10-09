# Al Ummah Now - Video API Backend

API backend for video management, built with Fastify and TypeScript.

## Getting Started

```bash
# Development
pnpm dev

# Build
pnpm build

# Production
pnpm start

# Type check
pnpm type-check
```

## Endpoints

### Health Check
```
GET /health
```

### Videos
```
GET    /api/videos       - List all videos
GET    /api/videos/:id   - Get video by ID
POST   /api/videos       - Create new video
PUT    /api/videos/:id   - Update video
DELETE /api/videos/:id   - Delete video
```

## Development

The API uses shared types from `@al-ummah/shared-types` package to ensure type safety between frontend and backend.

## Environment Variables

```env
PORT=3001
HOST=0.0.0.0
DATABASE_URL=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

## Tech Stack

- **Fastify** - Fast and low overhead web framework
- **TypeScript** - Type safety
- **Shared Types** - Common types with frontend
- **Cloudflare D1** - Database (planned)
- **Cloudflare R2** - File storage
