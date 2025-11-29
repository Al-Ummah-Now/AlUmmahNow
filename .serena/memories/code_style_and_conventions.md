# Al Ummah Now - Code Style and Conventions

## CRITICAL: BEFORE YOU CODE

**MANDATORY**: Read and follow `BEFORE_YOU_CODE.md` for the complete 10-step development workflow.

## Mandatory Development Process

### 1. LOG EVERYTHING

**CRITICAL**: Use ONLY centralized logger libraries. NEVER use `console.log`, `console.error`, or any console methods.

#### Server-Side Logging (API, Processor, WebSocket)
```typescript
import { logger } from '@/lib/logger';

logger.info('Video created', { videoId, userId, channelId });
logger.error('Failed to process queue message', { error, messageId });
logger.warn('Rate limit approaching', { userId, requestCount });
logger.debug('Cache hit', { key, ttl });
```

#### Client-Side Logging (Web App)
```typescript
import { logger } from '@/lib/logger-client';

logger.info('Page viewed', { route, userId });
logger.error('API request failed', { endpoint, status, error });
logger.warn('Slow network detected', { latency });
```

#### Viewing Logs
- **Web Viewer**: http://localhost:3089/viewer/viewer.html (recommended)
- **Real-time SSE**: `curl -N http://localhost:3089/logs/stream/realtime`
- **Filtered**: `curl -N "http://localhost:3089/logs/stream/realtime?level=error&app=api-videos"`

### 2. TDD (Test-Driven Development)

**MANDATORY**: Write tests BEFORE implementation.

#### Process
1. Write a failing test first (RED)
2. Implement minimal code to pass (GREEN)
3. Refactor while keeping tests passing (REFACTOR)

#### Example
```typescript
// 1. RED - Write failing test
describe('calculateDiscount', () => {
  it('should apply 10% discount for premium users', () => {
    expect(calculateDiscount(100, 'premium')).toBe(90);
  });
});

// 2. GREEN - Implement minimal code
function calculateDiscount(price: number, userType: string) {
  if (userType === 'premium') return price * 0.9;
  return price;
}

// 3. REFACTOR - Improve code quality
function calculateDiscount(price: number, userType: UserType) {
  const discounts: Record<UserType, number> = {
    premium: 0.1,
    regular: 0,
  };
  return price * (1 - discounts[userType]);
}
```

### 3. BUILD Early and Often

```bash
# Build all packages
pnpm build

# Build specific app
pnpm --filter @al-ummah/web build
pnpm --filter @al-ummah/api-videos build
```

**Rationale**: Catch TypeScript errors early before they accumulate.

### 4. RUN TESTS

```bash
# Run all tests
pnpm test

# Run tests for specific app
pnpm --filter @al-ummah/processor test

# Watch mode during development
pnpm --filter @al-ummah/api-videos test:watch
```

### 5. DEBUG SYSTEMATICALLY

When errors occur:
1. **Check logs** - Use log viewer at http://localhost:3089/
2. **Add more logging** if needed
3. **Reproduce** the issue
4. **Fix** the root cause
5. **Verify** all tests pass

### 6. RESEARCH

Before writing new code:
1. **Search codebase** for existing implementations
2. **Check documentation** for patterns and conventions
3. **Review similar features** to maintain consistency

```bash
# Search for existing implementations
grep -r "function processVideo" apps/
```

### 7. CHECK CODEBASE & DOCUMENTATION

**ALWAYS prefer editing existing files over creating new ones.**

- Check if a similar component/function exists
- Reuse existing patterns and utilities
- Update existing files instead of creating duplicates

### 8. PULL, COMMIT, PUSH

#### Git Workflow
```bash
# Always pull before starting work
git pull origin main

# Make changes, then commit
git add .
git commit -m "feat(web): add video upload feature"

# Push to remote
git push origin your-branch
```

#### Commit Message Format (Conventional Commits)
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**: feat, fix, docs, style, refactor, test, chore

**Examples**:
```bash
git commit -m "feat(api): add video search endpoint"
git commit -m "fix(web): resolve RTL layout issue in video player"
git commit -m "docs(processor): update message handler documentation"
git commit -m "refactor(api): improve R2 repository performance"
```

### 9. REVIEW CODE

Before opening PR:
- ✅ All tests pass
- ✅ TypeScript type checks pass
- ✅ Linting passes (or warnings are justified)
- ✅ Bilingual support verified (EN/AR)
- ✅ Logs use centralized logger
- ✅ No TODO comments
- ✅ i18n used for all user-facing text

### 10. OPEN PRs

PR must include:
- Clear title and description
- Link to related issue(s)
- Screenshots (for UI changes)
- Testing instructions
- All CI checks passing

## Code Quality Standards

### TODO Comments Policy

**PROHIBITED**: Never add TODO comments to code.

❌ **WRONG**:
```typescript
// TODO: Add input validation
function processData(data: any) {
  return data;
}
```

✅ **CORRECT**:
```typescript
// Option 1: Implement it now
function processData(data: DataType) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data');
  }
  return data;
}

// Option 2: Create GitHub issue and document
// Note: Caching will be implemented in Phase 2 (see issue #123)
function fetchData() {
  return fetch('/api/data');
}
```

### Internationalization (i18n)

**MANDATORY**: Use i18n for ALL user-facing text.

#### Server-Side (API)
```typescript
import { t } from '@/lib/i18n';

return c.json({
  success: false,
  error: t('errors.video_not_found'),
  details: t('errors.video_not_found_description', { videoId })
});
```

#### Client-Side (React)
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

❌ **NEVER hardcode strings**:
```typescript
<h1>Featured Videos</h1>  // WRONG
return c.json({ error: 'Video not found' });  // WRONG
```

### TypeScript Standards

#### Strict Type Safety
- Enable strict mode in tsconfig.json
- No `any` types (use `unknown` if necessary)
- Explicit return types for functions
- Interface over type for object shapes

#### Example
```typescript
// ✅ Good
interface VideoData {
  id: string;
  title: string;
  views: number;
}

function getVideo(id: string): Promise<VideoData> {
  // implementation
}

// ❌ Bad
function getVideo(id: any): any {
  // implementation
}
```

### File Organization

#### Component Structure (Web App)
```
components/
├── VideoPlayer/
│   ├── index.tsx          # LTR version (default)
│   ├── rtl/
│   │   └── index.tsx      # RTL version for Arabic
│   ├── types.ts           # Component-specific types
│   └── __tests__/
│       └── VideoPlayer.test.tsx
```

#### API Endpoint Structure
```
endpoints/
├── videos/
│   ├── create.ts          # POST /videos
│   ├── get.ts             # GET /videos/:id
│   ├── list.ts            # GET /videos
│   ├── update.ts          # PUT /videos/:id
│   └── delete.ts          # DELETE /videos/:id
```

### Naming Conventions

#### Files
- **Components**: PascalCase (e.g., `VideoPlayer.tsx`)
- **Utilities**: camelCase (e.g., `formatDate.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_ENDPOINTS.ts`)
- **Tests**: `*.test.ts` or `*.spec.ts`

#### Variables and Functions
- **Variables**: camelCase (e.g., `videoCount`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_UPLOAD_SIZE`)
- **Functions**: camelCase (e.g., `getUserById`)
- **Classes**: PascalCase (e.g., `VideoRepository`)
- **Interfaces**: PascalCase (e.g., `VideoObject`)
- **Types**: PascalCase (e.g., `UserRole`)

### Cloudflare Workers Patterns

#### Accessing Bindings
**ALWAYS** use `c.env.bindingName` (not `env.bindingName`).

```typescript
// ✅ Correct
export default {
  async fetch(request, env, ctx) {
    const app = new Hono<{ Bindings: Env }>();
    
    app.get('/videos/:id', async (c) => {
      const bucket = c.env.BUCKET;  // Correct
      const object = await bucket.get(key);
    });
  }
}

// ❌ Wrong
app.get('/videos/:id', async (c) => {
  const object = await env.BUCKET.get(key);  // Wrong - env not in scope
});
```

#### Environment Variables
```typescript
// Define bindings in wrangler.toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "al-ummah-now-videos"

// Access in code
const bucket = c.env.BUCKET;
```

### Error Handling

#### API Responses
```typescript
// Success
return c.json({ 
  success: true, 
  data: video 
}, 200);

// Error
return c.json({ 
  success: false, 
  error: t('errors.video_not_found'),
  code: 'VIDEO_NOT_FOUND'
}, 404);
```

#### Try-Catch with Logging
```typescript
try {
  const video = await videoRepository.getById(id);
  logger.info('Video retrieved', { videoId: id });
  return video;
} catch (error) {
  logger.error('Failed to retrieve video', { videoId: id, error });
  throw error;
}
```

### Testing Conventions

#### Test File Location
- **Unit tests**: Same directory as code (`__tests__/`)
- **Integration tests**: `src/__tests__/integration/`
- **E2E tests**: `e2e/` (web app only)

#### Test Structure
```typescript
describe('VideoRepository', () => {
  describe('getById', () => {
    it('should return video when it exists', async () => {
      // Arrange
      const videoId = 'test-id';
      
      // Act
      const video = await repository.getById(videoId);
      
      // Assert
      expect(video).toBeDefined();
      expect(video.id).toBe(videoId);
    });

    it('should throw error when video does not exist', async () => {
      // Arrange & Act & Assert
      await expect(repository.getById('invalid-id'))
        .rejects
        .toThrow('Video not found');
    });
  });
});
```

## Package Management

### Use pnpm Exclusively
**NEVER use npm or yarn**. This is a pnpm monorepo.

```bash
# ✅ Correct
pnpm install
pnpm add hono
pnpm --filter @al-ummah/web add next@latest

# ❌ Wrong
npm install
yarn add hono
```

### Adding Dependencies

#### App-specific
```bash
pnpm --filter @al-ummah/web add package-name
pnpm --filter @al-ummah/api-videos add -D @types/package-name
```

#### Root devDependencies
```bash
pnpm add -D -w turbo
```

#### Workspace dependencies
```json
{
  "dependencies": {
    "@al-ummah/shared-types": "workspace:*"
  }
}
```

## Performance Best Practices

### R2 Storage
- Use batch operations when possible
- Implement caching for frequently accessed data
- Use appropriate object keys for efficient lookups

### Cloudflare Workers
- Keep response times under 50ms
- Use KV for fast key-value lookups
- Minimize R2 calls in hot paths

### Next.js
- Use Server Components by default
- Client Components only when needed (interactivity, hooks)
- Implement proper image optimization
- Use dynamic imports for code splitting

## Security Best Practices

### Authentication
- Always validate JWT tokens
- Check user permissions before operations
- Never expose sensitive data in logs

### Input Validation
- Use Zod schemas for all inputs
- Sanitize user-generated content
- Validate file uploads (type, size)

### CORS
```typescript
app.use('/*', cors({
  origin: ['https://alummahnow.net', 'https://www.alummahnow.net'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
```

## Documentation Standards

### Code Comments
- Explain "why", not "what"
- Document complex logic
- Add JSDoc for public APIs

```typescript
/**
 * Calculates trending score for a video based on views, likes, and recency.
 * 
 * Uses a decay factor to prioritize recent videos while considering engagement.
 * 
 * @param video - The video object to score
 * @param decayFactor - Time decay factor (default: 0.8)
 * @returns Trending score between 0 and 1
 */
function calculateTrendingScore(video: VideoObject, decayFactor = 0.8): number {
  // implementation
}
```

### API Documentation
- Use OpenAPI 3.1 specifications
- Document all endpoints in chanfana
- Include request/response examples
- Keep Swagger UI updated

## Build and Deployment

### Before Committing
```bash
# 1. Type check
pnpm type-check

# 2. Lint
pnpm lint

# 3. Build
pnpm build

# 4. Test
pnpm test
```

### Deployment Checklist
- ✅ All tests passing
- ✅ Type check passing
- ✅ Build succeeding
- ✅ Environment variables configured
- ✅ Wrangler configuration validated
- ✅ Preview deployment tested (if using deploy-preview label)
