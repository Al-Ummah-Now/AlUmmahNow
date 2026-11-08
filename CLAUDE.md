# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this monorepo.

## Project Overview

**Al Ummah Now** is an Islamic content platform monorepo with 8 applications across `apps/` and 3 shared packages in `packages/`.

**Applications (8):**
1. **web** - Next.js 16 user-facing frontend with bilingual support (English/Arabic, RTL)
2. **api-videos** - Hono API backend with OpenAPI 3.1 (chanfana)
3. **processor** - Queue consumer for message processing and analytics
4. **websocket-server** - Real-time WebSocket server with Durable Objects
5. **admin-api** - Hono admin API backend (content moderation, D1 database)
6. **admin-web** - Next.js 16 admin frontend (OpenNext on Cloudflare Workers)
7. **scheduler** - Cron worker for automated scheduled video publishing (not in CI)
8. **log-service** - Local-development-only HTTP log aggregator (not deployed)

**Packages (3):**
- `@al-ummah/shared-types` - Shared TypeScript types used by all apps
- `@al-ummah/logger` - Shared logging utility (console + file output)
- `@al-ummah/mcp-log-server` - MCP server for watching logs via AI tools

**Repository**: https://github.com/meywd/AlUmmahNow

## Development Process

**CRITICAL**: Before writing ANY code, read and follow the development process in `BEFORE_YOU_CODE.md`.

This file contains the mandatory 10-step development workflow that MUST be followed for all development work:

1. **LOG EVERYTHING** - Comprehensive logging with structured prefixes
2. **TDD (Test-Driven Development)** - Write tests before implementation
3. **BUILD** - Catch TypeScript errors early
4. **RUN TESTS** - Ensure nothing is broken
5. **DEBUG ISSUES SYSTEMATICALLY** - Check logs, add more if needed, fix until all tests pass
6. **RESEARCH** - Search codebase before writing new code
7. **CHECK CODEBASE & DOCUMENTATION** - Prefer editing over creating
8. **PULL, COMMIT, PUSH** - Proper git workflow with conventional commits
9. **REVIEW CODE** - Self-review before opening PRs
10. **OPEN PRs** - With proper descriptions and all checks passing

**See `BEFORE_YOU_CODE.md` for complete details, checklists, and code examples.**

## Code Quality Standards

### TODO Comments Policy

**PROHIBITED**: Never add TODO comments to code. Either implement it immediately or don't do it.

**Rationale**: TODO comments accumulate technical debt, become stale, and are often forgotten. They create ambiguity about whether functionality is complete.

**Instead of TODO comments**:
1. ✅ **Implement it now** - If it's needed, do it immediately
2. ✅ **Create a GitHub issue** - For future work that's out of scope
3. ✅ **Document design decisions** - Use clear comments explaining "why", not "what's missing"
4. ✅ **Use feature flags** - For incomplete features that need to ship

**Examples**:

❌ **WRONG - Never do this:**
```typescript
// TODO: Add input validation
function processData(data: any) {
  return data;
}

// TODO: Implement caching
function fetchData() {
  return fetch('/api/data');
}
```

✅ **CORRECT - Do this instead:**
```typescript
// Option 1: Implement it now
function processData(data: DataType) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data');
  }
  return data;
}

// Option 2: Create an issue and document the decision
// Note: Caching will be implemented in Phase 2 (see issue #123)
// Current implementation prioritizes correctness over performance
function fetchData() {
  return fetch('/api/data');
}

// Option 3: Use a feature flag for incomplete work
function fetchData() {
  if (FEATURE_FLAGS.enableCaching) {
    return getCachedData();
  }
  return fetch('/api/data');
}
```

**Enforcement**: Code reviews will reject PRs containing TODO comments.

### Logging Standards

**CRITICAL**: Use ONLY the centralized logger libraries. NEVER use `console.log`, `console.error`, or other console methods.

**Rationale**: Centralized logging provides structured log aggregation, filtering, and viewing through the log service. Console logging bypasses this system and creates maintenance issues.

#### Server-Side Logging (API, Processor, WebSocket)

Use the server logger library for all backend applications:

```typescript
import { logger } from '@/lib/logger'; // or appropriate path

// Structured logging with context
logger.info('Video created', { videoId, userId, channelId });
logger.error('Failed to process queue message', { error, messageId });
logger.warn('Rate limit approaching', { userId, requestCount });
logger.debug('Cache hit', { key, ttl });
```

#### Client-Side Logging (Web App)

Use the client logger library for all frontend code:

```typescript
import { logger } from '@/lib/logger-client'; // or appropriate path

// Client-side structured logging
logger.info('Page viewed', { route, userId });
logger.error('API request failed', { endpoint, status, error });
logger.warn('Slow network detected', { latency });
```

#### Viewing Logs

**Log Service** runs at http://localhost:3089/ and provides centralized log aggregation from all apps.

**Real-Time Log Streaming (SSE)**:
```bash
# Stream all logs in real-time
curl -N http://localhost:3089/logs/stream/realtime

# Filter by log level
curl -N "http://localhost:3089/logs/stream/realtime?level=error"

# Filter by app
curl -N "http://localhost:3089/logs/stream/realtime?app=api-videos"

# Combine filters
curl -N "http://localhost:3089/logs/stream/realtime?level=error&app=api-videos"
```

**Web Viewer** (recommended for visual monitoring):
- URL: http://localhost:3089/viewer/viewer.html
- Features: Real-time updates, color-coded levels, auto-scroll, filtering
- Dark theme optimized for terminal aesthetics

**Snapshot API** (for one-time queries):
```bash
# Get last 100 lines (all apps combined)
curl "http://localhost:3089/logs/stream?lines=100&tail=true" | jq

# Get last 50 ERROR logs
curl "http://localhost:3089/logs/stream?lines=50&level=error&tail=true" | jq

# Get logs from specific app
curl "http://localhost:3089/logs/api-videos?lines=200" | jq
```

**Available Filters**:
- `level`: debug, info, warn, error
- `app`: web, api-videos, processor, websocket, log-service
- `lines`: number of lines to return (default: 100)
- `tail`: true (newest first) or false (oldest first)

**API Documentation**: http://localhost:3089/ (Swagger UI)

#### Enforcement

❌ **WRONG - Never do this:**
```typescript
console.log('User logged in');
console.error('Something went wrong', error);
console.warn('Deprecated feature used');
```

✅ **CORRECT - Always do this:**
```typescript
logger.info('User logged in', { userId, timestamp });
logger.error('Authentication failed', { error, userId, attempt });
logger.warn('Deprecated API endpoint accessed', { endpoint, userId });
```

### Internationalization (i18n) Standards

**CRITICAL**: Always use i18n for all user-facing text. NEVER hardcode strings.

**Rationale**: The platform supports bilingual content (English/Arabic) with RTL support. All text must be translatable.

#### Server-Side i18n (API Responses)

Use i18n for API error messages and user-facing responses:

```typescript
import { t } from '@/lib/i18n';

// Error messages
return c.json({
  success: false,
  error: t('errors.video_not_found'),
  details: t('errors.video_not_found_description', { videoId })
});

// Success messages
return c.json({
  success: true,
  message: t('success.video_created')
});
```

#### Client-Side i18n (React Components)

**MANDATORY**: Use the `useLanguage()` hook in ALL client pages and components:

```typescript
import { useLanguage } from '@/hooks/useLanguage';

export default function VideoPage() {
  const { t, locale, isRTL } = useLanguage();

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <h1>{t('video.title')}</h1>
      <p>{t('video.description')}</p>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

#### Translation Keys

Organize translation keys by feature:

```typescript
// en/common.json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete"
  },
  "video": {
    "title": "Video Title",
    "description": "Description",
    "upload": "Upload Video"
  },
  "errors": {
    "video_not_found": "Video not found",
    "unauthorized": "You are not authorized"
  }
}

// ar/common.json
{
  "common": {
    "save": "حفظ",
    "cancel": "إلغاء",
    "delete": "حذف"
  },
  "video": {
    "title": "عنوان الفيديو",
    "description": "الوصف",
    "upload": "رفع فيديو"
  },
  "errors": {
    "video_not_found": "الفيديو غير موجود",
    "unauthorized": "غير مصرح لك"
  }
}
```

#### Enforcement

❌ **WRONG - Never do this:**
```typescript
// Hardcoded strings
<h1>Featured Videos</h1>
<button>Save</button>
return c.json({ error: 'Video not found' });
```

✅ **CORRECT - Always do this:**
```typescript
// Using i18n
const { t } = useLanguage();
<h1>{t('video.featured_videos')}</h1>
<button>{t('common.save')}</button>
return c.json({ error: t('errors.video_not_found') });
```

#### Special Cases

**Dynamic content with placeholders:**
```typescript
// English: "Video {title} was created by {author}"
// Arabic: "تم إنشاء الفيديو {title} بواسطة {author}"
t('video.created_by', { title: video.title, author: video.author })
```

**RTL-aware styling:**
```typescript
const { isRTL } = useLanguage();

// Adjust layout for RTL
<div className={isRTL ? 'flex-row-reverse' : 'flex-row'}>
  {/* Content */}
</div>
```

**Date and number formatting:**
```typescript
import { formatDate, formatNumber } from '@/lib/i18n-helpers';

const formattedDate = formatDate(date, locale); // Locale-aware formatting
const formattedCount = formatNumber(count, locale); // e.g., "١٢٣" in Arabic
```

## Monorepo Structure

```
al-ummah-now/
├── apps/
│   ├── web/              Next.js 16 user-facing frontend (Cloudflare Workers + OpenNext)
│   ├── api-videos/       Hono video API backend (Cloudflare Workers + R2)
│   ├── admin-api/        Hono admin API backend (Cloudflare Workers + D1 + R2)
│   ├── admin-web/        Next.js 16 admin frontend (Cloudflare Workers + OpenNext)
│   ├── processor/        Queue consumer (Cloudflare Workers + R2)
│   ├── websocket-server/ WebSocket server (Cloudflare Durable Objects + KV)
│   ├── scheduler/        Cron worker for scheduled video publishing (Cloudflare Workers)
│   └── log-service/      Local-dev HTTP log aggregator (NOT deployed)
├── packages/
│   ├── shared-types/     Shared TypeScript types (@al-ummah/shared-types)
│   ├── logger/           Shared logging utility (@al-ummah/logger)
│   └── mcp-log-server/   MCP server for log watching (@al-ummah/mcp-log-server)
├── package.json          Root workspace config
├── pnpm-workspace.yaml   pnpm workspaces
├── turbo.json            Turborepo orchestration
└── tsconfig.json         Root TypeScript project references
```

## Essential Commands

**Important**: This is a **pnpm monorepo**. Always use `pnpm` instead of `npm`.

### Setup
```bash
pnpm install                              # Install all dependencies (1-2 min)
pnpm --filter @al-ummah/shared-types build # Build shared types (required first)
pnpm --filter @al-ummah/logger build      # Build shared logger (required first)
```

### Development
```bash
pnpm dev                 # Run all apps in parallel
pnpm web:dev             # Web app: http://localhost:3001
pnpm api:dev             # API: http://127.0.0.1:3086
pnpm processor:dev       # Processor: http://localhost:3088
pnpm websocket:dev       # WebSocket server: http://localhost:3087
pnpm admin:dev           # Admin API: http://127.0.0.1:3090
pnpm admin-web:dev       # Admin web: http://localhost:3091
pnpm log-service:dev     # Log service: http://localhost:3089 (local dev only)
```

### Build & Validation
```bash
pnpm build               # Build all packages
pnpm type-check          # Type check all packages
pnpm lint                # Lint all packages
```

### Deployment
```bash
pnpm web:deploy:production      # Deploy web to production
pnpm api:deploy                 # Deploy API to production
pnpm processor:deploy           # Deploy processor to production
pnpm websocket:deploy           # Deploy WebSocket server to production
pnpm admin:deploy               # Deploy admin API to production
pnpm admin:deploy:qa            # Deploy admin API to QA
pnpm admin-web:deploy:qa        # Deploy admin web to QA
pnpm admin-web:deploy:production # Deploy admin web to production
pnpm deploy:all                 # Deploy all 6 CI-managed apps to production
pnpm deploy:qa                  # Deploy all 6 CI-managed apps to QA
```

### Per-App Commands
```bash
# Build specific app
pnpm --filter @al-ummah/web build
pnpm --filter @al-ummah/api-videos type-check
pnpm --filter @al-ummah/processor test

# Run app-specific scripts
cd apps/web && pnpm dev
cd apps/api-videos && pnpm wrangler deploy --dry-run
cd apps/processor && pnpm lint:fix
```

## Architecture Overview

### Technology Stack

| Component | Technology |
|-----------|-----------|
| **User Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS |
| **Admin Frontend** | Next.js 16 (App Router), React 19, TanStack Query |
| **API Backends** | Hono v4, chanfana (OpenAPI 3.1), Zod validation |
| **Processor** | TypeScript, Cloudflare Queue Consumer |
| **WebSocket Server** | Cloudflare Durable Objects, WebSocket API |
| **Scheduler** | TypeScript, Cloudflare Cron Triggers |
| **Authentication** | OpenAuth (JWT/OAuth2) via auth.alummahnow.net |
| **Storage** | Cloudflare R2 (object storage), D1 (admin DB), KV (key-value) |
| **CDN** | Bunny.net (video streaming + image storage) |
| **Deployment** | Cloudflare Workers (6 apps; scheduler + log-service excluded from CI) |
| **Package Manager** | pnpm v9.15.4 with workspaces |
| **Build System** | Turborepo v2 with caching |

### App Responsibilities

**apps/web** - User-facing frontend
- Next.js 15 with App Router deployed via @opennextjs/cloudflare
- Bilingual routes: `/en/*` (LTR) and `/ar/*` (RTL)
- OpenAuth authentication with JWT tokens
- Video.js player with quality selection
- Responsive design with dark/light themes
- See: `apps/web/README.md` or `.github/CLAUDE.md`

**apps/api-videos** - Video platform API
- Hono web framework with chanfana for OpenAPI integration
- R2 object storage (no traditional database) via repository pattern
- Bunny.net integration for video streaming and image storage
- JWT authentication middleware (OpenAuth)
- Interactive Swagger UI at root URL
- See: `apps/api-videos/CLAUDE.md`

**apps/processor** - Event queue processor
- Consumes messages from Cloudflare Queue `al-ummah-now-videos`
- Processes video views, likes, comments, subscriptions, channel/playlist events, watch history
- Saves all messages to R2 bucket `al-ummah-now-messages` as JSON
- Tracks watch history and progress in R2 buckets (`watch-history`, `watch-history-preview`)
- Retry logic (max 3 retries) + dead letter queue support
- Health checks and monitoring endpoints
- See: `apps/processor/README.md`

**apps/websocket-server** - Real-time communication server
- WebSocket server built on Cloudflare Durable Objects
- JWT authentication with OpenAuth integration
- Channel subscriptions (user, video, channel, live streams)
- Presence tracking via Cloudflare KV
- Rate limiting (100 messages/minute per connection)
- Message broadcasting and real-time notifications
- See: `apps/websocket-server/README.md`

**apps/admin-api** - Admin API backend
- Hono v4 + chanfana (OpenAPI 3.1) admin-only REST API; dev port 3090
- D1 database (`al-ummah-now-reports`) for moderation reports
- R2 read/write access to videos, channels, profiles, playlists for moderation
- JWT authentication + admin role middleware (OpenAuth)
- Config: `wrangler.jsonc` (production), `wrangler.qa.jsonc` (QA)
- See: `apps/admin-api/README.md`

**apps/admin-web** - Admin web frontend
- Next.js 16 + @opennextjs/cloudflare admin dashboard; dev port 3091
- TanStack Query for server-state management; Tailwind CSS v4
- Connects to admin-api (`http://127.0.0.1:3090` locally)
- Config: `wrangler.jsonc` (default), `wrangler.qa.jsonc` (QA), `wrangler.production.jsonc` (production)
- See: `apps/admin-web/README.md`

**apps/scheduler** - Scheduled video publishing worker
- Cloudflare Worker with cron trigger (every minute) to auto-publish scheduled videos
- Reads scheduling metadata from R2 (`SCHEDULED_VIDEOS`), updates video status in `VIDEOS`
- Distributed locking via KV (`SCHEDULER_LOCKS`), metrics in KV (`SCHEDULER_METRICS`)
- Retry logic (exponential backoff, up to 4 attempts); queue-based event logging
- NOT included in CI/CD pipeline — deploy manually via `cd apps/scheduler && pnpm deploy`
- See: `apps/scheduler/README.md`

**apps/log-service** - Local development log aggregator
- Node.js HTTP server (Hono + @hono/node-server) that receives structured logs from all apps
- Writes logs to per-app files; exposes SSE streaming and snapshot query endpoints
- Swagger UI at http://localhost:3089/; web viewer at http://localhost:3089/viewer/viewer.html
- **Local development only — NOT deployed to any environment (no wrangler config)**
- See: `apps/log-service/README.md`

**packages/shared-types** - Shared TypeScript types
- Video, Channel, Playlist, User, Comment, Analytics types
- Used by all apps via workspace protocol: `@al-ummah/shared-types`
- Must be built before other apps: `pnpm --filter @al-ummah/shared-types build`

**packages/logger** - Shared logging utility
- `@al-ummah/logger` — structured logging with console + HTTP transport to log-service
- Used by all apps (api-videos, admin-api, admin-web, scheduler, websocket-server, processor)
- Must be built before other apps: `pnpm --filter @al-ummah/logger build`

**packages/mcp-log-server** - MCP log server
- `@al-ummah/mcp-log-server` — MCP server that exposes log-watching tools to AI agents
- Provides `get_logs`, `list_log_apps`, `search_logs`, `watch_logs` MCP tools
- Used via Claude Code's MCP integration; not imported by application code

## CI/CD Pipeline

### GitHub Actions Workflow (`.github/workflows/deploy.yml`)

**Trigger**: Push to `main`, or pull requests into `main` or `integrate/**`

**Pipeline Stages**:

1. **test** - Type check + lint + tests (all packages). A failing test fails the PR.
   **release-checks** - Release gates, see below (runs in parallel with `test`).
2. **build-shared-packages** - Build `@al-ummah/shared-types` + `@al-ummah/logger` (2 min)
3. **Build & Validate** - 6 parallel jobs (all depend on build-shared-packages):
   - `build-web`: Build Next.js user app (up to 120 min)
   - `validate-api`: Type check + dry-run deployment
   - `validate-processor`: Type check + run tests
   - `validate-websocket`: Type check + dry-run deployment
   - `validate-admin-api`: Type check + dry-run deployment
   - `build-admin-web`: Build Next.js admin app

Note: **scheduler** and **log-service** have no CI validation or deployment jobs.

**Pull Request Previews** (opt-in only):
- **Disabled by default** - preview deployments only run when requested
- **To deploy previews**: Add `deploy-preview` label to your PR
- **Workers deployed** (when label is present) — all 6 CI-managed apps:
  - **Web**: preview worker on workers.dev
  - **API**: preview worker on workers.dev (with Swagger UI)
  - **Processor**: preview worker (development env)
  - **WebSocket**: preview worker on workers.dev
  - **Admin API**: preview worker on workers.dev
  - **Admin Web**: preview worker on workers.dev
- Each app posts separate PR comment with deployment info
- Auto-cleanup when PR closes
- **Rationale**: Reduces unnecessary deployments, saves Cloudflare Workers quota

**QA Deployment** (`deploy-qa` job): no longer triggered; it ran on pushes to `develop`, which CI no longer builds. QA deploys move to the release pipeline (`docs/release-pipeline/`).
- All 6 apps deployed in a single `deploy-qa` job after validation
- QA URLs: `qa.alummahnow.net`, `videos.qa.api.alummahnow.net`, `ws.qa.alummahnow.net`, `admin.qa.alummahnow.net`, `admin.qa.api.alummahnow.net`
- Web and admin-web use `wrangler.qa.jsonc`; others use per-app `wrangler.qa.jsonc`

**Production Deployment** (`main` branch):
- All 6 apps deployed in a single `deploy-production` job after validation
- Web uses `wrangler.production.jsonc`; admin-web uses `wrangler.production.jsonc`; other apps use default wrangler config

**Required Secrets**:
- `CLOUDFLARE_API_TOKEN` - For all deployments

### Release gates

Required checks on every PR (`deploy.yml` jobs `test` and `release-checks`). Scripts live in `scripts/release/` and run with plain Node 22 (no install needed):

| Command | Fails when | How to fix |
|---|---|---|
| `pnpm test` | any unit test fails | Fix the test or code. Known-broken tests are quarantined with `.skip` and a `// Quarantined: ... #<issue>` comment (web: #206, log-service: #207); never add `continue-on-error`. |
| `pnpm check:config` | a production wrangler config (`apps/web` and `apps/admin-web`: `wrangler.production.jsonc`; other workers: `wrangler.jsonc`) has the wrong worker name or vars (e.g. web `OPENAUTH_ISSUER` must be `https://auth.alummahnow.net`), loses a required binding, contains localhost, a QA/stage host, a placeholder id or a test-only name; or a workflow / package script runs `wrangler deploy` for web or admin-web without `--config` (their top-level `wrangler.jsonc` is the dev config) | Fix the config or add `--config wrangler.<env>.jsonc`. If a production value changes on purpose, update `scripts/release/apps.ts` in the same PR. A known problem that can't be fixed yet goes in that app's `accepted` list with its issue; the check fails once it is fixed, so the entry gets removed. |
| `pnpm check:migrations <base-sha>` | a file under `apps/*/migrations*/` (any depth) that exists on the base branch was modified, renamed or deleted, or a new migration sorts before the latest one in its dir | Never edit an applied migration; add a new, higher-numbered one. |
| `pnpm check:schema` | a D1 migrations dir has no snapshot, or its snapshot (`<dir>.schema.snapshot.sql`, next to the dir) no longer matches the schema the migrations produce | Run `pnpm schema:snapshot` and commit the snapshot with the migration. Never edit a snapshot by hand. |
| `pnpm test:scripts` | the release scripts' own tests fail | Fix the script or its test in `scripts/release/__tests__/`. |

## Development Workflow

### Working with the Monorepo

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build shared packages** (required before other apps):
   ```bash
   pnpm --filter @al-ummah/shared-types build
   pnpm --filter @al-ummah/logger build
   ```

3. **Start development**:
   ```bash
   # All apps
   pnpm dev

   # Or individual apps
   pnpm web:dev
   pnpm api:dev
   pnpm processor:dev
   ```

4. **Make changes**:
   - Edit files in respective app directories
   - Shared types go in `packages/shared-types/src/`
   - Hot reload enabled for all apps

5. **Validate changes**:
   ```bash
   pnpm type-check        # Type check all packages
   pnpm lint              # Lint all packages
   pnpm --filter @al-ummah/web build  # Test web build
   ```

6. **Commit and Push**:
   ```bash
   git add .
   git commit -m "feat(web): add video upload feature"
   git push
   ```

### GitHub Issues Workflow

**CRITICAL RULES FOR CLOSING ISSUES:**

1. **NEVER close an issue until ALL of the following are complete**:
   - ✅ All code is committed to git
   - ✅ All commits are pushed to GitHub
   - ✅ Code is merged to the target branch (main or feature branch)
   - ✅ All acceptance criteria in the issue are met
   - ✅ All tests pass (if applicable)

2. **Code in git stash does NOT count as complete**:
   - Stashed code is NOT committed
   - Stashed code is NOT pushed
   - Stashed code can be lost
   - **Never close issues for stashed work**

3. **Verification before closing**:
   ```bash
   # Always verify before closing an issue:
   git status                    # Should be clean (nothing uncommitted)
   git log --oneline -5          # Verify commits exist
   git push --dry-run            # Verify everything is pushed
   gh issue view <number>        # Review acceptance criteria
   ```

4. **When to close an issue**:
   - ✅ Run `git status` - should show "nothing to commit, working tree clean"
   - ✅ Run `git log` - verify your commits are there
   - ✅ Run `git push --dry-run` - should say "Everything up-to-date"
   - ✅ All acceptance criteria checked off
   - ✅ Only then: `gh issue close <number>`

5. **If work is incomplete**:
   - Add a comment explaining what's done and what remains
   - Update issue labels (e.g., add "in-progress" or "blocked")
   - Do NOT close the issue
   - Do NOT mark as completed

**Example of INCORRECT workflow** (DO NOT DO THIS):
```bash
# ❌ WRONG - Code is only in stash
git stash push -m "Work on issue #45"
gh issue close 45 --comment "Completed"  # WRONG!
```

**Example of CORRECT workflow**:
```bash
# ✅ CORRECT - Code is committed and pushed
git add .
git commit -m "feat: implement feature from issue #45"
git push
# Verify everything is pushed
git status  # Should be clean
git log --oneline -1  # Should show your commit
# Now it's safe to close
gh issue close 45 --comment "Completed and pushed in commit abc123"
```

### Working with Stashes

**IMPORTANT**: Git stash is for **temporary** storage only, NOT for completed work.

- ✅ Use stash to: Switch branches temporarily, save work in progress
- ❌ Never use stash for: Completed features, finished issues, long-term storage
- ❌ Never close issues for stashed work

**If you have stashed work**:
1. Apply the stash: `git stash pop`
2. Review and test the changes
3. Commit the changes: `git add . && git commit -m "..."`
4. Push the changes: `git push`
5. Only then close the related issue

### Adding Dependencies

**Workspace package** (shared types):
```bash
pnpm --filter @al-ummah/web add @al-ummah/shared-types
# Already configured for all apps
```

**App-specific package**:
```bash
pnpm --filter @al-ummah/web add next@latest
pnpm --filter @al-ummah/api-videos add hono
pnpm --filter @al-ummah/processor add -D jest
```

**Root devDependencies**:
```bash
pnpm add -D -w turbo
```

### TypeScript Configuration

**Root**: `tsconfig.json` with project references to all apps
**Base**: `tsconfig.base.json` with shared compiler options
**Each app**: Extends base and adds app-specific config

**Restart VS Code TypeScript server** after config changes:
- `Ctrl+Shift+P` → "TypeScript: Restart TS Server"

## App-Specific Documentation

Each app has its own detailed documentation:

### Web App (`apps/web/`)
- **Overview**: See root `.github/CLAUDE.md` (legacy, mostly accurate)
- **Authentication**: OpenAuth with JWT tokens in `src/lib/actions.ts`
- **API Clients**: OpenAPI clients in `src/lib/api/`
- **Components**: Dual LTR/RTL implementations in `src/components/`
- **Routes**: `/en/*` (English/LTR) and `/ar/*` (Arabic/RTL)
- **Config**: `wrangler.{preview,staging,production}.jsonc`

### API Videos (`apps/api-videos/`)
- **Complete Guide**: `apps/api-videos/CLAUDE.md`
- **Architecture**: Hono + chanfana, R2 repository pattern
- **Auth Guide**: `apps/api-videos/AUTHENTICATION.md` (API user guide)
- **Developer Guide**: `apps/api-videos/DEVELOPER_AUTH_GUIDE.md`
- **Technical Docs**: `apps/api-videos/TECHNICAL_DOCUMENTATION.md`
- **Roadmap**: `apps/api-videos/ROADMAP.md`

### Processor (`apps/processor/`)
- **Overview**: `apps/processor/README.md`
- **Message Types**: 13+ types (Video, Profile, Channel, Playlist, Comment, Subscription, Watch History)
- **Config**: `apps/processor/wrangler.toml` with multi-environment support
- **Testing**: Jest tests in `src/__tests__/`
- **R2 Buckets**: `watch-history` (production), `watch-history-preview` (preview/dev)

### WebSocket Server (`apps/websocket-server/`)
- **Overview**: `apps/websocket-server/README.md`
- **Architecture**: Cloudflare Durable Objects + WebSocket API
- **Authentication**: JWT with OpenAuth
- **Features**: Channel subscriptions, presence tracking, rate limiting, broadcasting
- **KV Namespaces**: `al-ummah-now-analytics-kv` (presence state)
- **Deployment**: `wss://ws.alummahnow.net` (production)

### Admin API (`apps/admin-api/`)
- **Overview**: `apps/admin-api/README.md`
- **Architecture**: Hono + chanfana, D1 database for reports, R2 for content moderation
- **Dev port**: 3090 (`http://127.0.0.1:3090`)
- **Config**: `wrangler.jsonc` (production), `wrangler.qa.jsonc` (QA)

### Admin Web (`apps/admin-web/`)
- **Overview**: `apps/admin-web/README.md`
- **Architecture**: Next.js 16 + OpenNext on Cloudflare Workers
- **Dev port**: 3091 (`http://localhost:3091`)
- **Config**: `wrangler.jsonc`, `wrangler.qa.jsonc`, `wrangler.production.jsonc`

### Scheduler (`apps/scheduler/`)
- **Overview**: `apps/scheduler/README.md`
- **Architecture**: Cloudflare Worker with cron trigger (every minute)
- **Config**: `wrangler.jsonc` (production), `--env staging` for staging
- **Note**: Not in CI/CD — deploy manually

### Log Service (`apps/log-service/`)
- **Overview**: `apps/log-service/README.md`
- **Architecture**: Hono + @hono/node-server (plain Node.js, not a Worker)
- **Dev port**: 3089 (`http://localhost:3089`)
- **Note**: Local development only, never deployed

## Common Tasks

### Adding a New Shared Type

1. Edit `packages/shared-types/src/video.ts` (or relevant file)
2. Export from `packages/shared-types/src/index.ts`
3. Rebuild: `pnpm --filter @al-ummah/shared-types build`
4. Use in apps: `import { VideoObject } from '@al-ummah/shared-types'`

Note: If modifying `packages/logger`, rebuild it too: `pnpm --filter @al-ummah/logger build`

### Adding a New API Endpoint

1. Create endpoint in `apps/api-videos/src/endpoints/{category}/`
2. Register in `apps/api-videos/src/index.ts`
3. Add authentication middleware if needed
4. Use `addAuthToSchema()` helper for OpenAPI docs
5. Test with Swagger UI at http://127.0.0.1:3086/

### Adding a New Page (Bilingual)

1. Create page in `apps/web/src/app/en/{route}/page.tsx`
2. Create Arabic version in `apps/web/src/app/ar/{route}/page.tsx`
3. Create component in `apps/web/src/components/{name}/index.tsx` (LTR)
4. Create RTL variant in `apps/web/src/components/{name}/rtl/index.tsx`
5. Test both routes: http://localhost:3001/en/{route} and /ar/{route}

### Deploying to Production

```bash
# Deploy all 6 CI-managed apps to production in one command
pnpm deploy:all

# Or deploy individually
pnpm web:deploy:production
pnpm api:deploy
pnpm processor:deploy
pnpm websocket:deploy
pnpm admin:deploy
pnpm admin-web:deploy:production

# Or push to main branch → GitHub Actions handles all 6 apps automatically
git push origin main
```

## Troubleshooting

### "Cannot find module '@al-ummah/shared-types'" or "'@al-ummah/logger'"
```bash
# Rebuild shared packages
pnpm --filter @al-ummah/shared-types build
pnpm --filter @al-ummah/logger build

# Restart VS Code TypeScript server
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

### "npm: command not found" errors
This is a **pnpm monorepo**. Replace `npm` with `pnpm` in all commands.

### VS Code IntelliSense errors
```bash
# Reload VS Code window
# Ctrl+Shift+P → "Developer: Reload Window"
```

### Wrangler deployment fails
```bash
# Login to Cloudflare
pnpm wrangler login

# Validate deployment
cd apps/api-videos
pnpm wrangler deploy --dry-run
```

### Build fails with Google Fonts error (web app)
Network-restricted environments may block Google Fonts. See `.github/CLAUDE.md` for workarounds.

## Important Notes

1. **Always use pnpm**, never npm or yarn
2. **Build shared packages first** — `pnpm --filter @al-ummah/shared-types build && pnpm --filter @al-ummah/logger build`
3. **Restart VS Code** after TypeScript config changes
4. **Never cancel long builds** - web app can take up to 120 minutes
5. **Test bilingual support** - verify both `/en/*` and `/ar/*` routes
6. **API validation** - Use Swagger UI to test API endpoints
7. **Auth service is separate** - Not part of this monorepo

## Recommended Claude Code Agents

This repository uses both **custom agents** (defined in `.claude/agents/`) and **system agents** (built into Claude Code). Below are the recommended system agents for Al Ummah Now's tech stack.

### Custom Agents (`.claude/agents/`)

See `.claude/AGENTS_SUMMARY.md` for complete documentation of 11 custom agents:

**Architecture & Design:**
- `architect` - System architecture, ADRs, data models
- `api-designer` - RESTful API design, OpenAPI specs
- `ux-designer` - UX/UI design, WCAG accessibility

**Development:**
- `developer` - Code implementation, zero linting
- `ui-engineer` - Frontend (Next.js/React/Tailwind), bilingual RTL

**Quality & Testing:**
- `debugger` - Systematic bug investigation
- `quality-reviewer` - Critical issues review
- `test-engineer` - Test suite generation

**Security & Performance:**
- `security-auditor` - Security vulnerabilities, compliance
- `performance-optimizer` - Performance analysis, optimization

**Documentation:**
- `technical-writer` - Documentation creation, API docs

### Recommended System Agents ⭐

These system agents are optimized for Al Ummah Now's specific tech stack and should be used proactively:

#### Frontend Development
- **frontend-mobile-development:frontend-developer** ⭐
  - Next.js 15, React 19, Tailwind CSS
  - Bilingual support (EN/AR with RTL)
  - OpenNext on Cloudflare Workers
  - Use for: Component development, routing, state management

#### Backend Development
- **backend-development:backend-architect** ⭐
  - Hono API design, microservices patterns
  - Cloudflare Workers architecture
  - R2 storage patterns, repository design
  - Use for: API design, data modeling, architecture decisions

#### CI/CD & Deployment
- **full-stack-orchestration:deployment-engineer** ⭐
  - GitHub Actions workflows
  - Cloudflare Workers deployment (wrangler)
  - Multi-environment configuration
  - Use for: CI/CD pipeline, deployment automation, PR previews

#### Security
- **full-stack-orchestration:security-auditor** ⭐
  - JWT/OAuth2 authentication audits
  - OpenAuth integration security
  - OWASP Top 10 vulnerabilities
  - Use for: Security audits, authentication reviews, compliance

#### Performance
- **full-stack-orchestration:performance-engineer** ⭐
  - Cloudflare Workers optimization
  - R2 query performance
  - Video streaming optimization
  - Use for: Performance profiling, bottleneck identification

#### Documentation
- **documentation-generation:api-documenter** ⭐
  - OpenAPI 3.1 specifications
  - chanfana integration
  - Interactive Swagger UI
  - Use for: API documentation, endpoint specs

#### Testing
- **full-stack-orchestration:test-automator** ⭐
  - Jest test automation
  - E2E testing strategies
  - CI/CD test integration
  - Use for: Test automation, coverage improvement

#### Code Review
- **code-documentation:code-reviewer** ⭐
  - TypeScript best practices
  - Cloudflare Workers patterns
  - Security vulnerability detection
  - Use for: PR reviews, code quality assurance

#### Debugging
- **debugging-toolkit:debugger** ⭐
  - Complex debugging workflows
  - Cloudflare Workers debugging
  - R2/KV troubleshooting
  - Use for: Systematic bug investigation

#### Technical Documentation
- **documentation-generation:docs-architect** ⭐
  - System architecture documentation
  - Technical deep-dives
  - Migration guides
  - Use for: Architecture docs, technical specifications

### Usage Examples

```bash
# Frontend development
# Use system agent for component development
Task: "Build mobile-first video player controls with RTL support"
Agent: frontend-mobile-development:frontend-developer

# Backend API design
# Use system agent for endpoint architecture
Task: "Design RESTful API for video comments with pagination"
Agent: backend-development:backend-architect

# CI/CD improvements
# Use system agent for deployment optimization
Task: "Optimize GitHub Actions workflow for faster builds"
Agent: full-stack-orchestration:deployment-engineer

# Security audit
# Use system agent for authentication review
Task: "Audit JWT token validation in WebSocket server"
Agent: full-stack-orchestration:security-auditor

# API documentation
# Use system agent for OpenAPI specs
Task: "Generate OpenAPI documentation for video endpoints"
Agent: documentation-generation:api-documenter
```

### Agent Selection Guide

**Use Custom Agents when:**
- You need Al Ummah Now-specific context
- Working within established patterns
- Following project conventions
- Quick implementations with minimal setup

**Use System Agents when:**
- You need deep expertise in specific technologies
- Implementing complex features
- Performing specialized tasks (security audits, performance optimization)
- Working with cutting-edge frameworks (Next.js 15, React 19)

**Best Practice:** Combine both! Use custom agents for project-specific tasks and system agents for specialized deep work.

## Additional Resources

- **Root README**: `README.md` - Quick start and overview
- **Architecture**: `docs/ARCHITECTURE.md` (if exists)
- **Contributing**: `CONTRIBUTING.md` - Development guidelines
- **Roadmap**: `docs/ROADMAP.md` - Development roadmap
- **GitHub Issues**: Use templates in `.github/ISSUE_TEMPLATE/`
- **Project Board**: https://github.com/users/meywd/projects/1

## Legacy Documentation

The following files contain legacy information from pre-monorepo structure:
- `.github/CLAUDE.md` - Original web app guidance (mostly accurate)
- `.github/copilot-instructions.md` - GitHub Copilot specific
- `MONOREPO_*.md` - Migration documentation (historical)

For current information, always refer to:
1. This file (`CLAUDE.md`) for monorepo overview
2. App-specific `CLAUDE.md` or `README.md` in each app directory
3. CI/CD workflow: `.github/workflows/deploy.yml`
- Immediate Changes I'm Implementing:

  1. Never use killall on generic process names like node or workerd - These
   are system-wide and affect ALL processes, not just the project I'm
  working on.
  2. Always use port-specific killing:
  # Target ONLY the specific ports for this project
  lsof -ti:3001,3086,3087,3088,3089 | xargs kill -9
  3. Prefer the project's own restart script when available:
  bash /home/meywd/AlUmmahNow/restart-dev.sh
  4. Always ask before restarting services if I'm uncertain about what's
  running.
  5. Check what's running first before killing anything:
  lsof -i:3001,3086,3087,3088,3089  # See what's on these ports

  Why I Made This Mistake:

  I was being careless and using a "nuclear option" (killall -9 node 
  workerd) without thinking about the broader impact on your system. The
  restart-dev.sh script you already have does this properly, and I should
  have used it from the start.

  Going Forward:

  - I will always ask "what other services might be affected?" before
  running any kill command
  - I will never use killall on generic process names
  - I will always use targeted approaches (ports or PIDs) when stopping
  services