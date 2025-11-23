# E2E Test User Setup - Playwright Storage State

This directory uses **Playwright Storage State** for automated test user registration and authentication.

## Overview

Instead of storing test credentials in `.env` files, we:
1. Register test users automatically via OpenAuth UI
2. Save authenticated sessions to JSON files in `e2e/.auth/`
3. Reuse saved sessions across all tests (no re-authentication needed)

## Benefits

✅ **Fully automated** - No manual user registration
✅ **Fresh tokens** - Generated per test run
✅ **Fast tests** - Authenticate once, reuse state
✅ **No token expiration issues** - Fresh users per run
✅ **Works in CI/CD** - Automated end-to-end

## Prerequisites

### 1. Resend API Key

Get your API key from [Resend](https://resend.com/api-keys) and set it as an environment variable:

```bash
export RESEND_API_KEY=re_xxxxxxxxxxxxx
```

Or create a `.env` file in the web app root:

```bash
# apps/web/.env
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

### 2. OpenAuth Server

Ensure the OpenAuth server is running:

```bash
# Default URL: http://localhost:3301
# Override with:
export OPENAUTH_URL=http://localhost:3301
```

### 3. Web App Server

The web app should be running:

```bash
# Default URL: http://localhost:3001
# Override with:
export WEB_APP_URL=http://localhost:3001
```

## Architecture

```
Test Suite Start
    ↓
Global Setup (auth.setup.ts)
    ↓
Register 3 Test Users via OpenAuth UI
    ├─ test-single-{timestamp}@delivered.resend.dev
    ├─ test-multi-{timestamp}@delivered.resend.dev
    └─ test-none-{timestamp}@delivered.resend.dev
    ↓
Save Authentication State to Files
    ├─ e2e/.auth/user-single.json
    ├─ e2e/.auth/user-multi.json
    └─ e2e/.auth/user-none.json
    ↓
Tests Reuse Auth State (No Re-login)
```

## Test Users

Three test users are created for different scenarios:

### 1. Single Channel User
- **Email**: `test-single-{timestamp}@delivered.resend.dev`
- **Password**: `TestPassword123!`
- **Storage State**: `e2e/.auth/user-single.json`
- **Use Case**: Tests for users with one channel

### 2. Multi Channel User
- **Email**: `test-multi-{timestamp}@delivered.resend.dev`
- **Password**: `TestPassword456!`
- **Storage State**: `e2e/.auth/user-multi.json`
- **Use Case**: Tests for users with multiple channels

### 3. No Channels User
- **Email**: `test-none-{timestamp}@delivered.resend.dev`
- **Password**: `TestPassword789!`
- **Storage State**: `e2e/.auth/user-none.json`
- **Use Case**: Tests for users without any channels

## Usage in Tests

### Option 1: Use Project-Specific Storage State

Tests automatically use the authenticated state based on the project they run in:

```typescript
import { test, expect } from '@playwright/test';

// This test will run with each user type (single/multi/none)
test('dashboard should display videos', async ({ page }) => {
  // User is ALREADY authenticated - no setup needed!
  await page.goto('/en/dashboard/videos');

  // Your test code here...
});
```

### Option 2: Explicitly Specify Storage State

Override storage state for specific test suites:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Single Channel Tests', () => {
  // Run ONLY with single-channel user
  test.use({ storageState: 'e2e/.auth/user-single.json' });

  test('should display all videos for owner', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    // User is authenticated as single-channel user
  });
});

test.describe('Multi Channel Tests', () => {
  // Run ONLY with multi-channel user
  test.use({ storageState: 'e2e/.auth/user-multi.json' });

  test('should make single API call for all channels', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    // User is authenticated as multi-channel user
  });
});
```

### Option 3: Tests Without Authentication

For tests that don't need authentication, use standard projects:

```typescript
test.describe('Public Pages', () => {
  // Don't use storage state - user is not authenticated
  test('homepage should load', async ({ page }) => {
    await page.goto('/en');
    // No authentication
  });
});
```

## Running Tests

### Run All Tests (with automatic setup)

```bash
# Playwright automatically:
# 1. Runs global setup (registers users)
# 2. Saves auth states
# 3. Runs tests with authenticated sessions

pnpm test:e2e
```

### Run Specific Projects

```bash
# Run only single-channel user tests
npx playwright test --project=single-channel-user

# Run only multi-channel user tests
npx playwright test --project=multi-channel-user

# Run only no-channels user tests
npx playwright test --project=no-channels-user
```

### Run Specific Test Files

```bash
# Run specific test file with all user types
npx playwright test e2e/19-dashboard-videos-ownership.spec.ts

# Run specific test with specific user type
npx playwright test e2e/19-dashboard-videos-ownership.spec.ts --project=single-channel-user
```

### Debug Mode

Run global setup with visible browser for debugging:

1. Edit `e2e/auth.setup.ts`
2. Change `headless: true` to `headless: false`
3. Run tests

```typescript
const browser = await chromium.launch({
  headless: false, // See browser during registration
});
```

## Troubleshooting

### 1. "No verification email received"

**Cause**: Resend API didn't receive/send the verification email

**Solutions**:
- Check your Resend API key is valid
- Verify you have sending credits
- Check Resend dashboard for email status
- Increase timeout in `auth.setup.ts` (default: 10 attempts × 2 seconds)

### 2. "Failed to extract verification code"

**Cause**: Email HTML format doesn't match expected patterns

**Solutions**:
- Check the email template in OpenAuth
- Update regex patterns in `resend-client.ts`
- Save a screenshot (automatically saved to `e2e/.auth/error-{email}.png`)

### 3. "Authentication failed"

**Cause**: OpenAuth flow changed or selectors are outdated

**Solutions**:
- Run in debug mode (headless: false)
- Check browser screenshots in `e2e/.auth/`
- Update selectors in `auth.setup.ts`

### 4. "Tests still asking for authentication"

**Cause**: Storage state files not found or expired

**Solutions**:
- Delete `e2e/.auth/` directory
- Re-run tests to regenerate auth states
- Check file paths match in `playwright.config.ts`

### 5. CI/CD Environment

For GitHub Actions or other CI environments:

```yaml
# .github/workflows/e2e-tests.yml
env:
  RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
  OPENAUTH_URL: http://localhost:3301
  WEB_APP_URL: http://localhost:3001

steps:
  - name: Install dependencies
    run: pnpm install

  - name: Start services
    run: |
      pnpm web:dev &
      # Start OpenAuth server
      # Wait for servers to be ready

  - name: Run E2E tests
    run: pnpm test:e2e
```

## Files Structure

```
apps/web/e2e/
├── .auth/                          # Authentication state files (gitignored)
│   ├── user-single.json           # Single-channel user session
│   ├── user-multi.json            # Multi-channel user session
│   ├── user-none.json             # No-channels user session
│   └── error-*.png                # Debug screenshots (on failures)
├── test-utils/
│   └── resend-client.ts           # Resend API client helper
├── auth.setup.ts                   # Global setup for user registration
└── TEST_USER_SETUP_README.md      # This file
```

## Clean Up

### Remove Authentication State

```bash
# Delete all saved auth states (forces re-registration on next run)
rm -rf apps/web/e2e/.auth/*.json

# Keep the directory but remove auth files
rm apps/web/e2e/.auth/user-*.json
```

### Reset Test Users

Authentication state is automatically regenerated on the next test run with fresh users (new timestamps).

## Alternative: Mock Authentication

For component tests or when you don't need real authentication, consider using mock auth:

```typescript
// See TEST_USER_REGISTRATION_BETTER_APPROACH.md for mock auth implementation
import { mockAuthenticatedUser } from './helpers/mock-auth';

test('component test with mocked user', async ({ page }) => {
  await mockAuthenticatedUser(page, {
    id: 'test-user-123',
    email: 'test@example.com',
    name: 'Test User',
  });

  await page.goto('/en/dashboard');
  // User is "authenticated" with mock data
});
```

## References

- [Playwright Storage State Docs](https://playwright.dev/docs/auth#reuse-signed-in-state)
- [Resend API Reference](https://resend.com/docs/api-reference/introduction)
- `TEST_USER_REGISTRATION_BETTER_APPROACH.md` - Design rationale and alternatives
- `TEST_USER_REGISTRATION_IMPLEMENTATION.md` - Detailed implementation guide
