# Better Test User Registration Approach

## Why NOT Use .env Variables?

### Problems with .env Approach
1. ❌ **Manual maintenance** - Need to run setup script separately
2. ❌ **Token expiration** - JWT tokens expire (usually 24h), breaking tests
3. ❌ **Not dynamic** - Can't create fresh users per test run
4. ❌ **No cleanup** - Test users accumulate over time
5. ❌ **Shared state** - All tests use same users, causing conflicts

---

## ✅ Recommended Approach: Playwright Storage State + Dynamic Registration

### Architecture

```
Test Suite Start
    ↓
Global Setup (auth.setup.ts)
    ↓
Register 3 Test Users via OpenAuth UI
    ↓
Save Authentication State to Files
    ├─ .auth/user-single.json
    ├─ .auth/user-multi.json
    └─ .auth/user-none.json
    ↓
Tests Reuse Auth State (No Re-login)
    ↓
Global Teardown (auth.teardown.ts)
    ↓
Delete Test Users (Optional)
```

### Benefits

✅ **Fully automated** - No manual setup steps
✅ **Fresh tokens** - Generated per test run
✅ **Fast tests** - Authenticate once, reuse state
✅ **Parallel execution** - Each user has isolated state
✅ **Clean state** - Fresh users per run (optional)

---

## Implementation

### Step 1: Playwright Global Setup

**File**: `/home/meywd/AlUmmahNow/apps/web/e2e/auth.setup.ts`

```typescript
import { chromium, FullConfig } from '@playwright/test';
import { ResendTestClient } from './test-utils/resend-client';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  storageStatePath: string;
}

async function globalSetup(config: FullConfig) {
  console.log('[Global Setup] Starting test user registration...\n');

  const resendClient = new ResendTestClient(process.env.RESEND_API_KEY!);
  const openAuthUrl = process.env.OPENAUTH_URL || 'http://localhost:3301';

  // Generate unique emails per test run to avoid conflicts
  const timestamp = Date.now();
  const testUsers: TestUser[] = [
    {
      email: `test-single-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword123!',
      name: 'Single Channel User',
      storageStatePath: 'e2e/.auth/user-single.json',
    },
    {
      email: `test-multi-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword456!',
      name: 'Multi Channel User',
      storageStatePath: 'e2e/.auth/user-multi.json',
    },
    {
      email: `test-none-${timestamp}@delivered.resend.dev`,
      password: 'TestPassword789!',
      name: 'No Channels User',
      storageStatePath: 'e2e/.auth/user-none.json',
    },
  ];

  const browser = await chromium.launch();

  for (const user of testUsers) {
    console.log(`[Setup] Registering user: ${user.email}`);

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to OpenAuth signup
      await page.goto(`${openAuthUrl}/signup`);

      // Fill registration form
      await page.fill('input[type="email"]', user.email);
      await page.fill('input[type="password"]', user.password);
      await page.click('button[type="submit"]');

      // Wait for verification email
      await page.waitForSelector('text=/verification.*code/i', { timeout: 10000 });

      // Get verification code from Resend
      const emailHtml = await resendClient.getVerificationEmail(user.email);
      if (!emailHtml) throw new Error('No verification email received');

      const code = resendClient.extractVerificationCode(emailHtml);
      if (!code) throw new Error('Failed to extract verification code');

      // Enter verification code
      await page.fill('input[type="text"], input[type="number"]', code);
      await page.click('button[type="submit"]');

      // Wait for successful authentication and redirect
      await page.waitForURL('**/api/callback?code=*', { timeout: 15000 });
      await page.waitForURL('**/en', { timeout: 10000 });

      // Save authenticated state
      await context.storageState({ path: user.storageStatePath });

      console.log(`✅ Registered and saved state: ${user.email}\n`);

      await context.close();

      // Small delay between registrations
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`❌ Failed to register ${user.email}:`, error);
      await page.screenshot({ path: `e2e/error-${user.email}.png` });
      await context.close();
      throw error;
    }
  }

  await browser.close();

  console.log('[Global Setup] ✅ All test users registered successfully!\n');
}

export default globalSetup;
```

---

### Step 2: Update Playwright Config

**File**: `/home/meywd/AlUmmahNow/apps/web/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',

  // Run global setup before all tests
  globalSetup: require.resolve('./e2e/auth.setup'),

  // Optional: Run global teardown after all tests
  // globalTeardown: require.resolve('./e2e/auth.teardown'),

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },

  // Define projects for different user types
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'single-channel-user',
      use: {
        ...devices['Desktop Chrome'],
        // Use saved authentication state
        storageState: 'e2e/.auth/user-single.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'multi-channel-user',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user-multi.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'no-channels-user',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user-none.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

---

### Step 3: Update E2E Tests

**File**: `/home/meywd/AlUmmahNow/apps/web/e2e/19-dashboard-videos-ownership.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

// Tests automatically use the authenticated state based on project
test.describe('Dashboard Videos - Single Channel', () => {
  // Run ONLY with single-channel-user project
  test.use({ storageState: 'e2e/.auth/user-single.json' });

  test('should display all videos for owner', async ({ page }) => {
    // User is ALREADY authenticated - no setup needed!
    await page.goto('/en/dashboard/videos');

    // Verify videos are displayed
    const videoCards = await page.locator('[data-testid="video-card"]');
    await expect(videoCards).toHaveCount(3); // Or whatever expected count
  });

  test('should show both public and private videos', async ({ page }) => {
    await page.goto('/en/dashboard/videos');

    // Check for privacy badges
    const privateBadges = await page.locator('text="Private"');
    await expect(privateBadges).toBeVisible();
  });
});

test.describe('Dashboard Videos - Multiple Channels', () => {
  // Run ONLY with multi-channel-user project
  test.use({ storageState: 'e2e/.auth/user-multi.json' });

  test('should make single API call for all channels', async ({ page }) => {
    // Track API calls
    const apiCalls: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/videos')) {
        apiCalls.push(req.url());
      }
    });

    await page.goto('/en/dashboard/videos');

    // Should be exactly 1 call
    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0]).toContain('isOwner=true');
  });
});

test.describe('Dashboard Videos - No Channels', () => {
  // Run ONLY with no-channels-user project
  test.use({ storageState: 'e2e/.auth/user-none.json' });

  test('should show empty state', async ({ page }) => {
    await page.goto('/en/dashboard/videos');

    // Verify empty state message
    await expect(page.locator('text="No videos found"')).toBeVisible();
  });
});
```

---

### Step 4: Run Tests

```bash
# Playwright automatically:
# 1. Runs global setup (registers users)
# 2. Saves auth states
# 3. Runs tests with authenticated sessions
# 4. No manual setup needed!

pnpm test:e2e
```

---

### Step 5: Add .auth/ to .gitignore

**File**: `/home/meywd/AlUmmahNow/apps/web/.gitignore`

```
# Playwright auth states (contain tokens)
e2e/.auth/
```

---

## Alternative: Mock Authentication (Fastest)

If you don't need real OpenAuth integration, **mock the authentication** entirely:

### Mock Auth Helper

**File**: `/home/meywd/AlUmmahNow/apps/web/e2e/helpers/mock-auth.ts`

```typescript
import { Page } from '@playwright/test';

export async function mockAuthenticatedUser(
  page: Page,
  user: {
    id: string;
    email: string;
    name: string;
    channels?: any[];
  }
) {
  // Set mock session cookie
  await page.context().addCookies([
    {
      name: 'al_ummah_session',
      value: encodeURIComponent(JSON.stringify({
        activeUserId: user.id,
        activeChannelId: user.channels?.[0]?.id || null,
        accounts: {
          [user.id]: {
            userId: user.id,
            email: user.email,
            displayName: user.name,
            accessToken: createMockToken(user.id, user.email),
            refreshToken: '',
            channels: user.channels || [],
            activeChannelId: null,
            lastActivity: Date.now(),
          },
        },
      })),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

function createMockToken(userId: string, email: string): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    type: 'user',
    properties: { id: userId, email },
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
    aud: 'https://videos.alummahnow.net',
    iss: 'https://auth.alummahnow.net',
  }));
  return `${header}.${payload}.`;
}
```

### Using Mock Auth

```typescript
import { mockAuthenticatedUser } from './helpers/mock-auth';

test('dashboard with mocked user', async ({ page }) => {
  // Mock authentication (instant, no OpenAuth needed)
  await mockAuthenticatedUser(page, {
    id: 'test-user-123',
    email: 'test@example.com',
    name: 'Test User',
    channels: [
      { id: 'channel-1', name: 'My Channel' },
    ],
  });

  // User is now "authenticated"
  await page.goto('/en/dashboard/videos');

  // Test as normal...
});
```

### Benefits of Mocking

✅ **Instant** - No registration delay
✅ **No external dependencies** - Works offline
✅ **Deterministic** - Same users every time
✅ **Fast** - Tests run in seconds
✅ **No API calls** - Don't need OpenAuth running

---

## Comparison

| Approach | Setup Time | Test Speed | Real Auth | Complexity |
|----------|------------|------------|-----------|------------|
| **.env Variables** | 5-10 min (manual) | Fast | ✅ Yes | Medium |
| **Playwright Storage State** | 2-3 min (auto) | Fast | ✅ Yes | Low |
| **Mock Authentication** | 0 seconds | Fastest | ❌ No | Very Low |

---

## Recommendation

### For Most Cases: **Playwright Storage State** ⭐

**Why**:
- ✅ Fully automated (no manual steps)
- ✅ Real authentication flow
- ✅ Fresh users per run (no conflicts)
- ✅ Fast test execution (authenticate once, reuse)
- ✅ Easy cleanup (delete .auth/ folder)

**When to Use**:
- Integration tests that need real auth
- Testing authentication flows
- CI/CD environments

### For Unit/Component Tests: **Mock Authentication**

**Why**:
- ✅ Zero setup time
- ✅ Works offline
- ✅ Deterministic
- ✅ Fastest execution

**When to Use**:
- Testing UI components in isolation
- Don't care about actual auth service
- Local development with frequent test runs

### Never: **.env Variables**

**Why Not**:
- ❌ Manual maintenance
- ❌ Token expiration issues
- ❌ Not truly automated
- ❌ Shared state problems

---

## Migration from .env Approach

### 1. Remove .env.test.local approach

```bash
# Delete the planned .env file approach
rm .env.test.local

# Keep only Resend API key in .env (for global setup)
echo "RESEND_API_KEY=re_xxxxx" > .env
```

### 2. Implement global setup

Create `e2e/auth.setup.ts` (code above)

### 3. Update playwright.config.ts

Add `globalSetup` and `projects` (code above)

### 4. Update tests

Remove manual auth code, use `storageState`

### 5. Run tests

```bash
pnpm test:e2e
# Automatically registers users on first run
# Reuses auth state on subsequent runs
```

---

## Summary

**Old Approach** (.env):
```
Manual setup script → Update .env → Run tests → Token expires → Repeat
```

**New Approach** (Storage State):
```
pnpm test:e2e → Auto-registers users → Saves state → Tests run → Done
```

**Fastest Approach** (Mock):
```
pnpm test:e2e → Mock auth in memory → Tests run → Done
```

---

**Recommendation**: Use **Playwright Storage State** for real E2E tests, **Mock Auth** for component tests.

This eliminates the need for `.env` variables entirely! 🎉
