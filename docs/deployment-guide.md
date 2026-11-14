# Al Ummah Now - Deployment Guide

> **Production is released only by pushing a release tag (`vYYYY.MM.DD`, the US Eastern date; `pnpm release:tag next` prints the next one) on `main`, which runs `.github/workflows/release.yml` (stage → E2E → production). Never deploy production by hand.** See "Deploy Rules" in `CLAUDE.md`. The manual `wrangler deploy` steps below are background on how each worker is built, not a production procedure.

## Overview

Al Ummah Now is deployed entirely on **Cloudflare Workers** across 4 distinct services:

1. **Web Frontend** - Next.js 15 via OpenNext
2. **API Videos** - Hono REST API with OpenAPI 3.1
3. **Processor** - Queue consumer for message processing
4. **WebSocket Server** - Real-time communication with Durable Objects

## Infrastructure Architecture

### Cloudflare Services Used

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Workers** | Serverless compute runtime | All 4 applications |
| **R2 Storage** | Object storage for videos, profiles, etc. | 6 buckets configured |
| **KV Storage** | Key-value for auth tokens and presence | 2 namespaces |
| **Queues** | Message processing pipeline | 1 main queue + DLQ |
| **Durable Objects** | WebSocket state management | 1 DO class |
| **Secrets Store** | Sensitive configuration | API keys, tokens |

### Domain Structure

```
alummahnow.net              # Main domain
├── videos.api.alummahnow.net    # API backend
├── ws.alummahnow.net            # WebSocket server
├── auth.alummahnow.net          # Authentication service (external)
├── cdn.alummahnow.net          # Static assets CDN
├── stream.alummahnow.net        # Video streaming
└── images.alummahnow.net        # Image CDN
```

## Prerequisites

### Cloudflare Setup
1. **Cloudflare Account** with Workers enabled
2. **Custom Domain** configured (alummahnow.net)
3. **R2 Buckets** created (6 buckets)
4. **KV Namespaces** provisioned (2 namespaces)
5. **Queue** configured (1 main queue + DLQ)
6. **Durable Objects** enabled

### External Services
1. **Bunny.net** CDN and Stream API
2. **OpenAuth** Authentication provider
3. **GitHub** for CI/CD pipeline

### Required Secrets

#### Cloudflare Secrets Store
```bash
# API Videos Service
wrangler secret put BUNNY_STREAM_API_KEY
wrangler secret put BUNNY_STREAM_LIBRARY_ID
wrangler secret put BUNNY_STORAGE_KEY

# Common across services
wrangler secret put OPENAUTH_JWT_SECRET
wrangler secret put DATABASE_URL (if applicable)
```

#### Environment Variables
```bash
# API Videos
ZONE=al-ummah-now-images

# Processor
ENVIRONMENT=production
LOG_LEVEL=info
```

## Deployment Process

### 1. Automated Deployment (Recommended)

#### GitHub Actions CI/CD
```yaml
# Trigger: Push to main branch
# Pipeline: Test → Build → Deploy to Staging → Deploy to Production
```

**Staging Deployment:**
- Web: `al-ummah-web-staging.workers.dev`
- API: `al-ummah-api-staging.workers.dev`
- Processor: Development environment
- WebSocket: `al-ummah-comms-staging.workers.dev`

**Production Deployment:**
- Web: `alummahnow.net`
- API: `videos.api.alummahnow.net`
- Processor: Production environment
- WebSocket: `ws.alummahnow.net`

#### Manual Production Deploy
```bash
# Deploy all services
pnpm web:deploy:production
pnpm api:deploy
pnpm processor:deploy
pnpm websocket:deploy

# Or push to main branch (triggers CI/CD)
git push origin main
```

### 2. Individual Service Deployment

#### Web Frontend
```bash
cd apps/web

# Staging
pnpm deploy:staging

# Production
pnpm deploy:production

# Preview (PR)
pnpm deploy:preview
```

**Configuration Files:**
- `wrangler.preview.jsonc` - Preview environment
- `wrangler.staging.jsonc` - Staging environment
- `wrangler.production.jsonc` - Production environment

#### API Videos
```bash
cd apps/api-videos

# Development (uses .env.dev)
pnpm wrangler deploy --env development

# Staging
pnpm wrangler deploy --env staging

# Production (default)
pnpm wrangler deploy
```

**Configuration:**
- R2 buckets: videos, profiles, channels, playlists, reports, watch_history
- KV namespaces: TUS_SESSIONS, RATE_LIMIT_KV
- Queue producer: al-ummah-now-videos

#### Processor
```bash
cd apps/processor

# Development
pnpm wrangler deploy --env development

# Staging
pnpm wrangler deploy --env staging

# Production
pnpm wrangler deploy
```

**Configuration:**
- R2 bucket: al-ummah-now-messages
- Queue consumer: al-ummah-now-videos
- Dead Letter Queue: al-ummah-now-dlq

#### WebSocket Server
```bash
cd apps/websocket-server

# Development
pnpm wrangler dev --port 3087

# Production
pnpm wrangler deploy
```

**Configuration:**
- Durable Object: WebSocketDurableObject (socket shards `sockets:<n>`, channel directories `topic:<channel>`, view counters `views:<id>:<n>`)
- `SOCKET_SHARDS` (optional, default 8, max 64): number of socket shards
- Rate limiting: WS_CONNECT_LIMITER, WS_MESSAGE_LIMITER

## Environment Configuration

### Production Environment

#### Web Frontend
```json
{
  "name": "al-ummah-web",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [
    { "pattern": "alummahnow.net/*", "zone_name": "alummahnow.net" }
  ]
}
```

#### API Videos
```json
{
  "name": "videos",
  "routes": [
    { "pattern": "videos.api.alummahnow.net/*", "zone_name": "alummahnow.net" }
  ],
  "r2_buckets": [...],
  "kv_namespaces": [...],
  "queues": {...}
}
```

#### WebSocket Server
```json
{
  "name": "al-ummah-now-comms",
  "routes": [
    { "pattern": "ws.alummahnow.net/*", "zone_name": "alummahnow.net" }
  ],
  "durable_objects": {...},
  "kv_namespaces": [...]
}
```

### Staging Environment

#### Subdomains
- `web-staging.alummahnow.net`
- `api-staging.alummahnow.net`
- `ws-staging.alummahnow.net`

#### Preview Environments
- `al-ummah-web-pr-{number}.workers.dev` (the only PR preview; `deploy-preview` label, no queue consumers or crons, deleted when the PR closes)

## R2 Storage Configuration

### Buckets Configuration

| Bucket | Purpose | Environment |
|--------|---------|-------------|
| `videos` | Video files and metadata | Production + Preview |
| `profiles` | User profile data | Production + Preview |
| `channels` | Channel information | Production + Preview |
| `playlists` | Playlist data | Production + Preview |
| `reports` | Moderation reports | Production + Preview |
| `watch-history` | User watch history | Production + Preview |
| `al-ummah-now-messages` | Queue message persistence | Production only |

### CORS Configuration
```javascript
// R2 Bucket CORS
[
  {
    "allowedOrigins": ["https://alummahnow.net", "https://*.alummahnow.net"],
    "allowedMethods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowedHeaders": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
```

## Queue Configuration

### Main Queue: al-ummah-now-videos
```toml
[[queues.consumers]]
queue = "al-ummah-now-videos"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "al-ummah-now-dlq"
```

### Message Types Processed
- Video events (create, update, delete, view, like, comment)
- Profile events (create, update, delete)
- Channel events (create, update, delete, subscribe)
- Playlist events (create, update, delete, add/remove video)
- Watch history events
- Analytics events

## Durable Objects Configuration

### WebSocket Durable Object
```json
{
  "durable_objects": {
    "bindings": [
      {
        "name": "WEBSOCKET_DO",
        "class_name": "WebSocketDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_classes": ["WebSocketDurableObject"]
    }
  ]
}
```

### Features
- Real-time WebSocket connections
- Presence tracking via KV storage
- Channel subscriptions (user, video, channel)
- Rate limiting (100 messages/minute)
- Message broadcasting

## Monitoring and Observability

### Cloudflare Observability
```json
{
  "observability": {
    "enabled": true
  }
}
```

### Logging
```bash
# View logs for all services
pnpm wrangler tail

# Service-specific logs
cd apps/web && pnpm logs:production
cd apps/api-videos && pnpm wrangler tail
cd apps/websocket-server && pnpm wrangler tail
```

### Health Checks
- **API**: `https://videos.api.alummahnow.net/health`
- **WebSocket**: `https://ws.alummahnow.net/health`
- **Processor**: Built-in health endpoints

### Metrics
- **API**: `https://videos.api.alummahnow.net/metrics`
- **Analytics**: Custom metrics via queue processing
- **WebSocket**: Connection metrics via Durable Objects

## Security Configuration

### Authentication
- **OpenAuth OAuth2** via `auth.alummahnow.net`
- **JWT Bearer tokens** for API authentication
- **Shared secrets** across services

### CORS Configuration
```javascript
// API Videos CORS
app.use('*', cors({
  origin: ['https://alummahnow.net', 'https://*.alummahnow.net'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 600,
  credentials: false
}));
```

### Rate Limiting
- **API**: Cloudflare rate limiting rules
- **WebSocket**: 100 messages/minute per connection
- **Upload**: Quota management per user

## Performance Optimization

### Caching Strategy
- **Static Assets**: Cloudflare CDN cache
- **API Responses**: Cache-Control headers
- **Video Streaming**: Bunny.net CDN edge caching

### Edge Computing
- **Global Distribution**: Cloudflare edge network
- **Smart Placement**: Workers close to users
- **Durable Objects**: Stateful edge computing

### Build Optimization
```bash
# Production builds
pnpm build

# Optimized bundles
pnpm --filter @al-ummah/web build
# Output: .next/ and .open-next/ directories
```

## Rollback Strategy

### Blue-Green Deployment
1. **Staging** validates new version
2. **Production** cutover after validation
3. **Rollback** via previous commit deployment

### Emergency Rollback
```bash
# Quick rollback to previous commit
git checkout <previous-commit-tag>
pnpm web:deploy:production
pnpm api:deploy
pnpm processor:deploy
pnpm websocket:deploy
```

### Database Rollback
- **R2**: Versioned objects with rollback capability
- **KV**: Eventual consistency with TTL
- **Queue**: DLQ for failed message recovery

## Troubleshooting

### Common Deployment Issues

#### Build Failures
```bash
# Check Node.js version
node --version  # Should be >= 18.0.0

# Check pnpm version
pnpm --version  # Should be >= 9.0.0

# Clean build
pnpm clean && pnpm build
```

#### Authentication Issues
```bash
# Check OpenAuth configuration
curl https://auth.alummahnow.net/.well-known/openid-configuration

# Validate JWT tokens
pnpm wrangler secret list
```

#### CORS Issues
```bash
# Test CORS headers
curl -H "Origin: https://alummahnow.net" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://videos.api.alummahnow.net/api/videos
```

#### WebSocket Connection Issues
```bash
# Test WebSocket connection
wscat -c wss://ws.alummahnow.net

# Check Durable Objects status
pnpm wrangler durable-objects list
```

### Performance Issues

#### Slow API Response
```bash
# Check Worker metrics
pnpm wrangler analytics --since 1h

# Monitor R2 performance
# Cloudflare Dashboard → R2 → Analytics
```

#### Video Streaming Issues
```bash
# Test Bunny.net stream
curl -I https://stream.alummahnow.net/video/manifest.m3u8

# Check CDN status
# Bunny.net Dashboard → Statistics
```

### Monitoring Alerts

#### Set Up Alerts
1. **Cloudflare Analytics** → Custom dashboards
2. **R2 Storage** → Usage alerts
3. **Workers** → Error rate monitoring
4. **Queue** → DLQ monitoring

#### Critical Metrics
- **Error Rate**: < 1%
- **Response Time**: < 200ms (p95)
- **WebSocket Uptime**: > 99.9%
- **Queue Processing**: < 5min lag

## Maintenance

### Regular Tasks
- **Dependency Updates**: Monthly security patches
- **Certificate Renewal**: Automatic via Cloudflare
- **Storage Cleanup**: Quarterly old data cleanup
- **Performance Reviews**: Monthly optimization

### Backup Strategy
- **R2 Storage**: Cross-region replication
- **KV Storage**: Automatic backup and restore
- **Configuration**: Git version control
- **Secrets**: Cloudflare secure storage

## Support and Documentation

### Resources
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [R2 Storage Guide](https://developers.cloudflare.com/r2/)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Bunny.net API Documentation](https://docs.bunny.net/)

### Emergency Contacts
- **Cloudflare Support**: Enterprise support plan
- **Bunny.net Support**: Technical support team
- **Internal Team**: On-call rotation

### Monitoring Dashboards
- **Cloudflare Dashboard**: Main observability
- **Custom Analytics**: Internal metrics
- **Error Tracking**: Sentry integration (if configured)
- **Performance Monitoring**: Real-time metrics