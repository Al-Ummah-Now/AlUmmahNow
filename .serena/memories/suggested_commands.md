# Al Ummah Now - Suggested Commands

## Initial Setup

### First-Time Installation
```bash
# Clone repository
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow

# Install all dependencies (1-2 minutes)
pnpm install

# Build shared types (REQUIRED before other apps)
pnpm --filter @al-ummah/shared-types build
```

## Development Commands

### Start All Applications
```bash
# Start all apps in parallel (web, api, processor, websocket, log-service)
pnpm dev
```

### Start Individual Applications
```bash
# Web app - http://localhost:3001
pnpm web:dev

# API Videos - http://127.0.0.1:3086
pnpm api:dev

# Processor - http://localhost:3088
pnpm processor:dev

# WebSocket Server - http://localhost:3087
pnpm websocket:dev

# Log Service - http://localhost:3089
pnpm log:dev

# Scheduler
pnpm scheduler:dev
```

### Restart Development Servers
```bash
# Use the custom restart script (preferred)
bash /home/meywd/AlUmmahNow/restart-dev.sh

# Or manually kill specific ports and restart
lsof -ti:3001,3086,3087,3088,3089 | xargs kill -9
pnpm dev
```

## Build Commands

### Build All Packages
```bash
# Build everything (uses Turborepo caching)
pnpm build
```

### Build Specific Applications
```bash
# Build shared types (required first)
pnpm --filter @al-ummah/shared-types build

# Build web app
pnpm --filter @al-ummah/web build

# Build API
pnpm --filter @al-ummah/api-videos build

# Build processor
pnpm --filter @al-ummah/processor build

# Build WebSocket server
pnpm --filter @al-ummah/websocket-server build
```

## Type Checking

### Type Check All Packages
```bash
# Check all packages for type errors
pnpm type-check
```

### Type Check Specific App
```bash
pnpm --filter @al-ummah/web type-check
pnpm --filter @al-ummah/api-videos type-check
pnpm --filter @al-ummah/processor type-check
pnpm --filter @al-ummah/websocket-server type-check
```

## Linting

### Lint All Packages
```bash
# Lint all packages
pnpm lint

# Lint and auto-fix
pnpm lint:fix
```

### Lint Specific App
```bash
pnpm --filter @al-ummah/web lint
pnpm --filter @al-ummah/web lint:fix
```

## Testing

### Run All Tests
```bash
# Run all test suites
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Run Tests for Specific App
```bash
# Processor tests
pnpm --filter @al-ummah/processor test
pnpm --filter @al-ummah/processor test:watch

# API tests
pnpm --filter @al-ummah/api-videos test

# Web E2E tests (Playwright)
pnpm --filter @al-ummah/web test:e2e
```

### Generate Test Coverage
```bash
# Coverage for all apps
pnpm test:coverage

# Coverage for specific app
pnpm --filter @al-ummah/processor test:coverage
```

## Deployment Commands

### Preview/Dry Run
```bash
# Web preview deployment (dry run)
cd apps/web
pnpm wrangler pages deploy .vercel/output/static --project-name al-ummah-web --branch preview --dry-run

# API dry run
cd apps/api-videos
pnpm wrangler deploy --dry-run

# Processor dry run
cd apps/processor
pnpm wrangler deploy --dry-run
```

### Deploy to Staging
```bash
# Web staging
pnpm web:deploy:staging

# API staging
cd apps/api-videos
pnpm wrangler deploy --env staging

# Processor staging
cd apps/processor
pnpm wrangler deploy --env staging

# WebSocket staging
cd apps/websocket-server
pnpm wrangler deploy --env staging
```

### Deploy to Production
```bash
# Web production
pnpm web:deploy:production

# API production
pnpm api:deploy

# Processor production
pnpm processor:deploy

# WebSocket production
pnpm websocket:deploy
```

## Logging Commands

### View Real-Time Logs
```bash
# Web viewer (recommended)
# Open http://localhost:3089/viewer/viewer.html in browser

# Stream all logs via SSE
curl -N http://localhost:3089/logs/stream/realtime

# Stream only errors
curl -N "http://localhost:3089/logs/stream/realtime?level=error"

# Stream from specific app
curl -N "http://localhost:3089/logs/stream/realtime?app=api-videos"

# Combine filters
curl -N "http://localhost:3089/logs/stream/realtime?level=error&app=api-videos"
```

### Snapshot Logs
```bash
# Get last 100 lines (all apps)
curl "http://localhost:3089/logs/stream?lines=100&tail=true" | jq

# Get last 50 ERROR logs
curl "http://localhost:3089/logs/stream?lines=50&level=error&tail=true" | jq

# Get logs from specific app
curl "http://localhost:3089/logs/api-videos?lines=200" | jq
```

## Git Workflow

### Branch Management
```bash
# Create feature branch
git checkout -b feat/video-upload

# Create fix branch
git checkout -b fix/rtl-layout

# Update from main
git pull origin main
```

### Commit Changes
```bash
# Stage all changes
git add .

# Commit with conventional commit message
git commit -m "feat(web): add video upload feature"
git commit -m "fix(api): resolve authentication bug"
git commit -m "docs(processor): update message handler docs"

# Push to remote
git push origin your-branch
```

### GitHub CLI
```bash
# View issue
gh issue view 123

# Close issue
gh issue close 123 --comment "Fixed in commit abc123"

# Create PR
gh pr create --title "feat: add video sections" --body "Description here"

# View PR
gh pr view 456
```

## Wrangler Commands

### Authentication
```bash
# Login to Cloudflare
pnpm wrangler login

# Logout
pnpm wrangler logout

# Check authentication status
pnpm wrangler whoami
```

### Development
```bash
# Start local Wrangler dev server (API)
cd apps/api-videos
pnpm wrangler dev

# Start with specific port
pnpm wrangler dev --port 3086
```

### Logs
```bash
# Tail production logs (API)
cd apps/api-videos
pnpm wrangler tail

# Tail staging logs
pnpm wrangler tail --env staging

# Filter by log level
pnpm wrangler tail --format pretty
```

### R2 Storage
```bash
# List R2 buckets
pnpm wrangler r2 bucket list

# Create bucket
pnpm wrangler r2 bucket create al-ummah-now-videos

# List objects in bucket
pnpm wrangler r2 object list --bucket al-ummah-now-videos
```

### KV Storage
```bash
# List KV namespaces
pnpm wrangler kv:namespace list

# List keys in namespace
pnpm wrangler kv:key list --binding AL_UMMAH_NOW_ANALYTICS_KV

# Get value
pnpm wrangler kv:key get "key-name" --binding AL_UMMAH_NOW_ANALYTICS_KV
```

## Package Management

### Install Dependencies
```bash
# Install all dependencies
pnpm install

# Add dependency to specific app
pnpm --filter @al-ummah/web add next@latest
pnpm --filter @al-ummah/api-videos add hono
pnpm --filter @al-ummah/processor add -D @types/jest

# Add root devDependency
pnpm add -D -w turbo
```

### Update Dependencies
```bash
# Update all dependencies (interactive)
pnpm update --interactive

# Update specific package
pnpm update next@latest

# Update workspace dependencies
pnpm update --workspace-root
```

### Remove Dependencies
```bash
# Remove from specific app
pnpm --filter @al-ummah/web remove package-name

# Remove from root
pnpm remove -w package-name
```

## Database/Storage Commands

### R2 Operations (via API)
```bash
# Upload file to R2
curl -X PUT \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: video/mp4" \
  --data-binary @video.mp4 \
  http://127.0.0.1:3086/videos/upload

# List videos
curl http://127.0.0.1:3086/videos

# Get video metadata
curl http://127.0.0.1:3086/videos/:id
```

## Debugging Commands

### Check Running Processes
```bash
# Check what's running on dev ports
lsof -i:3001,3086,3087,3088,3089

# Check specific port
lsof -i:3001

# Kill processes on specific ports
lsof -ti:3001,3086,3087,3088,3089 | xargs kill -9
```

### TypeScript Server (VS Code)
```bash
# Restart TypeScript server in VS Code
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

### Clear Build Cache
```bash
# Clear Turborepo cache
pnpm turbo clean

# Clear Next.js cache
cd apps/web
rm -rf .next

# Clear node_modules and reinstall
rm -rf node_modules
pnpm install
```

## API Testing

### Using Swagger UI
```bash
# Start API server
pnpm api:dev

# Open Swagger UI in browser
# http://127.0.0.1:3086/
```

### Using curl
```bash
# Get videos
curl http://127.0.0.1:3086/videos

# Get specific video
curl http://127.0.0.1:3086/videos/:id

# Create video (with auth)
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Video","description":"Description"}' \
  http://127.0.0.1:3086/videos
```

## Performance Monitoring

### Build Analysis
```bash
# Analyze web bundle size
cd apps/web
pnpm build
# Check .next/analyze/ output

# Turborepo build summary
pnpm build --summarize
```

### Lighthouse (Web Performance)
```bash
# Install lighthouse globally
npm install -g lighthouse

# Run lighthouse on local dev
lighthouse http://localhost:3001 --view

# Production audit
lighthouse https://alummahnow.net --view
```

## Maintenance Commands

### Clean Build Artifacts
```bash
# Clean all build outputs
find . -name ".next" -type d -exec rm -rf {} +
find . -name "dist" -type d -exec rm -rf {} +
find . -name ".wrangler" -type d -exec rm -rf {} +

# Clean Turborepo cache
pnpm turbo clean
```

### Update VS Code Settings
```bash
# Reload VS Code window
# Ctrl+Shift+P → "Developer: Reload Window"
```

### Verify Installation
```bash
# Check pnpm version (should be v10.22.0+)
pnpm --version

# Check Node version (should be v18+)
node --version

# Check all scripts are available
pnpm run
```

## CI/CD Commands (GitHub Actions)

### Trigger Workflow
```bash
# Push to main triggers full pipeline
git push origin main

# Create PR (auto-runs validation)
gh pr create

# Add deploy-preview label for PR previews
gh pr edit 123 --add-label deploy-preview
```

### View Workflow Status
```bash
# List recent workflow runs
gh run list

# View specific run
gh run view 12345

# View run logs
gh run view 12345 --log
```

## Emergency Commands

### Stop All Development Servers
```bash
# Use restart script (safest)
bash /home/meywd/AlUmmahNow/restart-dev.sh

# Or kill specific ports
lsof -ti:3001,3086,3087,3088,3089 | xargs kill -9

# NEVER use (affects all Node.js processes system-wide):
# killall -9 node    # DON'T USE
# killall -9 workerd # DON'T USE
```

### Recover from Build Errors
```bash
# 1. Clean everything
rm -rf node_modules
rm -rf apps/*/node_modules
rm -rf packages/*/node_modules
pnpm store prune

# 2. Reinstall
pnpm install

# 3. Rebuild shared types
pnpm --filter @al-ummah/shared-types build

# 4. Try build again
pnpm build
```

## Quick Reference

### Most Common Commands
```bash
# Development
pnpm dev                          # Start all apps
pnpm type-check                   # Type check all
pnpm lint                         # Lint all
pnpm build                        # Build all

# Testing
pnpm test                         # Run all tests
pnpm --filter @al-ummah/processor test:watch  # Watch mode

# Deployment
pnpm web:deploy:production        # Deploy web to prod
pnpm api:deploy                   # Deploy API to prod

# Logs
# Open http://localhost:3089/viewer/viewer.html

# Git
git add .
git commit -m "feat(app): description"
git push
```

### Port Reference
- **3001**: Web app (Next.js)
- **3086**: API Videos (Hono)
- **3087**: WebSocket Server (Durable Objects)
- **3088**: Processor (Queue Consumer)
- **3089**: Log Service

### Environment Files
- **Web**: `apps/web/.dev.vars`
- **API**: `apps/api-videos/.dev.vars`
- **Processor**: `apps/processor/.dev.vars`
- **WebSocket**: `apps/websocket-server/.dev.vars`
