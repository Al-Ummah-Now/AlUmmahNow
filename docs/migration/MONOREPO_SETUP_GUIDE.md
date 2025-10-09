# Al Ummah Now - Monorepo Setup Guide

## 🚀 Quick Start - Step-by-Step Instructions

This guide will help you migrate from the current single-repo structure to a monorepo.

## Prerequisites

- **Node.js** 18+ installed
- **pnpm** 9+ installed (`npm install -g pnpm`)
- **Git** installed
- Current AlUmmahNow repository cloned

## Option 1: Fresh Monorepo Setup (Recommended)

### Step 1: Create New Monorepo Directory

```bash
# Navigate to your projects directory
cd F:/Code/Repos

# Create new monorepo directory
mkdir AlUmmahNow-mono
cd AlUmmahNow-mono

# Initialize git
git init
git branch -M main
```

### Step 2: Copy Configuration Files

```bash
# Copy all config files from monorepo-configs
cp ../AlUmmahNow/monorepo-configs/package.json .
cp ../AlUmmahNow/monorepo-configs/pnpm-workspace.yaml .
cp ../AlUmmahNow/monorepo-configs/turbo.json .
cp ../AlUmmahNow/monorepo-configs/tsconfig.base.json .
cp ../AlUmmahNow/monorepo-configs/.gitignore .
```

### Step 3: Create Directory Structure

```bash
# Create apps and packages directories
mkdir -p apps/web
mkdir -p apps/api-videos/src
mkdir -p apps/api-auth/src
mkdir -p packages

# Copy shared-types package
cp -r ../AlUmmahNow/monorepo-configs/packages/shared-types packages/
```

### Step 4: Move Frontend Code to apps/web

```bash
# Copy entire frontend to apps/web
cp -r ../AlUmmahNow/* apps/web/

# Remove monorepo-configs from frontend
rm -rf apps/web/monorepo-configs

# Remove old git directory
rm -rf apps/web/.git
```

### Step 5: Update Frontend Package.json

Edit `apps/web/package.json`:

```json
{
  "name": "@al-ummah/web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "check": "opennextjs-cloudflare build && tsc && wrangler deploy --dry-run",
    "deploy": "opennextjs-cloudflare build && wrangler deploy",
    "deploy:staging": "opennextjs-cloudflare build && wrangler deploy --config wrangler.staging.jsonc",
    "deploy:production": "opennextjs-cloudflare build && wrangler deploy --config wrangler.production.jsonc",
    "deploy:preview": "opennextjs-cloudflare build && wrangler deploy --config wrangler.preview.jsonc",
    "preview": "opennextjs-cloudflare build && wrangler dev",
    "clean": "rm -rf .next .open-next node_modules"
  },
  "dependencies": {
    "@al-ummah/shared-types": "workspace:*",
    // ... existing dependencies
  }
}
```

### Step 6: Update Frontend TypeScript Config

Edit `apps/web/tsconfig.json` to extend base config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@al-ummah/shared-types": ["../../packages/shared-types/src"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### Step 7: Install Dependencies

```bash
# From monorepo root
pnpm install
```

### Step 8: Build Shared Types

```bash
# Build shared types package
pnpm --filter @al-ummah/shared-types build
```

### Step 9: Update Frontend Imports

You'll need to update imports in the frontend to use shared types:

**Before:**
```typescript
import { VideoObject } from '@/interfaces';
```

**After:**
```typescript
import { VideoObject } from '@al-ummah/shared-types';
```

Run this command to help identify files that need updating:

```bash
cd apps/web
grep -r "from '@/interfaces'" src/
```

### Step 10: Test Frontend

```bash
# From monorepo root
pnpm web:dev

# Or using turbo directly
turbo run dev --filter=@al-ummah/web
```

Visit http://localhost:3000 to verify everything works.

### Step 11: Create Backend API Structure

```bash
cd apps/api-videos
pnpm init
```

Edit `apps/api-videos/package.json`:

```json
{
  "name": "@al-ummah/api-videos",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@al-ummah/shared-types": "workspace:*",
    "fastify": "^5.2.0",
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^12.0.1"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "@types/node": "^20.8.3",
    "tsx": "^4.19.2"
  }
}
```

Create `apps/api-videos/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../../packages/shared-types" }
  ]
}
```

Create basic API server `apps/api-videos/src/index.ts`:

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { VideoObject } from '@al-ummah/shared-types';

const fastify = Fastify({
  logger: true
});

// Register plugins
await fastify.register(cors, { origin: true });
await fastify.register(helmet);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Example video endpoint using shared types
fastify.get<{ Reply: VideoObject[] }>('/api/videos', async () => {
  // TODO: Implement actual video fetching
  return [];
});

// Start server
try {
  await fastify.listen({ port: 3001, host: '0.0.0.0' });
  console.log('API server running on http://localhost:3001');
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
```

### Step 12: Test Backend API

```bash
# From monorepo root
pnpm api:dev

# Test in another terminal
curl http://localhost:3001/health
```

### Step 13: Commit Initial Monorepo

```bash
# From monorepo root
git add .
git commit -m "feat: initialize monorepo structure with Turborepo

- Set up pnpm workspaces and Turborepo
- Create shared-types package with all common types
- Move frontend to apps/web
- Create api-videos backend structure
- Configure TypeScript project references
- Set up monorepo CI/CD foundation"
```

### Step 14: Set Up Remote Repository

```bash
# Create new repo on GitHub: AlUmmahNow-mono (or rename old repo)

# Add remote and push
git remote add origin https://github.com/meywd/AlUmmahNow-mono.git
git push -u origin main
```

## Option 2: In-Place Migration (Advanced)

If you want to convert the existing repo directly:

```bash
cd F:/Code/Repos/AlUmmahNow

# Create new branch for migration
git checkout -b monorepo-migration

# Move existing files to apps/web
mkdir -p apps/web
git mv !(apps|packages|monorepo-configs) apps/web/

# Copy config files to root
cp monorepo-configs/* .

# Set up packages
mkdir packages
cp -r monorepo-configs/packages/* packages/

# Clean up
rm -rf monorepo-configs

# Commit
git add .
git commit -m "refactor: migrate to monorepo structure"
```

## Post-Migration Tasks

### 1. Update CI/CD Pipeline

Edit `.github/workflows/deploy.yml` for monorepo:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      web: ${{ steps.filter.outputs.web }}
      api: ${{ steps.filter.outputs.api }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            web:
              - 'apps/web/**'
              - 'packages/shared-types/**'
            api:
              - 'apps/api-videos/**'
              - 'packages/shared-types/**'

  deploy-web:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm web:build
      - run: pnpm web:deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

  deploy-api:
    needs: changes
    if: needs.changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm api:build
      - run: pnpm api:deploy
```

### 2. Update CLAUDE.md

Update `CLAUDE.md` with monorepo structure and commands.

### 3. Update README.md

Create root README.md explaining monorepo structure:

```markdown
# Al Ummah Now - Monorepo

## Project Structure

- `apps/web` - Next.js frontend (Cloudflare Workers)
- `apps/api-videos` - Video API backend (Fastify)
- `apps/api-auth` - Authentication service
- `packages/shared-types` - Shared TypeScript types
- `packages/api-client` - Generated API client
- `packages/auth-utils` - Shared auth utilities

## Getting Started

\`\`\`bash
# Install dependencies
pnpm install

# Run frontend
pnpm web:dev

# Run API backend
pnpm api:dev

# Build everything
pnpm build

# Run tests
pnpm test
\`\`\`

See individual app READMEs for more details.
```

## Common Commands

```bash
# Development
pnpm web:dev           # Run frontend
pnpm api:dev           # Run API backend
pnpm dev               # Run all apps

# Building
pnpm web:build         # Build frontend only
pnpm api:build         # Build API only
pnpm build             # Build everything

# Deployment
pnpm web:deploy        # Deploy frontend
pnpm api:deploy        # Deploy API
pnpm deploy            # Deploy everything

# Utilities
pnpm lint              # Lint all packages
pnpm type-check        # Type check all packages
pnpm clean             # Clean all build artifacts
pnpm format            # Format code with Prettier

# Package-specific commands
pnpm --filter @al-ummah/web dev
pnpm --filter @al-ummah/shared-types build
```

## Troubleshooting

### "Cannot find module '@al-ummah/shared-types'"

```bash
# Build shared types first
pnpm --filter @al-ummah/shared-types build

# Or build everything
pnpm build
```

### Port already in use

```bash
# Kill process on port 3000
npx kill-port 3000

# Or run on different port
PORT=3002 pnpm web:dev
```

### pnpm install fails

```bash
# Clear pnpm cache
pnpm store prune

# Remove all node_modules
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# Reinstall
pnpm install
```

### TypeScript errors after migration

```bash
# Rebuild all TypeScript projects
pnpm build

# Check for circular dependencies
pnpm why <package-name>
```

## Next Steps

1. ✅ Migrate frontend imports to use @al-ummah/shared-types
2. ✅ Implement API backend routes
3. ✅ Set up authentication service
4. ✅ Update CI/CD pipeline
5. ✅ Add automated tests
6. ✅ Set up API documentation
7. ✅ Configure Docker for local development (optional)

## Resources

- [Turborepo Docs](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [MONOREPO_MIGRATION.md](./MONOREPO_MIGRATION.md) - Detailed migration plan
