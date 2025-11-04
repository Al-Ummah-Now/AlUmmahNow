# Al Ummah Now - Development Guide

## Prerequisites

### System Requirements
- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0 (required package manager)
- **Git**: Latest version
- **Cloudflare Account**: For Workers deployment

### Development Tools
- **IDE**: VS Code (recommended) with TypeScript extensions
- **Browser**: Chrome/Firefox with developer tools
- **API Testing**: Postman or similar (for API testing)

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow
```

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Build Shared Types (Required First)
```bash
pnpm --filter @al-ummah/shared-types build
```

### 4. Environment Setup
Copy environment example files:
```bash
# Web app
cp apps/web/.env.example apps/web/.env.local

# API Videos
cp apps/api-videos/.env.dev.example apps/api-videos/.env.dev

# Other services use wrangler secrets (see deployment section)
```

## Development Workflow

### Starting All Services
```bash
pnpm dev
```
This starts all 4 services in parallel:
- **Web**: http://localhost:3000
- **API**: http://127.0.0.1:3086
- **Processor**: http://localhost:3088
- **WebSocket**: http://localhost:3087

### Individual Service Development

#### Web Frontend
```bash
pnpm web:dev
# Access: http://localhost:3000
# Features: Hot reload, TypeScript, Tailwind CSS
```

#### API Backend
```bash
pnpm api:dev
# Access: http://127.0.0.1:3086
# Features: Hot reload, Swagger UI at root
```

#### Queue Processor
```bash
pnpm processor:dev
# Access: http://localhost:3088
# Features: Queue consumer, R2 integration
```

#### WebSocket Server
```bash
pnpm websocket:dev
# Access: http://localhost:3087
# Features: Durable Objects, WebSocket API
```

## Build Process

### Build All Packages
```bash
pnpm build
```

### Build Specific Package
```bash
pnpm --filter @al-ummah/web build
pnpm --filter @al-ummah/api-videos build
pnpm --filter @al-ummah/processor build
pnpm --filter @al-ummah/websocket-server build
```

### Build Order (Important)
1. **shared-types** (must be first)
2. **All other packages** (can be parallel)

## Testing

### Run All Tests
```bash
pnpm test
```

### Test Specific Package
```bash
pnpm --filter @al-ummah/web test
pnpm --filter @al-ummah/processor test
```

### Test Coverage
```bash
pnpm --filter @al-ummah/web test:coverage
```

### Type Checking
```bash
pnpm type-check
```

### Linting
```bash
pnpm lint
```

## Common Development Tasks

### Adding New Dependencies

#### Workspace Package (shared-types)
```bash
pnpm --filter @al-ummah/shared-types add <package>
```

#### App-Specific Package
```bash
pnpm --filter @al-ummah/web add <package>
pnpm --filter @al-ummah/api-videos add <package>
```

#### Root Dev Dependencies
```bash
pnpm add -D -w <package>
```

### Adding New Shared Types

1. Edit type file in `packages/shared-types/src/`
2. Export from `packages/shared-types/src/index.ts`
3. Rebuild shared types:
   ```bash
   pnpm --filter @al-ummah/shared-types build
   ```
4. Use in apps:
   ```typescript
   import { VideoObject } from '@al-ummah/shared-types'
   ```

### Adding New API Endpoints

1. Create endpoint in `apps/api-videos/src/endpoints/{category}/`
2. Register in `apps/api-videos/src/index.ts`
3. Add authentication middleware if needed
4. Test with Swagger UI at http://127.0.0.1:3086/

### Adding New Pages (Bilingual)

1. Create page in `apps/web/src/app/en/{route}/page.tsx`
2. Create Arabic version in `apps/web/src/app/ar/{route}/page.tsx`
3. Create component in `apps/web/src/components/{name}/index.tsx`
4. Create RTL variant in `apps/web/src/components/{name}/rtl/index.tsx`

## Environment Configuration

### Web App (.env.local)
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:3086
NEXT_PUBLIC_WS_URL=ws://localhost:3087
NEXT_PUBLIC_AUTH_URL=https://auth.alummahnow.net
```

### API Videos (.env.dev)
```env
CLOUDFLARE_API_TOKEN=your_token
BUNNY_STREAM_API_KEY=your_key
BUNNY_STREAM_LIBRARY_ID=your_library_id
```

### Authentication Setup
1. Configure OpenAuth at `auth.alummahnow.net`
2. Update callback URLs in OAuth provider
3. Set JWT secrets in Cloudflare Workers

## Debugging

### Common Issues

#### "Cannot find module '@al-ummah/shared-types'"
```bash
pnpm --filter @al-ummah/shared-types build
# Restart VS Code TypeScript server
```

#### "npm: command not found"
```bash
# Use pnpm instead of npm
pnpm install
pnpm dev
```

#### VS Code IntelliSense Errors
```bash
# Reload VS Code window
Ctrl+Shift+P → "Developer: Reload Window"
```

#### Wrangler Deployment Issues
```bash
# Login to Cloudflare
pnpm wrangler login

# Validate deployment
cd apps/api-videos
pnpm wrangler deploy --dry-run
```

### Debugging Tools

#### Frontend
- React DevTools
- Redux DevTools (if applicable)
- Network tab for API calls
- Console for WebSocket events

#### Backend
- Wrangler logs: `pnpm wrangler tail`
- Cloudflare Dashboard logs
- Swagger UI for API testing

#### WebSocket
- Browser WebSocket inspector
- Network tab for WebSocket frames
- Presence tracking in KV storage

## Performance Optimization

### Development Performance
- Use `pnpm dev` for hot reload
- Build shared types first
- Use workspace filters for specific tasks

### Build Performance
- Turborepo caching handles incremental builds
- Use `pnpm build` for optimized production builds
- Clean builds with `pnpm clean`

### Testing Performance
- Run tests in parallel with `pnpm test`
- Use coverage reports to identify gaps
- Focus on critical path testing

## Code Quality

### TypeScript Configuration
- Strict mode enabled
- Path mapping for clean imports
- Project references for monorepo

### ESLint Configuration
- Next.js recommended rules
- Custom rules for project patterns
- Auto-fix available with `pnpm lint:fix`

### Testing Standards
- Jest for unit tests
- Playwright for E2E tests
- Coverage targets: 50% (current goal)

## Git Workflow

### Branch Strategy
- `main` - Production branch
- Feature branches from `main`
- PR reviews required

### Commit Convention
```bash
feat: add new feature
fix: bug fix
docs: documentation
refactor: code refactoring
test: add tests
chore: maintenance
```

### Pre-commit Hooks
- Type checking
- Linting
- Testing (where configured)

## Troubleshooting

### Port Conflicts
Default ports:
- Web: 3000
- API: 3086
- WebSocket: 3087
- Processor: 3088

Kill processes on ports:
```bash
lsof -ti:3000,3086,3087,3088 | xargs kill -9
```

### Build Failures
1. Check Node.js version: `node --version`
2. Clear cache: `pnpm clean`
3. Reinstall: `rm -rf node_modules && pnpm install`

### TypeScript Errors
1. Build shared types first
2. Restart TypeScript server
3. Check tsconfig.json paths

### Deployment Issues
1. Check Cloudflare authentication
2. Validate wrangler configuration
3. Check environment variables

## Resources

### Documentation
- [Project README](../README.md)
- [API Documentation](./api-contracts.md)
- [Architecture Guide](./architecture.md)
- [Deployment Guide](./deployment-guide.md)

### External Links
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Hono Framework](https://hono.dev/)
- [pnpm Workspaces](https://pnpm.io/workspaces)

### Support
- GitHub Issues: Create new issue with template
- Development Chat: Internal team channels
- Documentation: Check existing docs first