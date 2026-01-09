# BEFORE YOU CODE

## Development Process for Al Ummah Now Repository

Follow this process for ALL development work in this repository. **DO NOT skip steps.**

---

## 1. LOG EVERYTHING

- Add comprehensive console logging at key points
- **Log to file locally** for debugging and analysis
- Log function entry/exit points
- Log important variables and state changes
- Log errors with full context (stack traces, input data)
- Use structured logging with clear prefixes:
  ```typescript
  console.log('[ComponentName] Action: details');
  console.error('[ComponentName] Error:', error);
  ```
- **Local Development**: Logs written to console/terminal for debugging
- **Production**: Cloudflare handles all production logging
- **Enhanced Logging**: Use JSON.stringify for complex objects (see CustomVideoPlayer.tsx:211, analytics/video/route.ts:16-32)

---

## 2. TDD (Test-Driven Development)

**Write tests BEFORE writing implementation code.**

### TDD Cycle:
1. **RED**: Write a failing test
2. **GREEN**: Write minimal code to make it pass
3. **REFACTOR**: Clean up code while keeping tests green

### Test Structure:
- Processor tests: `apps/processor/src/__tests__/`
- API tests: `apps/api-videos/src/tests/`
- Web tests: `apps/web/src/__tests__/` (if applicable)
- Follow existing test patterns in the codebase
- Use descriptive test names: `should [expected behavior] when [condition]`

### Running Tests:
```bash
# Test specific app
pnpm --filter @al-ummah/processor test
pnpm --filter @al-ummah/api-videos test

# Type check all apps
pnpm type-check
```

---

## 3. BUILD

Always build the project to catch TypeScript errors:

```bash
# Build all packages
pnpm build

# Build specific app
pnpm --filter @al-ummah/web build
pnpm --filter @al-ummah/api-videos build
pnpm --filter @al-ummah/shared-types build  # Build this FIRST before other apps

# Type check without building
pnpm type-check

# Type check specific app
pnpm --filter @al-ummah/web type-check
```

Fix ALL build errors before proceeding.

**IMPORTANT:** Always build `@al-ummah/shared-types` first before building other apps.

---

## 4. RUN TESTS

Run the test suite to ensure nothing is broken:

```bash
# Type check all apps
pnpm type-check

# Lint all apps
pnpm lint

# Run tests for specific apps
pnpm --filter @al-ummah/processor test
pnpm --filter @al-ummah/api-videos test
```

**All tests must pass before committing.**

---

## 5. DEBUG ISSUES SYSTEMATICALLY

**When encountering bugs or errors, follow this debugging process:**

### Debugging Workflow:

1. **Check Logs First**
   - Review console/terminal output from dev servers
   - Check browser console for frontend errors
   - Look for error patterns and stack traces
   - Use structured log prefixes to filter: `[ComponentName]`, `[Analytics]`, `[Error]`

2. **If Logs Are Insufficient, Add More Logging**
   - Add comprehensive logging at key decision points
   - Log function entry/exit with parameters
   - Log state changes and variable values
   - Use JSON.stringify for complex objects:
     ```typescript
     console.error('[ComponentName] Error Details:', JSON.stringify(error, null, 2));
     ```

3. **Ensure Logs Are Reachable and Actionable**
   - **Local Development**: Logs go to console/terminal (can redirect to files for analysis)
   - **Production**: Use Cloudflare Workers logs, Workers Analytics, or third-party services
   - Logs must contain enough context to reproduce and fix issues
   - Include: timestamp, component name, action, input data, error details, stack traces

4. **Fix Until All Tests Pass**
   - **No exceptions**: All tests must pass, no matter the reason for failure
   - If a test fails, fix the underlying issue (don't skip, comment out, or disable tests)
   - If test is flaky, fix the flakiness (don't just re-run)
   - If test is outdated, update the test and implementation together

5. **Ensure All Apps Run Without Errors**
   - **Development standard**: `pnpm dev` should run all apps cleanly with zero errors
   - Fix all TypeScript errors: `pnpm type-check` must pass
   - Fix all linting errors: `pnpm lint` must pass
   - If dev servers show errors, fix them before committing
   - Common errors to watch for:
     - R2 bucket connection failures (restart dev servers)
     - TypeScript compilation errors
     - Missing environment variables
     - Port conflicts
     - CORS issues

### Debugging Checklist:
- [ ] Logs reviewed and error identified
- [ ] Additional logging added if needed (with structured prefixes)
- [ ] Logs are reachable and contain actionable context
- [ ] Root cause identified (not just symptoms)
- [ ] Fix implemented and tested
- [ ] All tests pass: `pnpm type-check` and `pnpm lint`
- [ ] All dev servers run without errors: `pnpm dev`
- [ ] No error messages in console/terminal
- [ ] Enhanced logging left in place (don't remove debugging logs that add value)

### Common Debugging Scenarios:

**R2 Bucket Connection Errors:**
```bash
# Symptom: "R2 error response does not contain the CF-R2-Error header"
# Fix: Restart dev servers
pnpm dev  # Kill and restart all servers
```

**Browser Cache Issues:**
```bash
# Symptom: Code changes not reflected in browser
# Fix: Hard refresh to clear cache
# Ctrl+Shift+R (Linux/Windows) or Cmd+Shift+R (Mac)
```

**Environment Binding Errors:**
```typescript
// Symptom: "Cannot read property 'videos' of undefined"
// Fix: Use c.env instead of env
const bucket = c.env.videos;  // ✅ CORRECT
```

**WebSocket Connection Failures:**
```bash
# Symptom: "Connection reset by peer" or "Broken pipe"
# Fix: These are normal disconnections, not errors to fix
# Only fix if they prevent functionality
```

---

## 6. RESEARCH, RESEARCH, RESEARCH

Before writing ANY new code:

### Research Checklist:
- [ ] Search the codebase for existing implementations
- [ ] Check documentation in root `CLAUDE.md` and app-specific docs:
  - `apps/api-videos/CLAUDE.md` - API backend guide
  - `apps/processor/README.md` - Processor documentation
  - `apps/websocket-server/README.md` - WebSocket server docs
  - `.github/CLAUDE.md` - Legacy web app documentation
- [ ] Review similar patterns in the codebase
- [ ] Look for existing utilities/helpers in `apps/*/src/lib/`
- [ ] Check shared types in `packages/shared-types/src/`
- [ ] Check test files for usage examples
- [ ] Read related issues/PRs in GitHub
- [ ] Review error logs from dev servers
- [ ] Check CI/CD workflow: `.github/workflows/deploy.yml`

**If unsure, ASK. Don't guess.**

---

## 7. CHECK CODEBASE & DOCUMENTATION BEFORE WRITING NEW CODE

### Before Creating New Files:
1. Search for existing files that might do similar things
2. Check if the functionality exists elsewhere
3. Review the monorepo structure to understand where new code belongs:
   - `apps/web/` - Next.js frontend
   - `apps/api-videos/` - Hono API backend
   - `apps/processor/` - Queue consumer
   - `apps/websocket-server/` - WebSocket server
   - `packages/shared-types/` - Shared TypeScript types

### Before Writing New Functions:
1. Search for similar functions in the codebase
2. Check utility files: `apps/*/src/lib/`
3. Review type definitions in `packages/shared-types/src/`
4. Check if shared types need updating

### Code Reuse Priorities:
1. **ALWAYS** prefer editing existing files over creating new ones
2. **ALWAYS** prefer using existing utilities over writing new ones
3. **ALWAYS** follow established patterns in the codebase
4. **ALWAYS** use shared types from `@al-ummah/shared-types`

---

## 8. PULL, COMMIT, PUSH

### Before Starting Work:
```bash
git pull origin main
```

### After Making Changes:
```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "type(scope): description

- Detailed bullet point 1
- Detailed bullet point 2

Fixes #issue-number (if applicable)"

# Push to branch
git push origin <branch-name>
```

### Commit Message Format:
- `feat(web):` New feature in web app
- `feat(api):` New feature in api-videos
- `feat(processor):` New feature in processor
- `feat(websocket):` New feature in websocket-server
- `fix(web):` Bug fix in web app
- `refactor(api):` Code refactoring in api-videos
- `test(processor):` Adding/updating tests in processor
- `docs:` Documentation changes
- `chore:` Maintenance tasks
- `build:` Build system or dependency changes

### Scope Examples:
- `feat(web): add video quality selector`
- `fix(api): correct videoList env binding`
- `refactor(processor): improve error handling`
- `docs: update CLAUDE.md with new patterns`

---

## 9. REVIEW CODE

Before opening a PR, perform self-review:

### Code Review Checklist:
- [ ] Code follows existing patterns and style
- [ ] All console.log statements are meaningful (not debug leftovers)
- [ ] No commented-out code
- [ ] **NO TODO comments** - Create issues instead (CRITICAL: see CLAUDE.md TODO Comments Policy)
- [ ] Type safety maintained (no `any` types without justification)
- [ ] Error handling is comprehensive
- [ ] Edge cases are handled
- [ ] Performance implications considered
- [ ] Security implications considered (especially for auth, file uploads, video streaming)
- [ ] Cloudflare Workers patterns followed correctly:
  - Use `c.env.bindingName` not `env.bindingName`
  - Proper R2, KV, Queue, Durable Objects usage
  - OpenAuth JWT validation configured correctly
- [ ] Bilingual support maintained (EN/AR, LTR/RTL) for web app
- [ ] Shared types updated if data models changed

---

## 10. OPEN PRs

### PR Requirements:
- Descriptive title following commit message format
- Clear description of what changed and why
- Link to related issues
- Screenshots/videos for UI changes
- Test results included
- All CI checks passing
- Label with `deploy-preview` if you want preview deployments

### PR Preview Deployments:
By default, PR previews are **disabled**. To deploy previews:
1. Add `deploy-preview` label to your PR
2. Wait for GitHub Actions to deploy:
   - Web: `al-ummah-web-pr-{number}.workers.dev`
   - API: `al-ummah-api-pr-{number}.workers.dev`
   - Processor: `al-ummah-processor-pr-{number}`
   - WebSocket: `al-ummah-comms-pr-{number}.workers.dev`

### PR Template:
```markdown
## Description
[What does this PR do?]

## Motivation
[Why is this change needed?]

## Changes
- Change 1
- Change 2

## Apps Affected
- [ ] web (Next.js frontend)
- [ ] api-videos (Hono API)
- [ ] processor (Queue consumer)
- [ ] websocket-server (WebSocket server)
- [ ] shared-types (TypeScript types)

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed
- [ ] All tests passing
- [ ] Type checking passes: `pnpm type-check`
- [ ] Build succeeds: `pnpm build`

## Related Issues
Fixes #[issue-number]

## Screenshots
[If applicable]

## Deployment Notes
[Any special deployment considerations]
```

---

## Environment Notes

- **Package Manager**: This is a **pnpm monorepo**. Always use `pnpm`, never `npm` or `yarn`
- **Build System**: Turborepo v2 with caching
- **Local Development**:
  - Dev servers log to console
  - Web: http://localhost:3000
  - API: http://127.0.0.1:3086
  - Processor: http://127.0.0.1:3088
  - WebSocket: http://127.0.0.1:3087
- **Production**: Cloudflare Workers handles all production logging and infrastructure
- **No TODOs in code**: Create GitHub issues instead of leaving TODO comments (see CLAUDE.md)

---

## Quick Reference

```bash
# Complete development workflow

# 1. Pull latest
git pull origin main

# 2. Create branch
git checkout -b feat/my-feature

# 3. Install dependencies (if needed)
pnpm install

# 4. Build shared types FIRST
pnpm --filter @al-ummah/shared-types build

# 5. Start dev servers
pnpm dev  # All apps in parallel
# OR
pnpm web:dev      # Web only
pnpm api:dev      # API only
pnpm processor:dev  # Processor only
pnpm websocket:dev  # WebSocket only

# 6. Make changes and write tests (TDD)

# 7. Type check
pnpm type-check

# 8. Lint
pnpm lint

# 9. Run tests
pnpm --filter @al-ummah/processor test

# 10. Build
pnpm build

# 11. Commit
git add .
git commit -m "feat(api): add feature description"

# 12. Push
git push origin feat/my-feature

# 13. Open PR on GitHub
# 14. Add 'deploy-preview' label if you want preview deployment
```

---

## Monorepo-Specific Commands

```bash
# Install dependencies for all apps
pnpm install

# Run command in specific app
pnpm --filter @al-ummah/web <command>
pnm --filter @al-ummah/api-videos <command>
pnpm --filter @al-ummah/processor <command>
pnpm --filter @al-ummah/websocket-server <command>
pnpm --filter @al-ummah/shared-types <command>

# Dev servers
pnpm dev           # All apps
pnpm web:dev       # Web app only
pnpm api:dev       # API only
pnpm processor:dev # Processor only
pnpm websocket:dev # WebSocket only

# Build
pnpm build                                    # All apps
pnpm --filter @al-ummah/shared-types build    # Shared types (build first!)
pnpm --filter @al-ummah/web build             # Web app

# Type checking
pnpm type-check    # All apps

# Linting
pnpm lint          # All apps

# Deployment
pnpm web:deploy:production   # Deploy web to production
pnpm api:deploy              # Deploy API to production
pnpm processor:deploy        # Deploy processor to production
pnpm websocket:deploy        # Deploy WebSocket to production

# Wrangler commands (Cloudflare Workers)
cd apps/api-videos
pnpm wrangler login
pnpm wrangler deploy --dry-run  # Test deployment

# Restart TypeScript server in VS Code
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

## Common Violations to AVOID

❌ **DON'T:**
- Write code before tests
- Skip the build step
- Commit without running tests and type checking
- Create new files without checking for existing ones
- Use `npm` or `yarn` (this is a pnpm monorepo!)
- Push directly to main
- Skip code review
- Leave debug logging in production code
- Ignore TypeScript errors
- Guess at implementation without research
- Add TODO comments (create GitHub issues instead - see CLAUDE.md)
- Use `env.bindingName` in Cloudflare Workers (use `c.env.bindingName`)
- Forget to build shared-types before other apps
- Cancel long-running builds (especially web app - can take up to 120 min)
- Break bilingual support (EN/AR, LTR/RTL)

✅ **DO:**
- Follow the 10-step process
- Keep tests green
- Review your own code
- Ask questions when unsure
- Document your changes
- Follow established patterns
- Add meaningful logs with structured prefixes
- Fix all warnings
- Create GitHub issues for future work
- Use pnpm for all package management
- Build shared-types first
- Test both English and Arabic routes in web app
- Use Cloudflare Workers patterns correctly
- Restart dev servers if R2 connections fail
- Use hard refresh (Ctrl+Shift+R) to clear browser cache when testing frontend changes

---

## Critical Patterns for This Codebase

### 1. Cloudflare Workers Bindings
```typescript
// ❌ WRONG
const bucket = env.videos;

// ✅ CORRECT
const bucket = c.env.videos;
```

### 2. Shared Types
```typescript
// ✅ Always import from shared-types
import { VideoObject } from '@al-ummah/shared-types';
```

### 3. Bilingual Support (Web App)
```typescript
// ✅ Create both LTR and RTL versions
// apps/web/src/components/MyComponent/index.tsx (LTR)
// apps/web/src/components/MyComponent/rtl/index.tsx (RTL)
```

### 4. API Endpoints with OpenAPI
```typescript
// ✅ Use addAuthToSchema helper
import { addAuthToSchema } from "../../lib/openapi-auth";

export class MyEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    // ... your schema
  }, 'required'); // 'required' | 'optional' | 'public'
}
```

### 5. Error Logging
```typescript
// ✅ Use JSON.stringify for complex objects
console.error('[ComponentName] Error Details:', JSON.stringify(error, null, 2));
```

---

## Architecture Decision Records (ADRs)

For significant architectural decisions:
1. Document in `docs/architecture/` or app-specific docs
2. Include problem statement, proposed solution, alternatives considered
3. See `docs/architecture/VIDEO_STREAMING_PROXY_PLAN.md` for example

---

**Remember: Quality > Speed. Take time to do it right the first time.**

**This is a pnpm monorepo with Turborepo orchestration. Always use pnpm, never npm.**
