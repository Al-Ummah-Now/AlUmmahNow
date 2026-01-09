# Test User Registration Implementation Plan

## Executive Summary

**Goal**: Automate test user registration for E2E tests using OpenAuth UI automation + Resend API for email verification.

**Challenge**: OpenAuth service is external - we can't create users via API. We must:
1. Use Playwright to automate registration through OpenAuth UI
2. Use Resend API to retrieve verification emails
3. Extract verification codes and complete registration
4. Store credentials securely for E2E tests

**Timeline**: 1-2 weeks for full implementation

---

## Architecture Overview

```
┌─────────────────┐
│  Setup Script   │
│  (Playwright)   │
└────────┬────────┘
         │
         │ 1. Navigate to OpenAuth
         ↓
┌─────────────────┐     3. Send verification email     ┌──────────────┐
│  OpenAuth UI    │────────────────────────────────────>│   Resend     │
│  localhost:3301 │                                     │   API        │
└────────┬────────┘                                     └──────┬───────┘
         │                                                     │
         │ 2. User fills registration form                    │
         │                                                     │
         │ 4. Retrieve email via API ←────────────────────────┘
         │
         │ 5. Extract verification code
         │
         │ 6. Submit verification code
         ↓
┌─────────────────┐
│  JWT Tokens     │
│  Stored in      │
│  .env.test.local│
└─────────────────┘
```

---

## Implementation Strategy

### Phase 1: Environment Setup (Days 1-2)

#### 1.1 Get Resend API Key

```bash
# Steps:
1. Visit https://resend.com/signup
2. Create account
3. Navigate to Settings > API Keys
4. Create new API key with full access
5. Copy key (starts with re_...)
```

**Cost**: Free tier includes 100 emails/day (sufficient for testing)

#### 1.2 Configure Test Email Domain

**Option A: Use Resend Test Email**
```env
TEST_EMAIL_DOMAIN=delivered.resend.dev
TEST_USER_EMAIL_1=test-user-1@delivered.resend.dev
TEST_USER_EMAIL_2=test-user-2@delivered.resend.dev
```

**Option B: Custom Domain** (if you own one)
```env
TEST_EMAIL_DOMAIN=test.alummahnow.net
```

**Recommendation**: Use Option A for simplicity. Resend's test domain automatically accepts all emails.

#### 1.3 Environment Variables

Create `/home/meywd/AlUmmahNow/.env.test.local`:

```env
# OpenAuth Configuration
OPENAUTH_URL=http://localhost:3301
OPENAUTH_CLIENT_ID=web

# Resend API
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Test Users
TEST_USER_1_EMAIL=test-user-single-001@delivered.resend.dev
TEST_USER_1_PASSWORD=TestPassword123!
TEST_USER_1_ID=           # Filled after registration
TEST_USER_1_ACCESS_TOKEN= # Filled after registration

TEST_USER_2_EMAIL=test-user-multi-002@delivered.resend.dev
TEST_USER_2_PASSWORD=TestPassword456!
TEST_USER_2_ID=
TEST_USER_2_ACCESS_TOKEN=

TEST_USER_3_EMAIL=test-user-none-003@delivered.resend.dev
TEST_USER_3_PASSWORD=TestPassword789!
TEST_USER_3_ID=
TEST_USER_3_ACCESS_TOKEN=

# API Configuration
API_URL=http://127.0.0.1:3086
WEB_URL=http://localhost:3001
```

**Add to `.gitignore`**:
```
.env.test.local
```

---

### Phase 2: Resend Client Implementation (Days 3-4)

#### 2.1 Install Dependencies

```bash
cd /home/meywd/AlUmmahNow/apps/web

pnpm add -D resend dotenv
```

#### 2.2 Create Resend Client

**File**: `/home/meywd/AlUmmahNow/apps/web/test-utils/resend-client.ts`

```typescript
import { Resend } from 'resend';

export class ResendTestClient {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  /**
   * Retrieve emails sent to a specific address
   * @param toEmail - The recipient email address
   * @param maxAttempts - Maximum number of polling attempts (default: 12)
   * @param delayMs - Delay between attempts in ms (default: 5000 = 5 seconds)
   */
  async getVerificationEmail(
    toEmail: string,
    maxAttempts: number = 12,
    delayMs: number = 5000
  ): Promise<string | null> {
    console.log(`[Resend] Polling for verification email to ${toEmail}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Retrieve recent emails
        const { data: emails } = await this.resend.emails.list({
          limit: 10,
        });

        if (!emails) {
          console.log(`[Resend] Attempt ${attempt}/${maxAttempts}: No emails found`);
          await this.delay(delayMs);
          continue;
        }

        // Find email sent to this address
        const verificationEmail = emails.find((email) =>
          email.to?.includes(toEmail) &&
          email.subject?.toLowerCase().includes('verification')
        );

        if (verificationEmail) {
          console.log(`[Resend] Found verification email: ${verificationEmail.id}`);

          // Get email details including HTML content
          const { data: emailData } = await this.resend.emails.get(verificationEmail.id);

          if (emailData?.html) {
            return emailData.html;
          }
        }

        console.log(`[Resend] Attempt ${attempt}/${maxAttempts}: Email not found yet`);
        await this.delay(delayMs);
      } catch (error) {
        console.error(`[Resend] Error on attempt ${attempt}:`, error);

        // If it's a rate limit error, wait longer
        if (error instanceof Error && error.message.includes('rate limit')) {
          console.log('[Resend] Rate limit hit, waiting 60 seconds...');
          await this.delay(60000);
        } else {
          await this.delay(delayMs);
        }
      }
    }

    console.error(`[Resend] Failed to retrieve email after ${maxAttempts} attempts`);
    return null;
  }

  /**
   * Extract verification code from email HTML
   */
  extractVerificationCode(emailHtml: string): string | null {
    // Strategy 1: Look for 6-digit code in <strong> tags
    const strongMatch = emailHtml.match(/<strong[^>]*>(\d{6})<\/strong>/i);
    if (strongMatch) {
      return strongMatch[1];
    }

    // Strategy 2: Look for verification code pattern
    const codePattern = /verification code[:\s]+(\d{6})/i;
    const codeMatch = emailHtml.match(codePattern);
    if (codeMatch) {
      return codeMatch[1];
    }

    // Strategy 3: Look for any 6-digit number (risky but fallback)
    const digitMatch = emailHtml.match(/\b(\d{6})\b/);
    if (digitMatch) {
      console.warn('[Resend] Using fallback 6-digit extraction');
      return digitMatch[1];
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

### Phase 3: Playwright Registration Automation (Days 5-7)

#### 3.1 Create Registration Script

**File**: `/home/meywd/AlUmmahNow/apps/web/test-utils/register-test-user.ts`

```typescript
import { chromium, Page, Browser } from '@playwright/test';
import { ResendTestClient } from './resend-client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.test.local') });

interface TestUser {
  email: string;
  password: string;
  name?: string;
}

interface RegisteredUser {
  email: string;
  id: string;
  accessToken: string;
  refreshToken: string;
}

export class TestUserRegistration {
  private browser: Browser | null = null;
  private resendClient: ResendTestClient;
  private openAuthUrl: string;

  constructor() {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not found in .env.test.local');
    }

    this.resendClient = new ResendTestClient(resendApiKey);
    this.openAuthUrl = process.env.OPENAUTH_URL || 'http://localhost:3301';
  }

  /**
   * Register a new test user through OpenAuth UI
   */
  async registerUser(user: TestUser): Promise<RegisteredUser> {
    console.log(`\n[Registration] Starting registration for ${user.email}...`);

    this.browser = await chromium.launch({ headless: false }); // Set to true for CI
    const context = await this.browser.newContext();
    const page = await context.newPage();

    try {
      // Step 1: Navigate to OpenAuth registration
      console.log('[Registration] Step 1: Navigating to OpenAuth...');
      await page.goto(`${this.openAuthUrl}/signup`, { waitUntil: 'networkidle' });

      // Step 2: Fill registration form
      console.log('[Registration] Step 2: Filling registration form...');
      await page.fill('input[type="email"]', user.email);
      await page.fill('input[type="password"]', user.password);

      if (user.name) {
        // If there's a name field
        const nameInput = page.locator('input[name="name"], input[placeholder*="name"]');
        if (await nameInput.count() > 0) {
          await nameInput.fill(user.name);
        }
      }

      // Submit registration form
      await page.click('button[type="submit"], button:has-text("Sign up"), button:has-text("Register")');

      // Step 3: Wait for verification email prompt
      console.log('[Registration] Step 3: Waiting for verification prompt...');
      await page.waitForSelector(
        'text=/enter.*verification.*code|verification.*code|check.*email/i',
        { timeout: 10000 }
      );

      // Step 4: Retrieve verification email
      console.log('[Registration] Step 4: Retrieving verification email from Resend...');
      const emailHtml = await this.resendClient.getVerificationEmail(user.email);

      if (!emailHtml) {
        throw new Error('Failed to retrieve verification email');
      }

      // Step 5: Extract verification code
      console.log('[Registration] Step 5: Extracting verification code...');
      const verificationCode = this.resendClient.extractVerificationCode(emailHtml);

      if (!verificationCode) {
        throw new Error('Failed to extract verification code from email');
      }

      console.log(`[Registration] Found verification code: ${verificationCode}`);

      // Step 6: Enter verification code
      console.log('[Registration] Step 6: Entering verification code...');

      // Find verification code input (could be multiple inputs for each digit)
      const codeInputs = await page.locator('input[type="text"], input[type="number"]').count();

      if (codeInputs === 6) {
        // Separate inputs for each digit
        const digits = verificationCode.split('');
        for (let i = 0; i < 6; i++) {
          await page.locator('input[type="text"], input[type="number"]').nth(i).fill(digits[i]);
        }
      } else {
        // Single input for entire code
        await page.fill('input[type="text"], input[type="number"]', verificationCode);
      }

      // Submit verification
      const submitButton = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Continue")');
      await submitButton.click();

      // Step 7: Wait for redirect to app with tokens
      console.log('[Registration] Step 7: Waiting for redirect with tokens...');
      await page.waitForURL('**/api/callback?code=*', { timeout: 15000 });

      // Step 8: Extract tokens from cookies or localStorage
      console.log('[Registration] Step 8: Extracting authentication tokens...');

      // Wait for callback processing
      await page.waitForURL('**/en', { timeout: 10000 });

      // Get tokens from cookies
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === 'al_ummah_session');

      if (!sessionCookie) {
        throw new Error('Failed to find session cookie after registration');
      }

      // Decode session data
      const sessionData = JSON.parse(decodeURIComponent(sessionCookie.value));
      const activeUserId = sessionData.activeUserId;
      const userSession = sessionData.accounts[activeUserId];

      if (!userSession) {
        throw new Error('Failed to extract user session from cookie');
      }

      console.log(`[Registration] ✅ Successfully registered user ${user.email}`);
      console.log(`[Registration] User ID: ${userSession.userId}`);

      return {
        email: user.email,
        id: userSession.userId,
        accessToken: userSession.accessToken,
        refreshToken: userSession.refreshToken,
      };

    } catch (error) {
      console.error('[Registration] ❌ Registration failed:', error);

      // Take screenshot for debugging
      await page.screenshot({
        path: `registration-error-${user.email.replace('@', '-at-')}.png`,
        fullPage: true
      });

      throw error;
    } finally {
      await context.close();
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  /**
   * Update .env.test.local with registered user credentials
   */
  updateEnvFile(userNumber: number, user: RegisteredUser): void {
    const envPath = path.join(__dirname, '../../.env.test.local');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    // Update user credentials
    envContent = envContent.replace(
      new RegExp(`TEST_USER_${userNumber}_ID=.*`, 'g'),
      `TEST_USER_${userNumber}_ID=${user.id}`
    );
    envContent = envContent.replace(
      new RegExp(`TEST_USER_${userNumber}_ACCESS_TOKEN=.*`, 'g'),
      `TEST_USER_${userNumber}_ACCESS_TOKEN=${user.accessToken}`
    );

    fs.writeFileSync(envPath, envContent);
    console.log(`[Env] Updated .env.test.local with credentials for user ${userNumber}`);
  }
}

/**
 * Main execution script
 */
async function main() {
  const registration = new TestUserRegistration();

  const testUsers: TestUser[] = [
    {
      email: process.env.TEST_USER_1_EMAIL!,
      password: process.env.TEST_USER_1_PASSWORD!,
      name: 'Test User Single Channel',
    },
    {
      email: process.env.TEST_USER_2_EMAIL!,
      password: process.env.TEST_USER_2_PASSWORD!,
      name: 'Test User Multi Channel',
    },
    {
      email: process.env.TEST_USER_3_EMAIL!,
      password: process.env.TEST_USER_3_PASSWORD!,
      name: 'Test User No Channels',
    },
  ];

  for (let i = 0; i < testUsers.length; i++) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Registering test user ${i + 1}/${testUsers.length}`);
      console.log('='.repeat(60));

      const registeredUser = await registration.registerUser(testUsers[i]);
      registration.updateEnvFile(i + 1, registeredUser);

      console.log(`✅ User ${i + 1} registered successfully\n`);

      // Wait between registrations to avoid rate limits
      if (i < testUsers.length - 1) {
        console.log('Waiting 10 seconds before next registration...\n');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch (error) {
      console.error(`❌ Failed to register user ${i + 1}:`, error);
      process.exit(1);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All test users registered successfully!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Review .env.test.local to verify credentials');
  console.log('2. Run E2E tests: npm run test:e2e');
  console.log('='.repeat(60) + '\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { TestUserRegistration, TestUser, RegisteredUser };
```

---

### Phase 4: NPM Script Setup (Day 8)

#### 4.1 Add Script to package.json

**File**: `/home/meywd/AlUmmahNow/apps/web/package.json`

```json
{
  "scripts": {
    "test:setup-users": "ts-node test-utils/register-test-user.ts",
    "test:setup-users:verbose": "DEBUG=* ts-node test-utils/register-test-user.ts"
  }
}
```

#### 4.2 Install Additional Dependencies

```bash
cd /home/meywd/AlUmmahNow/apps/web

pnpm add -D ts-node @types/node
```

---

### Phase 5: E2E Test Integration (Days 9-10)

#### 5.1 Create Test Fixtures

**File**: `/home/meywd/AlUmmahNow/apps/web/e2e/test-users.fixture.ts`

```typescript
import dotenv from 'dotenv';
import path from 'path';

// Load test users from environment
dotenv.config({ path: path.join(__dirname, '../../.env.test.local') });

export interface TestUserFixture {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  name: string;
}

export const TEST_USERS: Record<string, TestUserFixture> = {
  singleChannel: {
    id: process.env.TEST_USER_1_ID || '',
    email: process.env.TEST_USER_1_EMAIL || '',
    password: process.env.TEST_USER_1_PASSWORD || '',
    accessToken: process.env.TEST_USER_1_ACCESS_TOKEN || '',
    name: 'Single Channel User',
  },
  multiChannel: {
    id: process.env.TEST_USER_2_ID || '',
    email: process.env.TEST_USER_2_EMAIL || '',
    password: process.env.TEST_USER_2_PASSWORD || '',
    accessToken: process.env.TEST_USER_2_ACCESS_TOKEN || '',
    name: 'Multi Channel User',
  },
  noChannels: {
    id: process.env.TEST_USER_3_ID || '',
    email: process.env.TEST_USER_3_EMAIL || '',
    password: process.env.TEST_USER_3_PASSWORD || '',
    accessToken: process.env.TEST_USER_3_ACCESS_TOKEN || '',
    name: 'No Channels User',
  },
};

/**
 * Validate that all test users are configured
 */
export function validateTestUsers(): void {
  const missingUsers: string[] = [];

  Object.entries(TEST_USERS).forEach(([key, user]) => {
    if (!user.id || !user.accessToken) {
      missingUsers.push(key);
    }
  });

  if (missingUsers.length > 0) {
    throw new Error(
      `Missing test user configuration for: ${missingUsers.join(', ')}. ` +
      `Run 'npm run test:setup-users' to register test users.`
    );
  }
}
```

#### 5.2 Update E2E Test to Use Real Users

**File**: `/home/meywd/AlUmmahNow/apps/web/e2e/19-dashboard-videos-ownership.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { TEST_USERS, validateTestUsers } from './test-users.fixture';

// Validate test users before running tests
test.beforeAll(() => {
  validateTestUsers();
});

/**
 * Helper: Authenticate user with real JWT token
 */
async function authenticateUser(page: Page, userKey: 'singleChannel' | 'multiChannel' | 'noChannels') {
  const user = TEST_USERS[userKey];

  // Set authentication cookie
  await page.context().addCookies([
    {
      name: 'al_ummah_session',
      value: encodeURIComponent(JSON.stringify({
        activeUserId: user.id,
        activeChannelId: null,
        accounts: {
          [user.id]: {
            userId: user.id,
            email: user.email,
            displayName: user.name,
            accessToken: user.accessToken,
            refreshToken: '', // Not needed for tests
            channels: [], // Will be fetched from API
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

test.describe('Dashboard Videos - Single Channel', () => {
  test('should display all videos (public + private) for owner', async ({ page }) => {
    // Authenticate with real user
    await authenticateUser(page, 'singleChannel');

    // Navigate to dashboard
    await page.goto('http://localhost:3001/en/dashboard/videos');

    // Wait for videos to load
    await page.waitForSelector('[data-testid="video-card"], .no-videos-message', { timeout: 10000 });

    // Verify videos are displayed
    const videoCount = await page.locator('[data-testid="video-card"]').count();
    expect(videoCount).toBeGreaterThan(0);
  });
});
```

---

### Phase 6: CI/CD Integration (Days 11-14)

#### 6.1 GitHub Actions Workflow

**File**: `/home/meywd/AlUmmahNow/.github/workflows/e2e-tests.yml`

```yaml
name: E2E Tests

on:
  pull_request:
    branches: [main, channel]
  push:
    branches: [main]
  schedule:
    # Run daily to refresh test users
    - cron: '0 0 * * *'

jobs:
  setup-test-users:
    runs-on: ubuntu-latest
    outputs:
      users-ready: ${{ steps.check.outputs.ready }}

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9.15.4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Setup test environment
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          OPENAUTH_URL: http://localhost:3301
        run: |
          cat > apps/web/.env.test.local << EOF
          RESEND_API_KEY=${{ secrets.RESEND_API_KEY }}
          OPENAUTH_URL=http://localhost:3301
          TEST_USER_1_EMAIL=gh-test-1-${{ github.run_id }}@delivered.resend.dev
          TEST_USER_1_PASSWORD=${{ secrets.TEST_USER_PASSWORD }}
          TEST_USER_2_EMAIL=gh-test-2-${{ github.run_id }}@delivered.resend.dev
          TEST_USER_2_PASSWORD=${{ secrets.TEST_USER_PASSWORD }}
          TEST_USER_3_EMAIL=gh-test-3-${{ github.run_id }}@delivered.resend.dev
          TEST_USER_3_PASSWORD=${{ secrets.TEST_USER_PASSWORD }}
          EOF

      - name: Start OpenAuth service
        run: |
          # Start OpenAuth in background
          # (This assumes OpenAuth is available as a separate service)
          # Adjust based on actual OpenAuth setup
          docker run -d -p 3301:3301 openauth:latest || true

      - name: Register test users
        run: pnpm --filter @al-ummah/web test:setup-users

      - name: Cache test users
        uses: actions/cache@v3
        with:
          path: apps/web/.env.test.local
          key: test-users-${{ github.run_id }}

      - id: check
        run: echo "ready=true" >> $GITHUB_OUTPUT

  e2e-tests:
    needs: setup-test-users
    runs-on: ubuntu-latest
    if: needs.setup-test-users.outputs.users-ready == 'true'

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9.15.4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: pnpm --filter @al-ummah/web exec playwright install --with-deps

      - name: Restore test users
        uses: actions/cache@v3
        with:
          path: apps/web/.env.test.local
          key: test-users-${{ github.run_id }}

      - name: Run E2E tests
        run: pnpm --filter @al-ummah/web test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: apps/web/playwright-report/
```

#### 6.2 Required GitHub Secrets

Add these to your GitHub repository secrets:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TEST_USER_PASSWORD=SecureTestPassword123!
```

---

## Usage Instructions

### For Local Development

```bash
# 1. Ensure OpenAuth is running
# (Start separately or via docker-compose)

# 2. Create .env.test.local with Resend API key and test user emails

# 3. Register test users
cd /home/meywd/AlUmmahNow/apps/web
pnpm test:setup-users

# 4. Verify registration
cat ../../.env.test.local | grep TEST_USER_1_ID

# 5. Run E2E tests
pnpm test:e2e
```

### For CI/CD

```bash
# 1. Add GitHub Secrets:
#    - RESEND_API_KEY
#    - TEST_USER_PASSWORD

# 2. Push to main or create PR
git push origin feature/my-feature

# 3. GitHub Actions will:
#    - Register fresh test users
#    - Run E2E tests
#    - Upload results
```

---

## Troubleshooting

### Issue 1: OpenAuth Not Running

**Symptoms**: `ECONNREFUSED localhost:3301`

**Solution**:
```bash
# Start OpenAuth service
docker-compose up openauth -d

# Or start via npm if available
cd /path/to/openauth
npm run dev
```

### Issue 2: Verification Email Not Received

**Symptoms**: Timeout after 60 seconds waiting for email

**Solutions**:
1. Check Resend API key is valid
2. Verify email domain is configured in Resend
3. Check Resend dashboard for email delivery status
4. Increase polling timeout in ResendTestClient

### Issue 3: Verification Code Not Extracted

**Symptoms**: `Failed to extract verification code from email`

**Solutions**:
1. Save email HTML to file for manual inspection:
   ```typescript
   fs.writeFileSync('email-debug.html', emailHtml);
   ```
2. Update regex patterns in `extractVerificationCode()`
3. Check OpenAuth email template format

### Issue 4: Registration Form Fields Changed

**Symptoms**: `TimeoutError: waiting for locator('input[type="email"]')`

**Solutions**:
1. Inspect OpenAuth registration page manually
2. Update selectors in `register-test-user.ts`
3. Take screenshots during registration for debugging

---

## Security Best Practices

### ✅ DO:
1. Use `.env.test.local` (gitignored) for local credentials
2. Use GitHub Secrets for CI/CD
3. Generate unique email addresses per CI run
4. Rotate test user passwords monthly
5. Delete test users after tests in CI
6. Use dedicated test email domain

### ❌ DON'T:
1. Commit test credentials to git
2. Use production email addresses for tests
3. Share test credentials across teams
4. Store tokens in plain text files
5. Use same test users for dev and CI
6. Reuse test emails from failed runs

---

## Timeline & Milestones

| Week | Milestone | Deliverables |
|------|-----------|--------------|
| 1 | Environment Setup | Resend account, API key, .env.test.local |
| 1 | Resend Client | Working email retrieval and code extraction |
| 2 | Registration Script | Automated user registration via Playwright |
| 2 | E2E Integration | Tests using real registered users |
| 2 | CI/CD Setup | GitHub Actions workflow |
| 2 | Documentation | Complete setup guide |

---

## Cost Analysis

**Resend Free Tier**:
- 100 emails/day
- 3 verification emails per full test run
- ~33 test runs per day maximum
- **Cost**: $0/month

**Resend Pro Tier** (if needed):
- $20/month
- 50,000 emails/month
- More than sufficient for CI/CD
- **Cost**: $20/month

**Recommendation**: Start with free tier, upgrade if running > 30 tests/day

---

## Success Criteria

- ✅ All 3 test users registered automatically
- ✅ Verification codes extracted successfully
- ✅ JWT tokens stored in .env.test.local
- ✅ E2E tests pass with real authentication
- ✅ CI/CD workflow completes without manual intervention
- ✅ Test execution time < 5 minutes for registration
- ✅ Zero credentials committed to git

---

## Next Steps

1. **Immediate** (Today):
   - Get Resend API key
   - Create .env.test.local
   - Test Resend client manually

2. **This Week**:
   - Implement Playwright registration script
   - Test with one user end-to-end
   - Update E2E tests to use real users

3. **Next Week**:
   - Complete all 3 test users
   - Set up CI/CD workflow
   - Document troubleshooting guide

---

**Document Version**: 1.0
**Last Updated**: 2025-11-23
**Author**: Claude Code Agent
**Status**: Ready for Implementation
