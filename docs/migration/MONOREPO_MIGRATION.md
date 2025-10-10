# Al Ummah Now - Monorepo Migration Plan

## Overview

This document outlines the migration from multi-repo to monorepo structure for the Al Ummah Now ecosystem.

## 🎯 Migration Goals

1. ✅ Consolidate frontend and backend services into single repository
2. ✅ Enable shared TypeScript types across all services
3. ✅ Simplify dependency management and CI/CD
4. ✅ Maintain independent deployment of each service
5. ✅ Improve developer experience and iteration speed

## 📁 Target Monorepo Structure

```
al-ummah-now/                           (monorepo root)
├── apps/
│   ├── web/                            (Next.js frontend - current AlUmmahNow)
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── wrangler.*.jsonc
│   │
│   ├── api-videos/                     (Video API backend - NEW)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── middleware/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── wrangler.jsonc
│   │
│   ├── api-auth/                       (Auth service - NEW)
│   │   ├── src/
│   │   ├── package.json
│   │   └── wrangler.jsonc
│   │
│   ├── api-processor/                  (Events processor - Phase 2)
│   │   └── package.json
│   │
│   └── api-cms/                        (CMS backend - Phase 2)
│       └── package.json
│
├── packages/
│   ├── shared-types/                   (Shared TypeScript types)
│   │   ├── src/
│   │   │   ├── video.ts
│   │   │   ├── channel.ts
│   │   │   ├── user.ts
│   │   │   ├── playlist.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api-client/                     (Generated API client)
│   │   ├── src/
│   │   │   ├── videos.ts
│   │   │   ├── channels.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── auth-utils/                     (Shared auth utilities)
│   │   ├── src/
│   │   │   ├── jwt.ts
│   │   │   ├── session.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── ui-components/                  (Shared React components - Phase 2)
│   │   ├── src/
│   │   └── package.json
│   │
│   └── eslint-config/                  (Shared ESLint config)
│       ├── next.js
│       ├── node.js
│       └── package.json
│
├── .github/
│   └── workflows/
│       ├── deploy.yml                  (Monorepo deployment pipeline)
│       ├── test.yml                    (Testing pipeline)
│       └── preview.yml                 (PR preview deployments)
│
├── package.json                        (Root workspace config)
├── pnpm-workspace.yaml                 (Workspace definition)
├── turbo.json                          (Turborepo config)
├── tsconfig.base.json                  (Base TypeScript config)
├── .gitignore
├── README.md
├── CLAUDE.md                           (Updated for monorepo)
└── ARCHITECTURE.md                     (Updated architecture)
```

## 🔄 Migration Steps

### Phase 1: Setup Monorepo Infrastructure (Day 1)

#### Step 1.1: Initialize New Repository Structure
```bash
# Create new directory for monorepo
mkdir al-ummah-now-monorepo
cd al-ummah-now-monorepo

# Initialize git
git init

# Initialize pnpm workspace
pnpm init

# Install Turborepo
pnpm add -D turbo
```

#### Step 1.2: Create Workspace Configuration
Files to create:
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `package.json` (root)

#### Step 1.3: Create Directory Structure
```bash
mkdir -p apps/web
mkdir -p apps/api-videos
mkdir -p apps/api-auth
mkdir -p packages/shared-types
mkdir -p packages/api-client
mkdir -p packages/auth-utils
mkdir -p packages/eslint-config
mkdir -p .github/workflows
```

### Phase 2: Migrate Frontend Code (Day 1-2)

#### Step 2.1: Copy Existing Frontend
```bash
# Copy current AlUmmahNow repo into apps/web
cp -r ../AlUmmahNow/* apps/web/
cd apps/web
rm -rf .git  # Remove old git history
```

#### Step 2.2: Update Frontend Package.json
- Update name to `@al-ummah/web`
- Add workspace dependencies
- Update scripts for monorepo context

#### Step 2.3: Test Frontend in New Structure
```bash
cd apps/web
pnpm install
pnpm dev
```

### Phase 3: Extract Shared Types (Day 2)

#### Step 3.1: Create Shared Types Package
```bash
cd packages/shared-types
pnpm init
```

#### Step 3.2: Move Types from Frontend
Move from `apps/web/src/interfaces/` to `packages/shared-types/src/`:
- `video.ts`
- `channel.ts`
- `user.ts` (from subjects.ts)
- `playlist.ts`
- `analytics.ts`

#### Step 3.3: Update Frontend Imports
Replace:
```typescript
import { VideoObject } from '@/interfaces';
```
With:
```typescript
import { VideoObject } from '@al-ummah/shared-types';
```

### Phase 4: Create Backend API Structure (Day 2-3)

#### Step 4.1: Initialize Video API Backend
```bash
cd apps/api-videos
pnpm init
pnpm add fastify @fastify/cors @fastify/helmet
pnpm add -D typescript @types/node tsx
```

#### Step 4.2: Create Basic API Structure
- `src/index.ts` - Main server file
- `src/routes/` - API routes
- `src/services/` - Business logic
- `src/middleware/` - Auth, logging, etc.

#### Step 4.3: Set Up OpenAPI Integration
- Use shared types from `@al-ummah/shared-types`
- Generate OpenAPI spec
- Update frontend API client to use shared types

### Phase 5: Update CI/CD Pipeline (Day 3-4)

#### Step 5.1: Create Monorepo Deployment Pipeline
Update `.github/workflows/deploy.yml` to:
- Detect changed apps using Turborepo
- Deploy only changed services
- Maintain preview/staging/production environments

#### Step 5.2: Configure Per-App Deployment
Each app maintains its own:
- `wrangler.jsonc` config
- Environment variables
- Deployment target

### Phase 6: Documentation Update (Day 4)

#### Step 6.1: Update Key Documents
- `README.md` - Monorepo structure and commands
- `CLAUDE.md` - Updated for monorepo workflow
- `ARCHITECTURE.md` - Reflect new structure
- `CONTRIBUTING.md` - Monorepo development guidelines

## 📋 Migration Checklist

### Pre-Migration
- [x] Analyze current repository structure
- [x] Design target monorepo structure
- [x] Document migration plan
- [ ] Backup current repository
- [ ] Create new monorepo repository

### Infrastructure Setup
- [ ] Initialize pnpm workspace
- [ ] Install and configure Turborepo
- [ ] Create base TypeScript config
- [ ] Set up directory structure
- [ ] Configure Git and .gitignore

### Code Migration
- [ ] Move frontend to apps/web
- [ ] Extract shared types to packages/shared-types
- [ ] Update all imports in frontend
- [ ] Create api-videos structure
- [ ] Create api-auth structure
- [ ] Test all apps independently

### Shared Packages
- [ ] Create shared-types package
- [ ] Create api-client package
- [ ] Create auth-utils package
- [ ] Create eslint-config package
- [ ] Test package imports

### CI/CD Update
- [ ] Update deployment pipeline
- [ ] Configure per-app deployment
- [ ] Test preview deployments
- [ ] Test staging deployments
- [ ] Test production deployments

### Documentation
- [ ] Update README.md
- [ ] Update CLAUDE.md
- [ ] Update ARCHITECTURE.md
- [ ] Update CONTRIBUTING.md
- [ ] Update DEPLOYMENT.md

### Validation
- [ ] Run all builds successfully
- [ ] Run all tests (when implemented)
- [ ] Deploy to preview environment
- [ ] Verify all environments work
- [ ] Test cross-package dependencies

## 🔧 Configuration Files

### pnpm-workspace.yaml
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**", ".open-next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "type-check": {
      "dependsOn": ["^type-check"]
    },
    "deploy": {
      "dependsOn": ["build"],
      "cache": false
    }
  }
}
```

### Root package.json
```json
{
  "name": "al-ummah-now",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "test": "turbo run test",
    "deploy:web": "turbo run deploy --filter=@al-ummah/web",
    "deploy:api": "turbo run deploy --filter=@al-ummah/api-videos",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "5.7.2"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=18"
  }
}
```

## 🚀 Post-Migration Benefits

### Developer Experience
✅ Single `git clone` and `pnpm install`
✅ Type safety across frontend and backend
✅ Shared utilities and configurations
✅ Faster development with hot reload across packages

### Operations
✅ Single CI/CD pipeline with smart caching
✅ Atomic commits across multiple services
✅ Consistent versioning
✅ Simplified dependency management

### Code Quality
✅ Shared TypeScript types eliminate API mismatches
✅ Consistent linting and formatting
✅ Easier refactoring across services
✅ Better code reuse

## ⚠️ Important Notes

1. **Git History**: Consider preserving git history using `git subtree` or `git filter-branch` if needed
2. **Dependencies**: Some packages may have version conflicts - resolve during migration
3. **Environment Variables**: Each app maintains its own `.env` or wrangler config
4. **Deployment**: Apps deploy independently despite being in monorepo
5. **Permissions**: Set up appropriate CODEOWNERS if team grows

## 🔄 Rollback Plan

If migration fails:
1. Original repository remains at `meywd/AlUmmahNow`
2. Keep both repos until monorepo is fully validated
3. Can switch back by reverting to original repo
4. No production impact during migration

## 📊 Success Metrics

Migration is successful when:
- ✅ All apps build without errors
- ✅ Frontend deploys to Cloudflare Workers
- ✅ Backend APIs can be developed and deployed
- ✅ Shared types work across all packages
- ✅ CI/CD pipeline passes
- ✅ Development experience is improved

## 🎯 Timeline

- **Day 1**: Infrastructure setup + Frontend migration
- **Day 2**: Extract shared types + Create backend structure
- **Day 3**: Update CI/CD + Test deployments
- **Day 4**: Documentation + Final validation

**Total Estimated Time**: 3-4 days

## 📚 References

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Monorepo Best Practices](https://monorepo.tools/)
