# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this monorepo.

## Project Overview

**Al Ummah Now** is an Islamic content platform monorepo with four Cloudflare Workers applications:

1. **web** - Next.js 15 frontend with bilingual support (English/Arabic, RTL)
2. **api-videos** - Hono API backend with OpenAPI 3.1 (chanfana)
3. **processor** - Queue consumer for message processing and analytics
4. **websocket-server** - Real-time WebSocket server with Durable Objects

All apps share TypeScript types via `@al-ummah/shared-types` workspace package.

**Repository**: https://github.com/meywd/AlUmmahNow

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

## Monorepo Structure

```
al-ummah-now/
├── apps/
│   ├── web/              Next.js frontend (Cloudflare Workers + OpenNext)
│   ├── api-videos/       Hono API backend (Cloudflare Workers + R2)
│   ├── processor/        Queue consumer (Cloudflare Workers + R2)
│   └── websocket-server/ WebSocket server (Cloudflare Durable Objects + KV)
├── packages/
│   └── shared-types/     Shared TypeScript types
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
```

### Development
```bash
pnpm dev                 # Run all apps in parallel
pnpm web:dev             # Web app: http://localhost:3000
pnpm api:dev             # API: http://127.0.0.1:8686
pnpm processor:dev       # Processor: http://localhost:8787
pnpm websocket:dev       # WebSocket server: http://localhost:8787
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
| **Frontend** | Next.js 15 (App Router), React 19, Tailwind CSS |
| **API Backend** | Hono v4, chanfana (OpenAPI 3.1), Zod validation |
| **Processor** | TypeScript, Cloudflare Queue Consumer |
| **WebSocket Server** | Cloudflare Durable Objects, WebSocket API |
| **Authentication** | OpenAuth (JWT/OAuth2) via auth.alummahnow.net |
| **Storage** | Cloudflare R2 (object storage), KV (key-value) |
| **CDN** | Bunny.net (video streaming + image storage) |
| **Deployment** | Cloudflare Workers (all 4 apps) |
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

**packages/shared-types** - Shared TypeScript types
- Video, Channel, Playlist, User, Comment, Analytics types
- Used by all apps via workspace protocol: `@al-ummah/shared-types`
- Must be built before other apps: `pnpm --filter @al-ummah/shared-types build`

## CI/CD Pipeline

### GitHub Actions Workflow (`.github/workflows/deploy.yml`)

**Trigger**: Push to `main` or pull requests

**Pipeline Stages**:

1. **Test** - Type check + lint all packages (5 min)
2. **Build shared-types** - Required dependency for all apps (2 min)
3. **Build & Validate** - Parallel jobs:
   - `build-web`: Build Next.js app (up to 120 min)
   - `validate-api`: Type check + dry-run deployment
   - `validate-processor`: Type check + run tests

**Pull Request Previews** (opt-in only):
- **Disabled by default** - preview deployments only run when requested
- **To deploy previews**: Add `deploy-preview` label to your PR
- **Workers deployed** (when label is present):
  - **Web**: `al-ummah-web-pr-{number}.workers.dev`
  - **API**: `al-ummah-api-pr-{number}.workers.dev` (with Swagger UI)
  - **Processor**: `al-ummah-processor-pr-{number}` (development env)
  - **WebSocket**: `al-ummah-comms-pr-{number}.workers.dev`
- Each app posts separate PR comment with deployment info
- Auto-cleanup when PR closes
- **Rationale**: Reduces unnecessary deployments, saves Cloudflare Workers quota

**Staging Deployment** (main branch):
- All 4 apps deployed in parallel after validation
- Web uses `wrangler.staging.jsonc`
- API, Processor, and WebSocket use `--env staging`

**Production Deployment** (after staging):
- All 3 apps deployed to production
- Web uses `wrangler.production.jsonc`
- API and Processor use default configs

**Required Secrets**:
- `CLOUDFLARE_API_TOKEN` - For all deployments

## Development Workflow

### Working with the Monorepo

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build shared types** (required before other apps):
   ```bash
   pnpm --filter @al-ummah/shared-types build
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

## Common Tasks

### Adding a New Shared Type

1. Edit `packages/shared-types/src/video.ts` (or relevant file)
2. Export from `packages/shared-types/src/index.ts`
3. Rebuild: `pnpm --filter @al-ummah/shared-types build`
4. Use in apps: `import { VideoObject } from '@al-ummah/shared-types'`

### Adding a New API Endpoint

1. Create endpoint in `apps/api-videos/src/endpoints/{category}/`
2. Register in `apps/api-videos/src/index.ts`
3. Add authentication middleware if needed
4. Use `addAuthToSchema()` helper for OpenAPI docs
5. Test with Swagger UI at http://127.0.0.1:8686/

### Adding a New Page (Bilingual)

1. Create page in `apps/web/src/app/en/{route}/page.tsx`
2. Create Arabic version in `apps/web/src/app/ar/{route}/page.tsx`
3. Create component in `apps/web/src/components/{name}/index.tsx` (LTR)
4. Create RTL variant in `apps/web/src/components/{name}/rtl/index.tsx`
5. Test both routes: http://localhost:3000/en/{route} and /ar/{route}

### Deploying to Production

```bash
# Deploy all apps
pnpm web:deploy:production
pnpm api:deploy
pnpm processor:deploy
pnpm websocket:deploy

# Or push to main branch → GitHub Actions handles it
git push origin main
```

## Troubleshooting

### "Cannot find module '@al-ummah/shared-types'"
```bash
# Rebuild shared types
pnpm --filter @al-ummah/shared-types build

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
2. **Build shared-types first** before other apps
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
