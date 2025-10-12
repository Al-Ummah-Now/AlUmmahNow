# Cloudflare Workers Safety Guidelines

**🚨 READ THIS BEFORE DELETING ANY CLOUDFLARE RESOURCE 🚨**

Last Updated: 2025-10-12

## 🎯 Purpose

This document prevents accidental deletion of critical Cloudflare Workers and resources. A single deletion can take down the entire platform.

---

## ⛔ NEVER DELETE - Production Critical

### Production Workers (4 Total)

| Worker Name | Protection Level | Impact if Deleted |
|-------------|------------------|-------------------|
| `al-ummah-web` | ⛔ **CRITICAL** | **SITE DOWN** - Main website offline |
| `videos` | ⛔ **CRITICAL** | **API DOWN** - All video features broken |
| `al-ummah-now-processor` | ⛔ **CRITICAL** | **ANALYTICS DOWN** - No event processing |
| `al-ummah-now-comms` | ⛔ **CRITICAL** | **REAL-TIME DOWN** - No notifications/chat |

### Production Resources

**R2 Buckets (7):**
- `videos` ⛔ - Video metadata (JSON database)
- `profiles` ⛔ - User profiles
- `channels` ⛔ - Channel data
- `playlists` ⛔ - Playlist data
- `reports` ⛔ - Moderation reports
- `al-ummah-now-messages` ⛔ - Event messages
- `web-assets` ⛔ - Static website files

**KV Namespaces (2):**
- `AUTH_STORAGE` (ID: ff057deb522f4b2bb81006b42462f20e) ⛔ - Auth tokens
- `PRESENCE_KV` (ID: a3dbf9b2b80c4a3ea101281e19fd8407) ⛔ - User presence

**Queues (2):**
- `al-ummah-now-videos` ⛔ - Event queue
- `al-ummah-now-dlq` ⛔ - Dead letter queue

**Durable Objects:**
- `WebSocketDurableObject` ⛔ - WebSocket class

**Secrets (Store ID: f8eddc9944d041919ed8dc7d08d32308):**
- `al-ummah-now-images-key` ⛔
- `bunny-stream-key` ⛔
- `bunny_stream_library_id` ⛔
- `INTERNAL_API_KEY` ⛔

---

## ⚠️ DELETE WITH CAUTION - Non-Production

### Preview Workers (PR-Specific)

**Pattern:** `{app}-pr-{number}`

| Pattern | Example | When Safe to Delete |
|---------|---------|---------------------|
| `al-ummah-web-pr-*` | `al-ummah-web-pr-42` | After PR closed |
| `al-ummah-api-pr-*` | `al-ummah-api-pr-42` | After PR closed |
| `al-ummah-processor-pr-*` | `al-ummah-processor-pr-42` | After PR closed |
| `al-ummah-comms-pr-*` | `al-ummah-comms-pr-42` | After PR closed |

**Verification Before Deletion:**
```bash
# Check PR status
gh pr view {number} --json state

# If state is "CLOSED" or "MERGED", safe to delete
wrangler delete {worker-name}
```

### Staging Workers

| Worker Name | Safe to Delete? | Notes |
|-------------|----------------|-------|
| `al-ummah-web-staging` | ⚠️ YES (if staging not needed) | Breaks staging env |
| `videos-staging` | ⚠️ YES (if staging not needed) | Breaks staging env |
| `al-ummah-now-processor` (env: staging) | ⚠️ YES (if staging not needed) | Breaks staging env |

### Preview/Dev Resources

| Resource | Safe to Delete? |
|----------|----------------|
| `*-preview` R2 buckets | ⚠️ YES (dev only, not production) |
| Preview KV namespaces | ⚠️ YES (dev only, not production) |

---

## 🔒 Deletion Rules

### Rule 1: Three-Check System

Before deleting ANY worker, verify ALL three:

1. ✅ **Name Check:** Worker name includes `-pr-` OR `-staging` OR `-preview`
2. ✅ **Status Check:** PR is closed/merged (if PR worker)
3. ✅ **Production Check:** Worker is NOT in production list above

**If ANY check fails → DO NOT DELETE**

### Rule 2: Production Worker Protection

**NEVER delete workers with these exact names:**
- `al-ummah-web`
- `videos`
- `al-ummah-now-processor`
- `al-ummah-now-comms`

**No exceptions. No manual overrides.**

### Rule 3: Resource Cascade

Deleting a worker may leave orphaned resources. Check before deleting:

```bash
# List worker's bindings
wrangler deployments list --name {worker-name}

# Check for orphaned R2 buckets
wrangler r2 bucket list

# Check for orphaned KV namespaces
wrangler kv:namespace list
```

### Rule 4: Backup Before Deletion

**For staging/preview workers, export config first:**
```bash
# Export worker code
wrangler whoami
wrangler deployments list --name {worker-name}

# Document bindings
wrangler deployments list --name {worker-name} | grep -A 20 "Bindings"
```

---

## 🚨 Emergency Procedures

### If Production Worker Deleted Accidentally

**IMMEDIATE ACTION (< 5 minutes):**

1. **Don't panic - workers can be redeployed from code**

2. **Identify deleted worker:**
   ```bash
   # Check recent deletions
   wrangler deployments list | grep -i deleted
   ```

3. **Redeploy from monorepo:**

   **Web App:**
   ```bash
   cd apps/web
   pnpm wrangler deploy --config wrangler.production.jsonc
   ```

   **API:**
   ```bash
   cd apps/api-videos
   pnpm wrangler deploy
   ```

   **Processor:**
   ```bash
   cd apps/processor
   pnpm wrangler deploy
   ```

   **WebSocket:**
   ```bash
   cd apps/websocket-server
   pnpm wrangler deploy
   ```

4. **Verify restoration:**
   ```bash
   # Check web app
   curl https://alummahnow.net/health

   # Check API
   curl https://api.alummahnow.net/health

   # Check processor (internal)
   # Check CloudFlare dashboard for queue consumer

   # Check WebSocket
   curl https://comms.alummahnow.net/health
   ```

5. **Post-incident:**
   - Document what happened
   - Update this guide if needed
   - Review access controls

### If R2 Bucket Deleted

**⚠️ DATA LOSS - CANNOT BE RECOVERED**

1. **Check if backup exists:**
   - Bunny.net may have video copies
   - R2 doesn't have automatic backups

2. **Restore from Bunny.net (videos only):**
   - Contact Bunny.net support
   - Export library metadata
   - Recreate R2 bucket
   - Re-import video metadata

3. **For other data (profiles, channels, playlists):**
   - **NO RECOVERY POSSIBLE**
   - Users must re-enter data
   - Consider implementing backup strategy

### If KV Namespace Deleted

**Impact:**
- `AUTH_STORAGE` deleted = All users logged out
- `PRESENCE_KV` deleted = Presence tracking broken

**Recovery:**
1. Recreate KV namespace with same name
2. Update wrangler.jsonc with new ID
3. Redeploy affected workers
4. Users must re-authenticate

### If Queue Deleted

**Impact:**
- `al-ummah-now-videos` deleted = Event processing stops
- `al-ummah-now-dlq` deleted = Failed events lost

**Recovery:**
1. Recreate queue in Cloudflare dashboard
2. Update processor wrangler.toml
3. Redeploy processor
4. In-flight events are **LOST**

---

## 🔍 Verification Commands

### Check Before Deletion

```bash
# 1. Verify worker name
echo "{worker-name}" | grep -E "(pr-[0-9]+|staging|preview)"

# 2. Check if worker exists
wrangler deployments list --name {worker-name}

# 3. If PR worker, check PR status
gh pr view {pr-number} --json state

# 4. List all production workers (compare against)
wrangler deployments list | grep -E "(al-ummah-web|videos|processor|comms)" | grep -v "pr-"
```

### Check After Deletion

```bash
# 1. Verify deletion
wrangler deployments list --name {worker-name}
# Should return: No deployments found

# 2. Check production workers still exist
curl https://alummahnow.net/ # Web
curl https://api.alummahnow.net/ # API

# 3. Check queue consumer (if deleted processor)
# Go to Cloudflare Dashboard → Queues → al-ummah-now-videos
# Verify consumer is attached
```

---

## 📋 Deletion Checklist

Use this checklist for EVERY deletion:

### Pre-Deletion Checklist

- [ ] Worker name contains `-pr-` OR `-staging` OR `-preview`
- [ ] If PR worker: PR is CLOSED or MERGED
- [ ] Worker is NOT in production list (al-ummah-web, videos, processor, comms)
- [ ] Verified with: `wrangler deployments list --name {worker-name}`
- [ ] Checked dependencies: Worker is not referenced by other workers
- [ ] Backup exported (if staging/important)
- [ ] Team notified (if collaborative project)
- [ ] Documented reason for deletion

### Deletion Command

```bash
# ONLY run if all checklist items are checked
cd apps/{app-directory}
pnpm wrangler delete {worker-name}
```

### Post-Deletion Checklist

- [ ] Verified deletion: `wrangler deployments list --name {worker-name}` returns nothing
- [ ] Production workers still work: Checked URLs
- [ ] No orphaned resources: Checked R2/KV/Queues
- [ ] Documented deletion in team chat/log
- [ ] Updated `.cloudflare/WORKERS_INVENTORY.md` if needed

---

## 🛠️ Automated Cleanup

### CI/CD Cleanup Process

**GitHub Actions:** `.github/workflows/deploy.yml`

**Trigger:** PR closed
**Action:** Deletes preview workers automatically

```yaml
cleanup-previews:
  if: github.event_name == 'pull_request' && github.event.action == 'closed'
  steps:
    - Delete: al-ummah-web-pr-{number}
    - Delete: al-ummah-api-pr-{number}
    - Delete: al-ummah-processor-pr-{number}
    - Delete: al-ummah-comms-pr-{number}
```

**Manual Override:**
```bash
# Run cleanup script
./cleanup-pr-previews.sh {pr-number}
```

### Manual Cleanup Scripts

**Location:** Root directory

1. **`cleanup-pr-previews.sh`** - Delete all PR previews
   ```bash
   ./cleanup-pr-previews.sh 42  # Delete PR #42 workers
   ```

2. **`cleanup-pr-workers-api.sh`** - Delete API previews only
   ```bash
   ./cleanup-pr-workers-api.sh 42
   ```

3. **`delete-pr-workers.sh`** - Interactive deletion
   ```bash
   ./delete-pr-workers.sh
   # Prompts for PR number and confirmation
   ```

---

## 🎓 Training Scenarios

### Scenario 1: PR Merged, Cleanup Previews

**Situation:** PR #45 merged, preview workers still exist

**Safe Actions:**
```bash
# 1. Verify PR merged
gh pr view 45 --json state
# Returns: {"state":"MERGED"}

# 2. Delete preview workers
wrangler delete al-ummah-web-pr-45
wrangler delete al-ummah-api-pr-45
wrangler delete al-ummah-processor-pr-45
wrangler delete al-ummah-comms-pr-45
```

**Result:** ✅ Safe - PR closed, previews no longer needed

### Scenario 2: Clean Up Old Staging

**Situation:** Multiple staging workers exist

**DANGER:**
```bash
# ❌ DO NOT DO THIS
wrangler delete al-ummah-web  # PRODUCTION!
```

**Safe Actions:**
```bash
# 1. List all workers
wrangler deployments list | grep staging

# 2. Verify staging workers
# al-ummah-web-staging ✅ Safe
# videos-staging ✅ Safe
# al-ummah-now-processor (env: staging) ✅ Safe

# 3. Delete if not needed
wrangler delete al-ummah-web-staging
# Note: Use environment flag for processor
cd apps/processor
wrangler delete --env staging
```

**Result:** ✅ Safe - Staging workers, not production

### Scenario 3: Production Worker Missing

**Situation:** `videos` worker not found

**WRONG Response:**
```bash
# ❌ DO NOT assume it was deleted and recreate with new ID
wrangler init videos
```

**Correct Response:**
```bash
# 1. Check if actually deleted
wrangler deployments list --name videos

# 2. If deleted, redeploy from code
cd apps/api-videos
pnpm wrangler deploy

# 3. Verify restoration
curl https://api.alummahnow.net/health
```

**Result:** ✅ Worker restored from existing code

---

## 📚 Reference Materials

### Quick Reference Card

**Production Workers (NEVER DELETE):**
```
al-ummah-web          → Main website
videos                → API backend
al-ummah-now-processor → Event processing
al-ummah-now-comms    → Real-time features
```

**Safe to Delete (WITH VERIFICATION):**
```
*-pr-{number}         → If PR closed
*-staging             → If not needed
*-preview             → Dev/test only
```

**Verification Commands:**
```bash
gh pr view {number}              # Check PR status
wrangler deployments list        # List all workers
wrangler delete {worker-name}    # Delete worker
```

### Additional Resources

- **Workers Inventory:** `.cloudflare/WORKERS_INVENTORY.md`
- **Wrangler Docs:** https://developers.cloudflare.com/workers/wrangler/
- **Cloudflare Dashboard:** https://dash.cloudflare.com/
- **GitHub Actions:** `.github/workflows/deploy.yml`
- **Incident Response:** This document, "Emergency Procedures" section

---

## 📝 Deletion Log

**Record all manual deletions here:**

| Date | Worker Name | Reason | Deleted By | Verified Safe | Notes |
|------|-------------|--------|------------|---------------|-------|
| 2025-10-12 | (example) al-ummah-api-pr-42 | PR #42 closed | Claude | YES | Automated cleanup |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

---

**Last Updated:** 2025-10-12
**Next Review:** After any production incident
**Maintainers:** @meywd, DevOps team, Claude Code agents

**🚨 Remember: When in doubt, DON'T DELETE. Ask first. 🚨**
