# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Al Ummah Now is a Next.js 15 video platform for Islamic content deployed on Cloudflare Workers with R2 storage. The platform features OpenAuth authentication, Bunny.net CDN integration, bilingual support (English/Arabic with RTL), and a comprehensive video management system.

**Live Demo**: https://al-ummah-now.templates.workers.dev

## Essential Commands

### Development
```bash
npm install              # Install dependencies (65 seconds)
npm run dev             # Start dev server on port 3000
npm run build           # Production build (38s - 90+ min depending on environment)
npm run lint            # Run ESLint (3 warnings acceptable)
npx tsc --noEmit        # Type checking only (6 seconds)
```

### Cloudflare Deployment
```bash
npm run cf-typegen            # Generate Cloudflare types
npm run check                 # Build + type check + dry-run deploy (8s)
npm run preview               # Build and preview with Wrangler
npm run deploy:preview        # Deploy to preview environment
npm run deploy:staging        # Deploy to staging
npm run deploy:production     # Deploy to production
npm run logs                  # Tail production logs
npm run logs:staging          # Tail staging logs
npm run logs:preview          # Tail preview logs
npm run deployments           # List all deployments
npm run rollback              # Rollback to previous deployment
npm run status                # Check worker status
```

**Deployment Environments**:
- **Preview**: PR-specific workers (`al-ummah-now-pr-{PR_NUMBER}`), separate Bunny.net zones
- **Staging**: `al-ummah-now-staging`, staging Bunny.net zones
- **Production**: `al-ummah-now-production`, production Bunny.net zones

### Testing
- **Manual validation required**: Run `npm run dev` and test at http://localhost:3000
- Verify homepage redirects to `/en/` with header, logo, and Videos section
- Test navigation between `/en` and `/ar` routes for bilingual support
- Check responsive design and dark/light theme switching

## High-Level Architecture

### Deployment Stack
- **Frontend**: Next.js 15 with App Router, deployed via @opennextjs/cloudflare
- **Hosting**: Cloudflare Workers with edge computing
- **Storage**: Cloudflare R2 for video files
- **CDN**: Bunny.net for image/video delivery (zones: al-ummah-now-images, videos-mostafa-elbadry)
- **Authentication**: OpenAuth with JWT tokens, refresh rotation
- **Cache**: Cloudflare KV for incremental cache

### Multi-Environment Pipeline
**Status**: Complete CI/CD pipeline (commits dd20755, 9585e83)

Automated CI/CD via GitHub Actions (.github/workflows/deploy.yml):

**Pipeline Stages**:
1. **Test Stage**: Type check (`npx tsc --noEmit`), lint (`npm run lint`), security audit (`npm audit`)
2. **Build Stage**: Production build with 120min timeout, artifacts uploaded for 30 days
3. **Preview Deployment** (PRs only):
   - Dynamic worker per PR: `al-ummah-now-pr-{PR_NUMBER}`
   - Preview URL posted as PR comment
   - Automatic cleanup when PR closes
   - Separate Bunny.net zones: `al-ummah-now-images-preview`, `videos-preview`
   - R2 bucket: `videos-preview`
4. **Staging Deployment** (main branch):
   - Worker: `al-ummah-now-staging`
   - Bunny.net zones: `al-ummah-now-images-staging`, `videos-staging`
   - R2 bucket: `videos-staging`
5. **Production Deployment** (main branch):
   - Worker: `al-ummah-now-production`
   - Bunny.net zones: `al-ummah-now-images`, `videos-mostafa-elbadry`
   - R2 bucket: `videos`
   - Deployed only after staging validation

**GitHub Secrets Required**:
- `CLOUDFLARE_API_TOKEN` - Required for all deployments

**Pipeline Features**:
- Artifact caching for faster builds
- Build artifacts retained for 30 days
- Preview URLs automatically posted to PRs
- Staging gate before production
- Failed deployments halt pipeline

### API Integration Pattern
The application uses a centralized OpenAPI client in `src/lib/api/`:
- **VideosAPI**: Video CRUD, comments, likes/dislikes, upload
- **ProfilesAPI**: User profile management
- **ChannelsAPI**: Channel management, subscriptions
- **PlaylistsAPI**: Playlist CRUD, video management
- **AnalyticsAPI**: Metrics and analytics data

All API clients follow a consistent pattern with automatic error handling and optional authentication headers (`channelId`, `userId`).

### Authentication Flow
OpenAuth implementation in `src/lib/actions.ts`:
- JWT access tokens (15min expiry) + refresh tokens (7 days, rotated on use)
- Stored in httpOnly cookies (`access_token`, `refresh_token`)
- `authenticated()` server action validates and refreshes tokens automatically
- OAuth providers: Google, Apple (configured in auth.alummahnow.net)

### Bilingual Architecture
- **English routes**: `/en/*` with LTR layout
- **Arabic routes**: `/ar/*` with RTL layout
- Dual component implementations: `components/ComponentName/index.tsx` (LTR) and `components/ComponentName/rtl/index.tsx` (RTL)
- Root route `/` redirects to `/en/` as default

## Critical Build Information

### Build Timing
- Development server: ~4 seconds
- Type checking: ~6 seconds
- Production build: 38 seconds (can extend to 90+ minutes in network-restricted environments)
- **Always set explicit timeouts**: 120+ seconds for `npm install`, 120+ minutes for builds

### Known Build Issues
1. **Google Fonts**: Build fails in network-restricted environments. Workaround: Remove `import { Inter } from "next/font/google"` from `src/app/layout.tsx`
2. **TypeScript Version Warning**: Using 5.7.2 vs supported <5.5.0 - safe to ignore
3. **ESLint Warnings**: 3 warnings about dependencies and img elements - acceptable
4. **Network Restrictions**: External API calls (videos.api.alummahnow.net) fail in development - expected

### Environment Variables (wrangler.jsonc)
```json
{
  "vars": {
    "Issuer": "https://auth.alummahnow.net",
    "OPENAUTH_ISSUER": "https://auth.alummahnow.net",
    "API_URL": "https://videos.api.alummahnow.net"
  },
  "env": {
    "BunnyImageZone": "al-ummah-now-images",
    "BunnyVideoZone": "videos-mostafa-elbadry",
    "ClientId": "3f8c9b2e-4d6a-4b8e-9f3a-2c7d5e8f1a6b"
  },
  "r2_buckets": [{ "binding": "videos", "bucket_name": "videos" }]
}
```

Sensitive variables (set in Cloudflare dashboard): `BunnyImageKey`, `BunnyVideoKey`, `S3Key`, `S3Secret`, `S3Token`

## Code Patterns and Conventions

### API Client Usage
```typescript
import { VideosAPI, ChannelsAPI } from '@/lib/api';

// Without auth headers (public endpoints)
const videos = await VideosAPI.list({ limit: 20 });

// With auth headers (authenticated endpoints)
const headers = { channelId: 'channel-id', userId: 'user-id' };
const video = await VideosAPI.create(videoData, headers);
```

### Authentication Check
```typescript
import { authenticated } from '@/lib/actions';

// In server components or actions
const user = await authenticated();
if (!user) {
  redirect('/login');
}
// user.properties contains userId, email, displayName
```

### Component Pattern (Bilingual Support)
Components requiring RTL support have two implementations:
- `src/components/VideoCard/index.tsx` (LTR - English)
- `src/components/VideoCard/rtl/index.tsx` (RTL - Arabic)

### TypeScript Standards
- All new code must use TypeScript
- Use interfaces from `src/interfaces/` for domain types
- API types defined in `src/lib/api/types.ts`
- Cloudflare environment types in `cloudflare-env.d.ts`

### Styling
- Tailwind CSS with custom configuration in `tailwind.config.ts`
- Dark/light theme support via next-themes
- Radix UI primitives for interactive components
- Follow existing component patterns from `src/components/ui/`

## Project Structure Overview

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout with auth/navigation
│   ├── page.tsx                 # Redirect to /en/
│   ├── en/                      # English routes
│   │   ├── page.tsx            # Homepage
│   │   ├── video/page.tsx      # Video viewer
│   │   ├── channel/[id]/       # Channel pages
│   │   ├── profile/            # User profile
│   │   ├── analytics/          # Analytics dashboard
│   │   └── upload/             # Video upload
│   ├── ar/                      # Arabic routes (mirrors en/)
│   └── api/callback/route.ts   # OAuth callback
├── components/                   # React components
│   ├── Header/                  # Navigation (+ rtl/)
│   ├── videoPlayer/             # Video.js player (+ rtl/)
│   ├── videoCard/               # Video display (+ rtl/)
│   ├── AuthProvider/            # Auth context
│   ├── navigation/              # Navigation components
│   ├── analytics/               # Analytics components
│   └── ui/                      # Shadcn/ui components
├── lib/                         # Core utilities
│   ├── api/                     # OpenAPI client (videos, channels, playlists, analytics)
│   ├── clients/                 # Legacy API clients
│   ├── actions.ts               # Server actions (auth)
│   ├── auth.ts                  # Auth utilities
│   ├── profileManager.ts        # Profile state management
│   └── constants/               # App constants
├── hooks/                       # Custom React hooks
│   └── useProfile.ts           # Profile hook
└── interfaces/                  # TypeScript types
    ├── index.ts                # Domain types
    └── subjects.ts             # Auth subject types
```

### Key Configuration Files
- `next.config.ts`: Next.js + OpenNext Cloudflare initialization
- `open-next.config.ts`: Cloudflare-specific config (KV incremental cache)
- `wrangler.jsonc`: Development environment config
- `wrangler.staging.jsonc`: Staging environment
- `wrangler.production.jsonc`: Production environment
- `wrangler.preview.jsonc`: PR preview deployments

## Important Patterns

### Video Upload Flow
**Status**: Recently implemented (commits 86e0c10, db0339a), may need refinement

Video upload uses multi-part upload to Cloudflare R2 via `src/lib/api/videos.ts`:
1. Client uploads file chunks to R2 bucket using `src/components/videoUpload/`
2. Upload progress tracked with real-time feedback
3. Metadata posted to backend API at videos.api.alummahnow.net
4. Backend triggers Bunny.net transcoding
5. Transcoded videos served via Bunny.net CDN zones
6. Upload configuration in `src/lib/constants/uploadConfig.ts`

**Key Files**:
- `src/components/videoUpload/index.tsx` - Upload UI component
- `src/lib/api/videos.ts` - `VideosAPI.upload()` method
- `src/lib/constants/uploadConfig.ts` - Size limits, allowed formats
- `src/app/en/upload/page.tsx` and `src/app/ar/upload/page.tsx` - Upload pages

**Note**: Upload functionality integrates with external backend API. In development, API calls may fail if backend is not running.

### Error Handling
All API calls should handle null returns gracefully:
```typescript
const videos = await VideosAPI.list();
if (!videos) {
  // Handle error - API may be unreachable
  return null;
}
```

### Authentication State
- Use `AuthProvider` context from `src/components/AuthProvider/`
- Server components use `authenticated()` action
- Client components use `useProfile()` hook

### Routing
- Root `/` redirects to `/en/`
- All pages duplicated under `/en/` and `/ar/`
- Use Next.js Link component for navigation
- Language switching handled by Header component

## Development Workflow

### Making Changes
1. Read relevant documentation: ARCHITECTURE.md, DEPLOYMENT.md, CONTRIBUTING.md
2. Test changes with `npm run dev`
3. Validate with `npm run lint` and `npx tsc --noEmit`
4. Build test with `npm run build` for core changes
5. Commit with conventional commit format: `type(scope): description`

### Working with Issues
The repository uses a structured issue system:

**Issue Templates** (.github/ISSUE_TEMPLATE/):
- `bug_report.yml` - Report bugs with reproduction steps
- `feature_request.yml` - Suggest new features
- `implementation_issue.yml` - Track roadmap implementation tasks
- `deployment_issue.yml` - Report deployment problems
- `documentation_request.yml` - Request documentation improvements

**Issue Labels** (from IMPLEMENTATION_ISSUES.md):
- Priority: `priority-high`, `priority-medium`, `priority-low`
- Phase: `phase-1`, `phase-2`, `phase-3`, `phase-4`
- Epic: `epic-video-upload`, `epic-real-time`, `epic-search`, etc.
- Type: `enhancement`, `bug`, `infrastructure`, `documentation`, `security`

**Project Board**: https://github.com/users/meywd/projects/1/views/1
- All issues should be linked to the project board
- Columns: Backlog → To Do → In Progress → Review → Done

**Milestones**:
- Phase 1: Foundation (High priority, blocking features)
- Phase 2: Core Platform (Backend infrastructure)
- Phase 3: Educational Platform (Academy features)
- Phase 4: Advanced Features (AI, messaging, archives)

### Pull Request Process
- PRs automatically trigger preview deployment
- Preview URL posted as PR comment: `https://al-ummah-now-pr-{PR_NUMBER}.workers.dev`
- Preview deployments use separate Bunny.net zones (preview environment)
- Staging deployment on merge to main
- Production deployment after staging validation
- PR cleanup: Preview workers automatically deleted when PR closes

### Debugging
- Use `npm run logs` to tail production logs
- `npm run logs:staging` for staging environment
- `npm run logs:preview` for preview deployments
- Check Cloudflare Workers dashboard for metrics
- Review `npm run check` output for deployment issues
- Use `npm run rollback` if production has issues

## Performance Targets
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Time to Interactive: < 3.5s
- Production uptime: 99.9% SLA

## Current Implementation Status

### Platform Completion: ~60%
The platform has a solid foundation with key features implemented. See FEATURES.md for detailed analysis.

### ✅ Completed Features
- Complete API client architecture (Videos, Channels, Playlists, Profiles, Analytics APIs)
- OpenAuth authentication with JWT tokens and refresh rotation
- Bilingual support (English/Arabic) with RTL layouts
- Video.js player integration with quality selection
- User profiles, channels, and playlist management
- Comment system and social interactions (likes/dislikes)
- Responsive design with dark/light themes
- Analytics dashboard for content creators
- Cloudflare Workers deployment with CI/CD pipeline

### 🚧 Phase 1 Priorities (In Development)
Based on IMPLEMENTATION_ISSUES.md and recent commits:

**High Priority (Blocking)**:
1. **Video Upload System** - Multi-part upload with Cloudflare R2/Bunny.net (recently implemented, may need refinement)
2. **Real-time Features** - WebSocket integration for live comments, notifications, view counts
3. **Content Moderation** - Admin interface, reporting system, automated filtering
4. **Testing Infrastructure** - Comprehensive unit, integration, and e2e tests (Issue #10)
5. **Security Hardening** - Compliance measures, security audit (Issue #11)

**Medium Priority**:
- Advanced search with filters and content discovery
- Subscription system with notifications
- Creator analytics enhancements
- PWA features and offline functionality
- Performance optimization and caching improvements

**Low Priority**:
- SEO optimization and meta tags
- Mobile app companion (Phase 2)
- AI-powered recommendations (Phase 4)

### ⚠️ Known Gaps and Limitations
- **No automated tests** - Testing infrastructure is planned but not yet implemented
- **Limited real-time features** - WebSocket integration pending
- **Basic search** - Advanced filtering and content discovery needs enhancement
- **Manual moderation only** - Automated content filtering not yet implemented
- **External API dependency** - Backend APIs (videos.api.alummahnow.net) required for full functionality

### 🔄 Recent Development Activity (from git log)
- Cloudflare Workers preview deployments for PRs
- Complete CI/CD pipeline implementation
- Video upload functionality with R2/Bunny.net integration
- Video analytics dashboard with bilingual support
- TypeScript safety improvements and error handling enhancements

## Multi-Repository Ecosystem

This repository (AlUmmahNow) is the **Video Portal UI**. The complete platform includes:

1. **AlUmmahNow** (this repo) - Next.js frontend
2. **AlUmmahNowVideos** (planned) - API backend with Fastify/Express, Issue #7
3. **AlUmmahNowAuth** (planned) - SSO authentication service, Issue #8
4. **AlUmmahNowProcessor** (planned) - Event streaming and analytics, Issue #9
5. **AlUmmahNowCMS** (planned) - Content management for news/articles

**Important**: When working on features that require backend APIs, be aware that some repos may not exist yet. Check ISSUE_TEMPLATES.md for planned repository structure.

## Additional Resources
- **ARCHITECTURE.md**: Technical architecture, microservices design, security patterns
- **DEPLOYMENT.md**: Complete deployment guide, environment variables, monitoring
- **CONTRIBUTING.md**: Development guidelines, code standards, testing requirements
- **ROADMAP.md**: 4-phase development plan with timeline and milestones
- **FEATURES.md**: Detailed implementation status analysis (~60% complete)
- **IMPLEMENTATION_ISSUES.md**: 20 planned issues for roadmap implementation
- **GITHUB_ISSUES.md**: Specific issue templates for Phase 1 features
- **ISSUE_TEMPLATES.md**: Templates for multi-repository coordination

## Common Pitfalls
1. **Never cancel builds** - they may take up to 90 minutes
2. **Always test bilingual support** - verify both `/en/` and `/ar/` routes
3. **Handle API failures gracefully** - external APIs may be unreachable in development
4. **Update Cloudflare types** - run `npm run cf-typegen` after modifying wrangler.jsonc
5. **Test authentication flows** - ensure login/logout work correctly
6. **Verify responsive design** - test mobile and desktop layouts
7. **Check dark/light themes** - both themes should work properly
