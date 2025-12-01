# QA Environment Plan

## Overview

Create a dedicated QA environment for all apps, isolated from production, using QA auth at `auth.qa.alummahnow.net`.

## Current State

| Environment | Trigger | Auth URL | Data |
|-------------|---------|----------|------|
| Preview | PR + label | production | preview buckets |
| Production | main branch | auth.alummahnow.net | production buckets |

## Target State

| Environment | Trigger | Auth URL | Data |
|-------------|---------|----------|------|
| Preview | PR + label | QA auth | preview buckets |
| **QA** | **develop branch** | **auth.qa.alummahnow.net** | **QA buckets** |
| Production | main branch | auth.alummahnow.net | production buckets |

## Apps to Configure

1. **web** - Next.js frontend → `qa.alummahnow.net`
2. **api-videos** - API backend → `videos.qa.api.alummahnow.net`
3. **processor** - Queue consumer → `processor-qa`
4. **websocket-server** - WebSocket → `ws.qa.alummahnow.net`
5. **admin-api** - Admin API → `admin.qa.api.alummahnow.net`
6. **admin-web** - Admin dashboard → `admin.qa.alummahnow.net`

## Implementation Steps

### Phase 1: Wrangler QA Configs

Create `wrangler.qa.jsonc` for each app:

#### 1.1 apps/web/wrangler.qa.jsonc
```jsonc
{
  "name": "al-ummah-web-qa",
  "vars": {
    "NEXTJS_ENV": "qa",
    "Issuer": "https://auth.qa.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.qa.alummahnow.net",
    "API_URL": "https://videos.qa.api.alummahnow.net"
  },
  "r2_buckets": [
    { "binding": "videos", "bucket_name": "videos-qa" }
  ]
}
```

#### 1.2 apps/api-videos/wrangler.qa.jsonc
```jsonc
{
  "name": "videos-qa",
  "vars": {
    "Issuer": "https://auth.qa.alummahnow.net",
    "Audience": "https://videos.qa.alummahnow.net"
  },
  "r2_buckets": [
    { "binding": "videos", "bucket_name": "videos-qa" },
    { "binding": "profiles", "bucket_name": "profiles-qa" },
    { "binding": "channels", "bucket_name": "channels-qa" },
    // ... all buckets with -qa suffix
  ],
  "kv_namespaces": [
    { "binding": "AUTH_STORAGE", "id": "<qa-kv-id>" },
    { "binding": "RATE_LIMIT_KV", "id": "<qa-rate-limit-id>" },
    { "binding": "TUS_SESSIONS", "id": "<qa-tus-id>" }
  ]
}
```

#### 1.3 Similar configs for:
- apps/processor/wrangler.qa.jsonc
- apps/websocket-server/wrangler.qa.jsonc
- apps/admin-api/wrangler.qa.jsonc
- apps/admin-web/wrangler.qa.jsonc

### Phase 2: Cloudflare Resources

Create in Cloudflare Dashboard:

#### 2.1 R2 Buckets (QA)
- videos-qa
- profiles-qa
- channels-qa
- playlists-qa
- reports-qa
- watch-history-qa
- channel-sections-qa
- community-posts-qa
- channel-tabs-qa
- upload-defaults-qa
- subtitles-qa
- scheduled-videos-qa
- global-settings-qa

#### 2.2 KV Namespaces (QA)
- AUTH_STORAGE_QA
- RATE_LIMIT_KV_QA
- TUS_SESSIONS_QA
- al-ummah-now-analytics-kv-qa

#### 2.3 Queue (QA)
- al-ummah-now-videos-qa

#### 2.4 Custom Domains
- qa.alummahnow.net → al-ummah-web-qa
- videos.qa.api.alummahnow.net → videos-qa
- ws.qa.alummahnow.net → al-ummah-comms-qa
- admin.qa.alummahnow.net → al-ummah-admin-web-qa
- admin.qa.api.alummahnow.net → al-ummah-admin-api-qa

### Phase 3: GitHub Workflow

Add QA deployment to `.github/workflows/deploy.yml`:

```yaml
# Deploy QA Environment (develop branch)
deploy-qa:
  needs: [build-web, build-admin-web, validate-api, validate-processor, validate-websocket, validate-admin-api]
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/develop'
  environment: qa
  steps:
    - uses: actions/checkout@v4
    # ... setup steps ...

    - name: Deploy Web to QA
      run: |
        cd apps/web
        pnpm wrangler deploy --config wrangler.qa.jsonc
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

    - name: Deploy API to QA
      run: |
        cd apps/api-videos
        pnpm wrangler deploy --config wrangler.qa.jsonc
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

    # ... repeat for all apps ...
```

### Phase 4: E2E Tests Integration

Update `.github/workflows/e2e-tests.yml`:

```yaml
env:
  OPENAUTH_URL: https://auth.qa.alummahnow.net
  WEB_APP_URL: http://localhost:3001  # Local for CI
  # For running against deployed QA:
  # WEB_APP_URL: https://qa.alummahnow.net
```

## File Changes Summary

| File | Action |
|------|--------|
| apps/web/wrangler.qa.jsonc | Create |
| apps/api-videos/wrangler.qa.jsonc | Create |
| apps/processor/wrangler.qa.jsonc | Create |
| apps/websocket-server/wrangler.qa.jsonc | Create |
| apps/admin-api/wrangler.qa.jsonc | Create |
| apps/admin-web/wrangler.qa.jsonc | Create |
| .github/workflows/deploy.yml | Add QA jobs |
| .github/workflows/e2e-tests.yml | Already updated |

## Dependencies

1. Cloudflare R2 buckets must be created first
2. Cloudflare KV namespaces must be created with IDs
3. DNS records for *.qa.alummahnow.net
4. QA auth server running at auth.qa.alummahnow.net

## Rollout Plan

1. Create Cloudflare resources (buckets, KV, domains)
2. Create wrangler.qa.jsonc configs
3. Test manual deployment: `pnpm wrangler deploy --config wrangler.qa.jsonc`
4. Add deploy-qa job to workflow
5. Create `develop` branch
6. Test full CI/CD flow
7. Update E2E tests to run against QA

## Questions

1. Should QA share Bunny.net CDN with production or have separate zone?
2. Should QA data be seeded or start empty?
3. Should develop branch auto-deploy or require approval?
