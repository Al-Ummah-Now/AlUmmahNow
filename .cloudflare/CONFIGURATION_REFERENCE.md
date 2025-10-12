# Cloudflare Configuration Reference

**📚 Complete Reference for All Cloudflare Resources**

Last Updated: 2024-10-12
Account: Al Ummah Now Production

## 📋 Table of Contents

1. [Account Information](#account-information)
2. [Workers Configuration](#workers-configuration)
3. [R2 Buckets](#r2-buckets)
4. [KV Namespaces](#kv-namespaces)
5. [Queues](#queues)
6. [Durable Objects](#durable-objects)
7. [Secrets Management](#secrets-management)
8. [Environment Variables](#environment-variables)
9. [Deployment Configuration](#deployment-configuration)

---

## 🏢 Account Information

### Cloudflare Account
- **Account Name:** Al Ummah Now
- **Dashboard:** https://dash.cloudflare.com/
- **API Token:** Stored in GitHub Secrets (`CLOUDFLARE_API_TOKEN`)
- **Account ID:** Stored in GitHub Variables (`CLOUDFLARE_ACCOUNT_ID`)

### Access Control
- **Primary Owner:** @meywd
- **CI/CD:** GitHub Actions (via API token)
- **Wrangler CLI:** Authenticated via `wrangler login`

---

## 👷 Workers Configuration

### 1. Web Application (al-ummah-web)

**Config File:** `apps/web/wrangler.production.jsonc`

```jsonc
{
  "name": "al-ummah-web",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat"],
  // Uses OpenNext adapter for Next.js 15
  "observability": { "enabled": true }
}
```

**Bindings:**
- R2: `web-assets` (static files)
- KV: Multiple namespaces for caching
- Routes: `https://alummahnow.net/*`

**Deployment:**
```bash
cd apps/web
pnpm wrangler deploy --config wrangler.production.jsonc
```

### 2. API Backend (videos)

**Config File:** `apps/api-videos/wrangler.jsonc`

```jsonc
{
  "name": "videos",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "dev": {
    "ip": "127.0.0.1",
    "port": 8686,
    "local_protocol": "http"
  }
}
```

**R2 Buckets:**
```jsonc
"r2_buckets": [
  { "binding": "videos", "bucket_name": "videos", "preview_bucket_name": "videos-preview" },
  { "binding": "profiles", "bucket_name": "profiles", "preview_bucket_name": "profiles-preview" },
  { "binding": "channels", "bucket_name": "channels", "preview_bucket_name": "channels-preview" },
  { "binding": "playlists", "bucket_name": "playlists", "preview_bucket_name": "playlists-preview" },
  { "binding": "reports", "bucket_name": "reports", "preview_bucket_name": "reports-preview" }
]
```

**KV Namespaces:**
```jsonc
"kv_namespaces": [
  {
    "binding": "AUTH_STORAGE",
    "id": "ff057deb522f4b2bb81006b42462f20e",
    "preview_id": "966e04e43b904ddeb26453291bf6c22d"
  }
]
```

**Queue Producers:**
```jsonc
"queues": {
  "producers": [
    { "queue": "al-ummah-now-videos", "binding": "queue" }
  ]
}
```

**Secrets Store:**
```jsonc
"secrets_store_secrets": [
  {
    "binding": "image_storage_key",
    "store_id": "f8eddc9944d041919ed8dc7d08d32308",
    "secret_name": "al-ummah-now-images-key"
  },
  {
    "binding": "bunny-stream-key",
    "store_id": "f8eddc9944d041919ed8dc7d08d32308",
    "secret_name": "bunny-stream-key"
  },
  {
    "binding": "bunny_stream_library_id",
    "store_id": "f8eddc9944d041919ed8dc7d08d32308",
    "secret_name": "bunny_stream_library_id"
  }
]
```

**Environment Variables:**
```jsonc
"vars": {
  "ZONE": "al-ummah-now-images"
}
```

**Deployment:**
```bash
cd apps/api-videos
pnpm wrangler deploy
```

### 3. Processor (al-ummah-now-processor)

**Config File:** `apps/processor/wrangler.toml`

```toml
name = "al-ummah-now-processor"
main = "src/index.ts"
compatibility_date = "2024-09-01"

[[r2_buckets]]
binding = "MESSAGES_BUCKET"
bucket_name = "al-ummah-now-messages"

[[queues.consumers]]
queue = "al-ummah-now-videos"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "al-ummah-now-dlq"

[vars]
ENVIRONMENT = "production"
LOG_LEVEL = "info"

[observability.logs]
enabled = true
```

**Environments:**
- **Production:** Default config
- **Staging:** `[env.staging]` section
- **Development:** `[env.development]` section

**Deployment:**
```bash
cd apps/processor
pnpm wrangler deploy              # Production
pnpm wrangler deploy --env staging # Staging
```

### 4. WebSocket Server (al-ummah-now-comms)

**Config File:** `apps/websocket-server/wrangler.jsonc`

```jsonc
{
  "name": "al-ummah-now-comms",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-12",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "dev": {
    "ip": "127.0.0.1",
    "port": 8787,
    "local_protocol": "http"
  }
}
```

**Durable Objects:**
```jsonc
"durable_objects": {
  "bindings": [
    {
      "name": "WEBSOCKET_DO",
      "class_name": "WebSocketDurableObject",
      "script_name": "al-ummah-now-comms"
    }
  ]
}
```

**Migrations:**
```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_classes": ["WebSocketDurableObject"]
  }
]
```

**KV Namespaces:**
```jsonc
"kv_namespaces": [
  {
    "binding": "PRESENCE_KV",
    "id": "a3dbf9b2b80c4a3ea101281e19fd8407",
    "preview_id": "156bbaeac14b4d0da721673e951bef3e"
  }
]
```

**Deployment:**
```bash
cd apps/websocket-server
pnpm wrangler deploy
```

---

## 🗄️ R2 Buckets

### Production Buckets

| Bucket Name | Purpose | Used By | Location | Size Limit |
|-------------|---------|---------|----------|------------|
| `videos` | Video metadata (JSON) | API (videos) | Auto | Unlimited |
| `profiles` | User profiles (JSON) | API (videos) | Auto | Unlimited |
| `channels` | Channel data (JSON) | API (videos) | Auto | Unlimited |
| `playlists` | Playlist data (JSON) | API (videos) | Auto | Unlimited |
| `reports` | Moderation reports (JSON) | API (videos) | Auto | Unlimited |
| `al-ummah-now-messages` | Event messages (JSON) | Processor | Auto | Unlimited |
| `web-assets` | Static web assets | Web app | Auto | Unlimited |

### Preview Buckets (Development)

| Bucket Name | Purpose | Used By | Safe to Delete |
|-------------|---------|---------|----------------|
| `videos-preview` | Video metadata (dev) | API (preview) | ⚠️ YES (dev only) |
| `profiles-preview` | Profiles (dev) | API (preview) | ⚠️ YES (dev only) |
| `channels-preview` | Channels (dev) | API (preview) | ⚠️ YES (dev only) |
| `playlists-preview` | Playlists (dev) | API (preview) | ⚠️ YES (dev only) |
| `reports-preview` | Reports (dev) | API (preview) | ⚠️ YES (dev only) |

### R2 Bucket Commands

```bash
# List all buckets
wrangler r2 bucket list

# Create bucket
wrangler r2 bucket create {bucket-name}

# Delete bucket (DANGEROUS)
wrangler r2 bucket delete {bucket-name}

# List objects in bucket
wrangler r2 object list {bucket-name}

# Get object
wrangler r2 object get {bucket-name}/{object-key}

# Put object
wrangler r2 object put {bucket-name}/{object-key} --file {local-file}
```

### R2 Access Patterns

**Storage Format:** JSON objects with entity ID as key

```typescript
// Example: Video metadata in R2
// Key: video-id-123
// Value:
{
  "id": "video-id-123",
  "title": "My Video",
  "userId": "user-id-456",
  "createdAt": "2025-10-12T00:00:00Z",
  // ... more fields
}
```

**Pagination:** Cursor-based using R2 list operations
```typescript
const list = await bucket.list({
  limit: 10,
  cursor: nextCursor,
});
```

---

## 🔑 KV Namespaces

### Production Namespaces

| Namespace | ID | Purpose | TTL | Used By |
|-----------|-----|---------|-----|---------|
| `AUTH_STORAGE` | ff057deb522f4b2bb81006b42462f20e | Auth tokens & session data | Variable | API (videos) |
| `PRESENCE_KV` | a3dbf9b2b80c4a3ea101281e19fd8407 | User online/offline status | 15 min | WebSocket (comms) |

### Preview Namespaces

| Namespace | ID | Purpose | Safe to Delete |
|-----------|-----|---------|----------------|
| `AUTH_STORAGE` (preview) | 966e04e43b904ddeb26453291bf6c22d | Auth (dev) | ⚠️ YES |
| `PRESENCE_KV` (preview) | 156bbaeac14b4d0da721673e951bef3e | Presence (dev) | ⚠️ YES |

### KV Commands

```bash
# List all namespaces
wrangler kv:namespace list

# Create namespace
wrangler kv:namespace create {namespace-name}
wrangler kv:namespace create {namespace-name} --preview # For preview

# List keys
wrangler kv:key list --namespace-id {id}

# Get value
wrangler kv:key get {key} --namespace-id {id}

# Put value
wrangler kv:key put {key} {value} --namespace-id {id}

# Delete key
wrangler kv:key delete {key} --namespace-id {id}

# Delete namespace (DANGEROUS)
wrangler kv:namespace delete --namespace-id {id}
```

### KV Storage Patterns

**AUTH_STORAGE:**
```typescript
// Store JWT tokens and session data
// Key: user:${userId}:session:${sessionId}
// Value: { token, expiresAt, metadata }
await env.AUTH_STORAGE.put(key, JSON.stringify(data), {
  expirationTtl: 3600, // 1 hour
});
```

**PRESENCE_KV:**
```typescript
// Store user presence status
// Key: presence:${userId}
// Value: { status: 'online' | 'offline', sessionId, timestamp }
await env.PRESENCE_KV.put(key, JSON.stringify(data), {
  expirationTtl: 900, // 15 minutes (auto-expire)
});
```

---

## 📬 Queues

### Production Queues

| Queue Name | Purpose | Batch Size | Timeout | Retries | DLQ |
|------------|---------|------------|---------|---------|-----|
| `al-ummah-now-videos` | Video events (views, likes, comments) | 10 | 30s | 3 | al-ummah-now-dlq |
| `al-ummah-now-dlq` | Dead letter queue for failed events | - | - | - | - |

### Queue Configuration

**Producer (API):**
```jsonc
// apps/api-videos/wrangler.jsonc
"queues": {
  "producers": [
    { "queue": "al-ummah-now-videos", "binding": "queue" }
  ]
}
```

**Consumer (Processor):**
```toml
# apps/processor/wrangler.toml
[[queues.consumers]]
queue = "al-ummah-now-videos"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "al-ummah-now-dlq"
```

### Queue Commands

```bash
# List queues
wrangler queues list

# Create queue
wrangler queues create {queue-name}

# Send message (for testing)
wrangler queues send {queue-name} --body '{"test": "message"}'

# View consumer
wrangler queues consumer list {queue-name}

# Delete queue (DANGEROUS)
wrangler queues delete {queue-name}
```

### Queue Message Format

**Video View Event:**
```json
{
  "type": "video_view",
  "videoId": "video-id-123",
  "userId": "user-id-456",
  "timestamp": 1697040000000,
  "metadata": {
    "ip": "1.2.3.4",
    "userAgent": "Mozilla/5.0...",
    "referrer": "https://example.com"
  }
}
```

**Video Like Event:**
```json
{
  "type": "video_like",
  "videoId": "video-id-123",
  "userId": "user-id-456",
  "timestamp": 1697040000000
}
```

---

## 🔒 Durable Objects

### WebSocketDurableObject

**Configuration:**
```jsonc
// apps/websocket-server/wrangler.jsonc
"durable_objects": {
  "bindings": [
    {
      "name": "WEBSOCKET_DO",
      "class_name": "WebSocketDurableObject",
      "script_name": "al-ummah-now-comms"
    }
  ]
}
```

**Migration History:**
```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_classes": ["WebSocketDurableObject"]
  }
]
```

**Instance Naming:**
- **Production:** Single instance using `idFromName('websocket-instance')`
- **Future:** Can shard by user ID or channel for scaling

**State Management:**
- Each DO instance manages its own WebSocket connections
- Presence data synced to KV for cross-instance access
- In-memory state for performance, KV for persistence

### Durable Objects Commands

```bash
# View DO class in dashboard
# Cloudflare Dashboard → Durable Objects

# Get DO instance ID (from code)
const id = env.WEBSOCKET_DO.idFromName('websocket-instance');

# Delete all DO instances (DANGEROUS - loses all state)
# No CLI command - must be done via API
```

---

## 🔐 Secrets Management

### Secrets Store

**Store ID:** `f8eddc9944d041919ed8dc7d08d32308`

| Secret Name | Purpose | Used By | Rotation |
|-------------|---------|---------|----------|
| `al-ummah-now-images-key` | Bunny.net storage API key | API (videos) | Quarterly |
| `bunny-stream-key` | Bunny.net streaming API key | API (videos) | Quarterly |
| `bunny_stream_library_id` | Bunny.net library ID | API (videos) | Never (ID) |
| `INTERNAL_API_KEY` | Server-to-server auth | WebSocket (comms) | Quarterly |

### Additional Secrets (Environment Variables)

Set via `wrangler secret put`:

| Secret | Purpose | Used By |
|--------|---------|---------|
| `Issuer` | OpenAuth JWT issuer | API (videos), WebSocket |
| `Audience` | OpenAuth JWT audience | API (videos), WebSocket |
| `ClientId` | OpenAuth client ID | API (videos), WebSocket |

### Secrets Commands

```bash
# List secrets (names only, values hidden)
wrangler secret list

# Set secret
wrangler secret put {secret-name}
# Prompts for value interactively

# Set secret from file
echo "secret-value" | wrangler secret put {secret-name}

# Delete secret
wrangler secret delete {secret-name}

# Access in code
const apiKey = await c.env["bunny-stream-key"].text();
```

### Secrets Rotation Procedure

1. Generate new secret value
2. Add new secret with versioned name: `{secret-name}-v2`
3. Update code to use new secret
4. Deploy updated code
5. Verify new secret works
6. Delete old secret
7. Update documentation

---

## 🌍 Environment Variables

### Production Variables

**API (videos):**
```jsonc
"vars": {
  "ZONE": "al-ummah-now-images"
}
```

**Processor:**
```toml
[vars]
ENVIRONMENT = "production"
LOG_LEVEL = "info"
```

**WebSocket (comms):**
```jsonc
"vars": {
  // Runtime config via secrets:
  // Issuer, Audience, ClientId, INTERNAL_API_KEY
  // RATE_LIMIT_MESSAGES, RATE_LIMIT_WINDOW_MS
  // MAX_CONNECTIONS_PER_DO
}
```

### Environment Variables Commands

```bash
# Set via wrangler.toml/jsonc
# Or use:
wrangler secret put {VAR_NAME}

# Access in code:
const zone = c.env.ZONE;
const env = c.env.ENVIRONMENT;
```

---

## 🚀 Deployment Configuration

### GitHub Actions Secrets

| Secret | Purpose | Value Source |
|--------|---------|--------------|
| `CLOUDFLARE_API_TOKEN` | Deploy workers | Cloudflare Dashboard → API Tokens |

### GitHub Actions Variables

| Variable | Purpose | Value |
|----------|---------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | Account ID for deployments | Cloudflare Dashboard → Account ID |

### CI/CD Pipeline

**File:** `.github/workflows/deploy.yml`

**Environments:**
1. **Preview** (PR-specific):
   - `al-ummah-web-pr-{number}.workers.dev`
   - `al-ummah-api-pr-{number}.workers.dev`
   - `al-ummah-processor-pr-{number}`
   - `al-ummah-comms-pr-{number}.workers.dev`

2. **Staging** (main branch):
   - Uses staging configs
   - Deployed before production
   - Manual verification required

3. **Production** (main branch, after staging):
   - Uses production configs
   - Requires staging success
   - Auto-deployed after approval

### Deployment Commands (Local)

```bash
# Deploy to production
cd apps/{app-name}
pnpm wrangler deploy

# Deploy to staging
pnpm wrangler deploy --env staging

# Deploy with custom name (preview)
pnpm wrangler deploy --name {custom-name}

# Dry run (validate only)
pnpm wrangler deploy --dry-run
```

### Rollback Procedure

```bash
# List deployments
wrangler deployments list --name {worker-name}

# Rollback to previous deployment
wrangler rollback --message "Rolling back to previous version"

# Or redeploy specific commit
git checkout {commit-hash}
cd apps/{app-name}
pnpm wrangler deploy
git checkout main
```

---

## 📊 Monitoring & Observability

### Observability Configuration

All workers have observability enabled:
```jsonc
"observability": {
  "enabled": true
}
```

### Logs

**Access Logs:**
```bash
# Tail logs (real-time)
wrangler tail {worker-name}

# Tail with filter
wrangler tail {worker-name} --format json | jq 'select(.level == "error")'

# View in dashboard
# Cloudflare Dashboard → Workers → {worker} → Logs
```

### Metrics

**Available in Cloudflare Dashboard:**
- Request count
- Error rate
- CPU time
- Duration (p50, p99)
- Success rate

**Health Check Endpoints:**
- Web: `https://alummahnow.net/health`
- API: `https://api.alummahnow.net/health`
- WebSocket: `https://comms.alummahnow.net/health`

### Alerts

**Set up in Cloudflare Dashboard:**
1. Workers → {worker-name} → Metrics
2. Create Alert
3. Configure thresholds:
   - Error rate > 5%
   - CPU time > 50ms p99
   - Request rate < 1 (downtime)

---

## 🔧 Maintenance Tasks

### Weekly Tasks
- [ ] Review error logs
- [ ] Check queue depth (DLQ)
- [ ] Verify health endpoints
- [ ] Monitor R2 storage usage

### Monthly Tasks
- [ ] Rotate secrets (quarterly schedule)
- [ ] Clean up orphaned preview workers
- [ ] Review and update this documentation
- [ ] Audit access controls

### Quarterly Tasks
- [ ] Full security audit
- [ ] Disaster recovery test
- [ ] Capacity planning review
- [ ] Update dependency versions

---

## 📚 Quick Reference

### Essential Commands

```bash
# Deploy
cd apps/{app}
pnpm wrangler deploy

# Check status
wrangler deployments list
wrangler tail {worker-name}

# Secrets
wrangler secret list
wrangler secret put {name}

# Storage
wrangler r2 bucket list
wrangler kv:namespace list

# Queues
wrangler queues list
```

### Resource IDs Quick Lookup

**KV Namespaces:**
- AUTH_STORAGE: `ff057deb522f4b2bb81006b42462f20e`
- PRESENCE_KV: `a3dbf9b2b80c4a3ea101281e19fd8407`

**Secrets Store:**
- Store ID: `f8eddc9944d041919ed8dc7d08d32308`

**Queues:**
- al-ummah-now-videos (producer: API, consumer: Processor)
- al-ummah-now-dlq (dead letter)

### Support Resources

- **Cloudflare Docs:** https://developers.cloudflare.com/workers/
- **Wrangler CLI:** https://developers.cloudflare.com/workers/wrangler/
- **Status Page:** https://www.cloudflarestatus.com/
- **Support:** https://dash.cloudflare.com/?to=/:account/support

---

**Last Updated:** 2025-10-12
**Next Review:** Monthly or after major changes
**Maintainers:** @meywd, DevOps team, Claude Code agents
