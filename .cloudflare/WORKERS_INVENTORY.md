# Cloudflare Workers Inventory

**⚠️ CRITICAL REFERENCE DOCUMENT - DO NOT DELETE WORKERS WITHOUT CONSULTING THIS**

Last Updated: 2025-10-12
Account: Al Ummah Now Production

## 📋 Table of Contents

1. [Production Workers](#production-workers)
2. [Preview/Staging Workers](#previewstaging-workers)
3. [Critical Resources](#critical-resources)
4. [Worker Dependencies](#worker-dependencies)
5. [Safety Guidelines](#safety-guidelines)

---

## 🚀 Production Workers

### 1. **al-ummah-web** (Web Application)
- **Purpose:** Main Next.js 15 frontend application
- **Config:** `apps/web/wrangler.production.jsonc`
- **URL:** https://alummahnow.net (production domain)
- **Tech:** Next.js 15 + OpenNext + Cloudflare Workers
- **Bindings:**
  - R2: `web-assets` (static files)
  - KV: Multiple for caching and state
- **DELETE PROTECTION:** ⛔ **NEVER DELETE** - Main user-facing application
- **Notes:** Uses OpenNext adapter for deployment

### 2. **videos** (API Backend)
- **Purpose:** Video platform API with OpenAPI/Swagger
- **Config:** `apps/api-videos/wrangler.jsonc`
- **URL:** https://api.alummahnow.net
- **Tech:** Hono + chanfana + OpenAPI 3.1
- **Bindings:**
  - **R2 Buckets (5):**
    - `videos` - Video metadata storage
    - `profiles` - User profiles
    - `channels` - Channel data
    - `playlists` - Playlist data
    - `reports` - Moderation reports
  - **KV Namespaces:**
    - `AUTH_STORAGE` (ID: ff057deb522f4b2bb81006b42462f20e)
  - **Queue Producers:**
    - `al-ummah-now-videos` queue
  - **Secrets Store:**
    - `image_storage_key` - Bunny.net storage
    - `bunny-stream-key` - Bunny.net streaming
    - `bunny_stream_library_id` - Library ID
- **DELETE PROTECTION:** ⛔ **NEVER DELETE** - Core API functionality
- **Notes:** Interactive Swagger UI at root URL

### 3. **al-ummah-now-processor** (Queue Consumer)
- **Purpose:** Processes video events and analytics
- **Config:** `apps/processor/wrangler.toml`
- **URL:** Internal service (no public URL)
- **Tech:** Cloudflare Queue Consumer
- **Bindings:**
  - **R2 Buckets:**
    - `MESSAGES_BUCKET` (al-ummah-now-messages) - Event storage
  - **Queue Consumers:**
    - `al-ummah-now-videos` (batch: 10, timeout: 30s, retries: 3)
    - Dead letter: `al-ummah-now-dlq`
- **DELETE PROTECTION:** ⛔ **NEVER DELETE** - Critical event processing
- **Environments:** production, staging, development

### 4. **al-ummah-now-comms** (WebSocket Server)
- **Purpose:** Real-time WebSocket communications
- **Config:** `apps/websocket-server/wrangler.jsonc`
- **URL:** wss://comms.alummahnow.net (or similar)
- **Tech:** Cloudflare Durable Objects
- **Bindings:**
  - **Durable Objects:**
    - `WEBSOCKET_DO` - WebSocketDurableObject class
  - **KV Namespaces:**
    - `PRESENCE_KV` (ID: a3dbf9b2b80c4a3ea101281e19fd8407)
    - Preview: 156bbaeac14b4d0da721673e951bef3e
  - **Migrations:** v1 (WebSocketDurableObject)
- **DELETE PROTECTION:** ⛔ **NEVER DELETE** - Real-time features
- **Notes:** Handles notifications, presence, live chat

---

## 🔄 Preview/Staging Workers

### Preview Workers (PR-specific)

**Naming Convention:** `{app}-pr-{number}`

#### Web App Previews
- **Pattern:** `al-ummah-web-pr-{number}`
- **Example:** `al-ummah-web-pr-42`
- **URL:** `https://al-ummah-web-pr-{number}.workers.dev`
- **Lifecycle:** Created on PR open, deleted on PR close
- **DELETE PROTECTION:** ⚠️ Safe to delete manually if PR closed

#### API Previews
- **Pattern:** `al-ummah-api-pr-{number}`
- **Example:** `al-ummah-api-pr-42`
- **URL:** `https://al-ummah-api-pr-{number}.workers.dev`
- **Lifecycle:** Created on PR open, deleted on PR close
- **DELETE PROTECTION:** ⚠️ Safe to delete manually if PR closed

#### Processor Previews
- **Pattern:** `al-ummah-processor-pr-{number}`
- **Example:** `al-ummah-processor-pr-42`
- **Lifecycle:** Created on PR open, deleted on PR close
- **DELETE PROTECTION:** ⚠️ Safe to delete manually if PR closed

#### WebSocket Previews
- **Pattern:** `al-ummah-comms-pr-{number}`
- **Example:** `al-ummah-comms-pr-42`
- **URL:** `https://al-ummah-comms-pr-{number}.workers.dev`
- **Lifecycle:** Created on PR open, deleted on PR close
- **DELETE PROTECTION:** ⚠️ Safe to delete manually if PR closed

### Staging Workers

#### Web App Staging
- **Name:** `al-ummah-web-staging`
- **Config:** `apps/web/wrangler.staging.jsonc`
- **URL:** https://staging.alummahnow.net
- **DELETE PROTECTION:** ⚠️ Can be deleted but impacts staging environment

#### API Staging
- **Name:** `videos-staging`
- **Environment:** `staging` in wrangler.jsonc
- **DELETE PROTECTION:** ⚠️ Can be deleted but impacts staging environment

#### Processor Staging
- **Name:** `al-ummah-now-processor` (env: staging)
- **DELETE PROTECTION:** ⚠️ Can be deleted but impacts staging environment

---

## 💾 Critical Resources

### R2 Buckets (Production)

| Bucket Name | Purpose | Used By | DELETE PROTECTION |
|-------------|---------|---------|-------------------|
| `videos` | Video metadata (JSON) | API (videos) | ⛔ **NEVER DELETE** |
| `profiles` | User profiles (JSON) | API (videos) | ⛔ **NEVER DELETE** |
| `channels` | Channel data (JSON) | API (videos) | ⛔ **NEVER DELETE** |
| `playlists` | Playlist data (JSON) | API (videos) | ⛔ **NEVER DELETE** |
| `reports` | Moderation reports (JSON) | API (videos) | ⛔ **NEVER DELETE** |
| `al-ummah-now-messages` | Event messages (JSON) | Processor | ⛔ **NEVER DELETE** |
| `web-assets` | Static web assets | Web app | ⛔ **NEVER DELETE** |

### R2 Buckets (Preview)

| Bucket Name | Purpose | DELETE PROTECTION |
|-------------|---------|-------------------|
| `videos-preview` | Video metadata (dev/preview) | ⚠️ Safe to delete (dev only) |
| `profiles-preview` | User profiles (dev/preview) | ⚠️ Safe to delete (dev only) |
| `channels-preview` | Channel data (dev/preview) | ⚠️ Safe to delete (dev only) |
| `playlists-preview` | Playlist data (dev/preview) | ⚠️ Safe to delete (dev only) |
| `reports-preview` | Reports (dev/preview) | ⚠️ Safe to delete (dev only) |

### KV Namespaces

| Namespace | ID | Purpose | DELETE PROTECTION |
|-----------|-----|---------|-------------------|
| `AUTH_STORAGE` | ff057deb522f4b2bb81006b42462f20e | Authentication data | ⛔ **NEVER DELETE** |
| `AUTH_STORAGE` (preview) | 966e04e43b904ddeb26453291bf6c22d | Auth (preview) | ⚠️ Safe to delete (dev only) |
| `PRESENCE_KV` | a3dbf9b2b80c4a3ea101281e19fd8407 | User presence tracking | ⛔ **NEVER DELETE** |
| `PRESENCE_KV` (preview) | 156bbaeac14b4d0da721673e951bef3e | Presence (preview) | ⚠️ Safe to delete (dev only) |

### Queues

| Queue Name | Purpose | Used By | DELETE PROTECTION |
|------------|---------|---------|-------------------|
| `al-ummah-now-videos` | Video events (views, likes, comments) | API → Processor | ⛔ **NEVER DELETE** |
| `al-ummah-now-dlq` | Dead letter queue for failed events | Processor | ⛔ **NEVER DELETE** |

### Durable Objects

| Class Name | Purpose | Used By | DELETE PROTECTION |
|------------|---------|---------|-------------------|
| `WebSocketDurableObject` | WebSocket connection management | al-ummah-now-comms | ⛔ **NEVER DELETE** |

### Secrets Store

| Secret Name | Store ID | Purpose | DELETE PROTECTION |
|-------------|----------|---------|-------------------|
| `al-ummah-now-images-key` | f8eddc9944d041919ed8dc7d08d32308 | Bunny.net storage | ⛔ **NEVER DELETE** |
| `bunny-stream-key` | f8eddc9944d041919ed8dc7d08d32308 | Bunny.net streaming API | ⛔ **NEVER DELETE** |
| `bunny_stream_library_id` | f8eddc9944d041919ed8dc7d08d32308 | Bunny.net library | ⛔ **NEVER DELETE** |
| `INTERNAL_API_KEY` | - | Server-to-server auth | ⛔ **NEVER DELETE** |

---

## 🔗 Worker Dependencies

### Dependency Graph

```
┌─────────────────┐
│   al-ummah-web  │ (Frontend)
│  (Next.js 15)   │
└────────┬────────┘
         │ API calls
         ▼
┌─────────────────┐        Queue Events        ┌──────────────────────┐
│     videos      │───────────────────────────►│ al-ummah-now-processor│
│  (Hono API)     │                             │  (Queue Consumer)    │
└────────┬────────┘                             └──────────────────────┘
         │ WebSocket notifications                         │
         ▼                                                  ▼
┌─────────────────┐                             ┌──────────────────────┐
│ al-ummah-now-   │                             │   R2: messages       │
│    comms        │                             │  (Event Storage)     │
│ (Durable Objects)│                             └──────────────────────┘
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  KV: PRESENCE   │
│ (Online Status) │
└─────────────────┘
```

### Critical Dependency Chains

1. **Video Upload Flow:**
   - Web → API → Bunny.net → Queue → Processor → R2 messages
   - **Delete any component = BREAKS upload pipeline**

2. **Real-time Notifications:**
   - API → al-ummah-now-comms → KV PRESENCE
   - **Delete comms worker = NO real-time features**

3. **Authentication:**
   - Web/API → OpenAuth → KV AUTH_STORAGE
   - **Delete AUTH_STORAGE = ALL users logged out**

---

## 🛡️ Safety Guidelines

### ⛔ NEVER DELETE (Production Critical)

1. **Production Workers:**
   - `al-ummah-web`
   - `videos`
   - `al-ummah-now-processor`
   - `al-ummah-now-comms`

2. **Production R2 Buckets:**
   - `videos`, `profiles`, `channels`, `playlists`, `reports`
   - `al-ummah-now-messages`
   - `web-assets`

3. **Production KV Namespaces:**
   - `AUTH_STORAGE` (ID: ff057deb522f4b2bb81006b42462f20e)
   - `PRESENCE_KV` (ID: a3dbf9b2b80c4a3ea101281e19fd8407)

4. **Queues:**
   - `al-ummah-now-videos`
   - `al-ummah-now-dlq`

5. **Durable Objects:**
   - `WebSocketDurableObject` class

6. **Secrets:**
   - All secrets in store f8eddc9944d041919ed8dc7d08d32308
   - `INTERNAL_API_KEY`

### ⚠️ Safe to Delete (With Caution)

1. **Closed PR Previews:**
   - `*-pr-{number}` workers (if PR is closed)
   - Check PR status first: `gh pr view {number}`

2. **Old Staging Workers:**
   - Only if new staging environment is deployed
   - Verify staging URL still works after deletion

3. **Preview Buckets:**
   - `*-preview` buckets (used only in development)
   - Keep at least one for testing

### ✅ Automated Cleanup

**CI/CD Cleanup Process:**
- GitHub Action: `.github/workflows/deploy.yml` (cleanup-previews job)
- Triggers: When PR is closed
- Deletes: `al-ummah-web-pr-{number}`, `al-ummah-api-pr-{number}`, `al-ummah-processor-pr-{number}`, `al-ummah-comms-pr-{number}`

**Manual Cleanup Scripts:**
- `cleanup-pr-previews.sh` - Delete all PR preview workers
- `cleanup-pr-workers-api.sh` - Delete API-specific previews
- `delete-pr-workers.sh` - Delete specific PR worker

### 🔍 Before Deleting Any Worker

**Checklist:**

1. ✅ Confirm worker name matches preview pattern `*-pr-{number}`
2. ✅ Verify PR is closed: `gh pr view {number}`
3. ✅ Check worker is NOT in production list (see above)
4. ✅ Check no active deployments are using it
5. ✅ Document deletion in team chat
6. ✅ Have rollback plan if deletion causes issues

**Verification Commands:**
```bash
# List all workers
wrangler deployments list

# Check specific worker
wrangler deployments list --name {worker-name}

# Verify PR status
gh pr view {number} --json state
```

### 🚨 Incident Response

**If Production Worker Accidentally Deleted:**

1. **Immediate Actions:**
   - Check latest commit: `git log -1`
   - Redeploy immediately: `cd apps/{app} && pnpm wrangler deploy`
   - Notify team in Slack/Discord

2. **Web App (al-ummah-web):**
   ```bash
   cd apps/web
   pnpm wrangler deploy --config wrangler.production.jsonc
   ```

3. **API (videos):**
   ```bash
   cd apps/api-videos
   pnpm wrangler deploy
   ```

4. **Processor (al-ummah-now-processor):**
   ```bash
   cd apps/processor
   pnpm wrangler deploy
   ```

5. **WebSocket (al-ummah-now-comms):**
   ```bash
   cd apps/websocket-server
   pnpm wrangler deploy
   ```

6. **Verify Restoration:**
   - Check health endpoints
   - Test critical user flows
   - Monitor error logs

### 📝 Deletion Log Template

When manually deleting workers, log here:

```
Date: YYYY-MM-DD
Worker: {name}
Reason: {PR closed / staging cleanup / etc}
Deleted By: {your name}
Verified Safe: [YES/NO]
Restoration Plan: {how to restore if needed}
```

---

## 🔄 Worker Lifecycle

### Preview Worker Lifecycle

```
PR Opened → Deploy Preview Worker → PR Merged/Closed → Delete Preview Worker
           (CI: deploy-*-preview)                      (CI: cleanup-previews)
```

### Staging Worker Lifecycle

```
Main Branch Updated → Deploy Staging → (Stays Active) → New Staging Deploy
                     (CI: deploy-staging)               (Replaces previous)
```

### Production Worker Lifecycle

```
Staging Tested → Manual Approval → Deploy Production → (Stays Active)
                                   (CI: deploy-production)
```

---

## 📚 Additional Resources

- **Wrangler Docs:** https://developers.cloudflare.com/workers/wrangler/
- **Worker Names:** Must match `wrangler.jsonc` `name` field
- **Cloudflare Dashboard:** https://dash.cloudflare.com/
- **GitHub Actions:** `.github/workflows/deploy.yml`
- **Monorepo Docs:** `CLAUDE.md` (root)

---

**Last Reviewed:** 2025-10-12
**Next Review:** Every major deployment or architecture change
**Maintainers:** @meywd, Claude Code agents
