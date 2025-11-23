# Al Ummah Now - Task Completion Checklist

## MANDATORY 10-Step Development Workflow

**CRITICAL**: This checklist MUST be followed for ALL development work. See `BEFORE YOU CODE.MD` for complete details.

---

## Step 1: LOG EVERYTHING ✅

Before starting any work, ensure logging is properly set up.

### Checklist
- [ ] Using centralized logger (`@/lib/logger` or `@/lib/logger-client`)
- [ ] NO `console.log`, `console.error`, or console methods anywhere
- [ ] All important operations are logged with context
- [ ] Log viewer is accessible at http://localhost:3089/
- [ ] Logs include structured data (userId, videoId, error objects, etc.)

### Example
```typescript
// ✅ Correct
import { logger } from '@/lib/logger';
logger.info('Video created', { videoId, userId, channelId });
logger.error('Failed to create video', { error, userId });

// ❌ Wrong
console.log('Video created');
console.error('Failed to create video', error);
```

---

## Step 2: TDD (Test-Driven Development) ✅

Write tests BEFORE implementing features.

### Checklist
- [ ] Failing test written first (RED)
- [ ] Minimal code to pass test (GREEN)
- [ ] Code refactored while keeping tests passing (REFACTOR)
- [ ] All new features have test coverage
- [ ] Edge cases are tested

### TDD Cycle
```typescript
// 1. RED - Write failing test
it('should calculate discount for premium users', () => {
  expect(calculateDiscount(100, 'premium')).toBe(90);
});

// 2. GREEN - Implement minimal code
function calculateDiscount(price: number, type: string) {
  return type === 'premium' ? price * 0.9 : price;
}

// 3. REFACTOR - Improve implementation
function calculateDiscount(price: number, type: UserType) {
  const discounts: Record<UserType, number> = {
    premium: 0.1,
    regular: 0,
  };
  return price * (1 - discounts[type]);
}
```

---

## Step 3: BUILD Early and Often ✅

Catch TypeScript errors before they accumulate.

### Checklist
- [ ] `pnpm build` runs successfully
- [ ] No TypeScript errors
- [ ] Shared types built first if changed
- [ ] Build tested for affected apps

### Commands
```bash
# Build all
pnpm build

# Build specific app
pnpm --filter @al-ummah/web build
pnpm --filter @al-ummah/api-videos build

# Build shared types (if modified)
pnpm --filter @al-ummah/shared-types build
```

---

## Step 4: RUN TESTS ✅

Ensure nothing is broken.

### Checklist
- [ ] All tests pass: `pnpm test`
- [ ] New tests added for new features
- [ ] No skipped or disabled tests (unless documented)
- [ ] Test coverage maintained or improved

### Commands
```bash
# Run all tests
pnpm test

# Run tests for specific app
pnpm --filter @al-ummah/processor test

# Watch mode during development
pnpm --filter @al-ummah/api-videos test:watch

# Coverage report
pnpm test:coverage
```

---

## Step 5: DEBUG ISSUES SYSTEMATICALLY ✅

Fix issues using proper debugging workflow.

### Checklist
- [ ] Logs checked in log viewer (http://localhost:3089/)
- [ ] Additional logging added if needed
- [ ] Issue reproduced consistently
- [ ] Root cause identified (not just symptoms)
- [ ] Fix verified with tests
- [ ] All tests passing after fix

### Debugging Process
1. Check logs in viewer
2. Add more structured logging if needed
3. Reproduce the issue
4. Identify root cause
5. Implement fix
6. Verify with tests
7. Remove debug logging if temporary

---

## Step 6: RESEARCH ✅

Search codebase before writing new code.

### Checklist
- [ ] Searched for existing similar implementations
- [ ] Reviewed documentation for patterns
- [ ] Checked for reusable utilities/components
- [ ] Verified no duplicate functionality being created
- [ ] Reviewed related features for consistency

### Search Commands
```bash
# Search for function/component
grep -r "function processVideo" apps/
rg "processVideo" --type ts

# Find files
find apps/web/src -name "*Video*"

# Search in specific app
cd apps/api-videos && grep -r "repository" src/
```

---

## Step 7: CHECK CODEBASE & DOCUMENTATION ✅

Prefer editing over creating.

### Checklist
- [ ] Checked if component/function already exists
- [ ] Reviewed existing patterns in codebase
- [ ] PREFER editing existing files over creating new ones
- [ ] No duplicate components/utilities created
- [ ] Followed established conventions
- [ ] No TODO comments added (create GitHub issues instead)

### Guidelines
- ✅ Edit existing files
- ✅ Reuse existing patterns
- ✅ Create GitHub issues for future work
- ❌ Create duplicate files
- ❌ Add TODO comments
- ❌ Hardcode user-facing strings

---

## Step 8: PULL, COMMIT, PUSH ✅

Proper git workflow.

### Checklist
- [ ] Pulled latest changes: `git pull origin main`
- [ ] All changes staged: `git add .`
- [ ] Conventional commit message used
- [ ] Committed: `git commit -m "type(scope): description"`
- [ ] Pushed: `git push origin branch-name`
- [ ] No merge conflicts

### Commit Message Format
```bash
# Format
<type>(<scope>): <description>

# Examples
git commit -m "feat(web): add video upload feature"
git commit -m "fix(api): resolve authentication bug"
git commit -m "docs(processor): update message handler docs"
git commit -m "refactor(web): improve video player performance"
git commit -m "test(api): add unit tests for video repository"
git commit -m "chore(deps): update dependencies"
```

**Types**: feat, fix, docs, style, refactor, test, chore

---

## Step 9: REVIEW CODE ✅

Self-review before opening PR.

### Checklist
- [ ] All tests pass
- [ ] TypeScript type checks pass: `pnpm type-check`
- [ ] Linting passes (or warnings justified): `pnpm lint`
- [ ] Bilingual support verified (EN/AR routes)
- [ ] RTL layout tested for Arabic
- [ ] All user-facing text uses i18n
- [ ] Centralized logger used (no console methods)
- [ ] No TODO comments
- [ ] No hardcoded strings
- [ ] Error handling implemented
- [ ] Code follows project conventions
- [ ] Unnecessary files removed
- [ ] Sensitive data not committed

### Bilingual Testing
```bash
# Test both routes
# English: http://localhost:3001/en/videos
# Arabic: http://localhost:3001/ar/videos

# Verify i18n usage
grep -r "hardcoded text" apps/web/src/components/  # Should find none
```

---

## Step 10: OPEN PRs ✅

Create pull request with proper documentation.

### Checklist
- [ ] Clear, descriptive PR title
- [ ] Detailed description of changes
- [ ] Linked related issues: "Fixes #123" or "Closes #456"
- [ ] Screenshots included (for UI changes)
- [ ] Testing instructions provided
- [ ] All CI checks passing
- [ ] Reviewers assigned
- [ ] Labels added (if applicable)
- [ ] No merge conflicts

### PR Template Example
```markdown
## Summary
Brief description of what this PR does.

## Related Issues
Fixes #123
Relates to #456

## Changes Made
- Added video upload feature
- Implemented progress tracking
- Added bilingual support for upload UI

## Testing Instructions
1. Start dev server: `pnpm dev`
2. Navigate to `/en/upload`
3. Upload a test video
4. Verify progress indicator
5. Test in `/ar/upload` for RTL

## Screenshots
[Include screenshots for UI changes]

## Checklist
- [x] All tests pass
- [x] Type check passes
- [x] Bilingual support tested
- [x] Logs use centralized logger
- [x] No TODO comments
- [x] i18n used for all text
```

### PR Commands
```bash
# Create PR using GitHub CLI
gh pr create --title "feat(web): add video upload" --body "Description"

# View PR status
gh pr view

# Add label for preview deployment
gh pr edit --add-label deploy-preview
```

---

## Additional Verification Checklist

### Before Every Commit
- [ ] `pnpm type-check` ✅
- [ ] `pnpm lint` ✅
- [ ] `pnpm test` ✅
- [ ] `pnpm build` ✅

### Code Quality
- [ ] No `console.log` or console methods
- [ ] No TODO comments
- [ ] No hardcoded strings (use i18n)
- [ ] Proper error handling
- [ ] Centralized logger used
- [ ] TypeScript strict mode compliance

### Bilingual Requirements (Web App)
- [ ] All text uses `t('key')` from `useLanguage()`
- [ ] Both `/en/*` and `/ar/*` routes work
- [ ] RTL layout correct for Arabic
- [ ] Translations added to both en.ts and ar.ts
- [ ] Date/number formatting locale-aware

### Security
- [ ] No sensitive data in logs
- [ ] No credentials committed
- [ ] JWT validation where required
- [ ] Input validation implemented
- [ ] CORS configured properly

### Performance
- [ ] No unnecessary re-renders
- [ ] Images optimized
- [ ] Code splitting used where appropriate
- [ ] R2 calls minimized
- [ ] Caching implemented where beneficial

---

## Emergency Rollback Procedure

If something breaks in production:

1. **Immediate**: Revert deployment
   ```bash
   # Revert to previous version
   git revert HEAD
   git push origin main
   ```

2. **Investigate**: Check logs
   ```bash
   # View production logs
   cd apps/api-videos
   pnpm wrangler tail
   ```

3. **Fix**: Create hotfix branch
   ```bash
   git checkout -b hotfix/fix-critical-bug
   # Make fix
   git commit -m "fix: critical bug description"
   git push origin hotfix/fix-critical-bug
   ```

4. **Deploy**: Fast-track to production
   ```bash
   # After PR approval
   pnpm web:deploy:production
   pnpm api:deploy
   ```

---

## GitHub Issues Workflow

### CRITICAL RULES for Closing Issues

**NEVER close an issue until ALL of the following are complete**:

### Checklist Before Closing Issue
- [ ] All code is committed to git
- [ ] All commits are pushed to GitHub
- [ ] Code is merged to target branch (main or feature branch)
- [ ] All acceptance criteria in the issue are met
- [ ] All tests pass
- [ ] Changes deployed (if applicable)

### Verification Commands
```bash
# Verify before closing issue
git status                    # Should be clean
git log --oneline -5          # Verify commits exist
git push --dry-run            # Should say "Everything up-to-date"
gh issue view <number>        # Review acceptance criteria
```

### Correct Workflow
```bash
# ✅ CORRECT
git add .
git commit -m "feat: implement feature from issue #45"
git push
git status  # Clean
git log --oneline -1  # Verify commit
gh issue close 45 --comment "Completed and pushed in commit abc123"
```

### WRONG Workflow
```bash
# ❌ WRONG - Code only in stash
git stash push -m "Work on issue #45"
gh issue close 45  # NEVER DO THIS!
```

### Stashed Work
- ✅ Use stash for: Temporary context switching
- ❌ Never use stash for: Completed features, closing issues
- If work is stashed: Apply it, commit it, push it, THEN close issue

---

## Summary: Quick Validation Before PR

Run this checklist before every PR:

```bash
# 1. Pull latest
git pull origin main

# 2. Type check
pnpm type-check

# 3. Lint
pnpm lint

# 4. Build
pnpm build

# 5. Test
pnpm test

# 6. Verify bilingual support (web)
# Test both /en/* and /ar/* routes

# 7. Commit
git add .
git commit -m "type(scope): description"
git push

# 8. Open PR
gh pr create

# 9. Verify CI passes
gh pr view
```

**If ANY step fails, DO NOT proceed. Fix the issue first.**

---

## Remember

- 🔴 **NO console.log** - use centralized logger
- 🔴 **NO TODO comments** - create GitHub issues
- 🔴 **NO hardcoded strings** - use i18n
- ✅ **ALWAYS** write tests first (TDD)
- ✅ **ALWAYS** build before committing
- ✅ **ALWAYS** verify bilingual support
- ✅ **ALWAYS** use pnpm (never npm/yarn)
- ✅ **ALWAYS** follow conventional commits
