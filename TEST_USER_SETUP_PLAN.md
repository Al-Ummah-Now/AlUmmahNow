# Test User Registration Setup Plan

**Version:** 1.0.0
**Date:** 2025-11-23
**Status:** Planning Phase

---

## Executive Summary

This document provides a comprehensive plan for registering real test users with the Al Ummah Now authentication server (`https://auth.alummahnow.net`) for E2E testing. The plan includes automated user registration via Resend API for email verification code retrieval, secure credential management, and integration with the existing Playwright test suite.

**Key Objectives:**
1. Register 3+ test users with the production auth server
2. Automate email verification using Resend API
3. Store credentials securely for E2E tests
4. Maintain test user data for CI/CD environments
5. Ensure compliance with security best practices

**Current State:**
- ❌ Tests use mocked authentication (no real auth server integration)
- ❌ No test users registered with `https://auth.alummahnow.net`
- ❌ No Resend API integration for email verification
- ✅ Auth server is operational (`https://auth.alummahnow.net`)
- ✅ OpenAuth client configured (`ClientId`, `Issuer`)

**Target State:**
- ✅ 3 test users registered with auth server
- ✅ Automated registration script using Resend API
- ✅ Credentials stored in `.env.test.local` (gitignored)
- ✅ E2E tests use real JWT tokens
- ✅ CI/CD environment uses GitHub Secrets

---

## Auth Server Analysis

### Current Authentication Configuration

**Auth Server URL:** `https://auth.alummahnow.net`

**OpenAuth Configuration (from `wrangler.jsonc`):**
```json
{
  "ClientId": "3f8c9b2e-4d6a-4b8e-9f3a-2c7d5e8f1a6b",
  "Issuer": "https://auth.alummahnow.net"
}
```

**OpenAuth Client Setup (from `apps/web/src/lib/actions.ts`):**
```typescript
import { createClient } from "@openauthjs/openauth/client"

const client = createClient({
  clientID: process.env.ClientId!,    // 3f8c9b2e-4d6a-4b8e-9f3a-2c7d5e8f1a6b
  issuer: process.env.Issuer!,        // https://auth.alummahnow.net
});
```

### Auth Server Discovery

**Server Status:**
- ✅ Reachable via HTTPS
- ✅ Redirects to `https://profile.auth.alummahnow.net/` (profile management UI)
- ❌ No OpenID Connect discovery endpoint (`.well-known/openid-configuration` returns 404)
- ⚠️ Custom OpenAuth implementation (not standard OAuth2/OIDC)

**Security Headers:**
```http
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'...
x-frame-options: DENY
x-xss-protection: 1; mode=block
```

### Required API Endpoints

Based on the OpenAuth implementation, we need to discover:

1. **User Registration Endpoint**
   - Expected: `POST https://auth.alummahnow.net/api/register` or similar
   - Payload: `{ email, password, displayName }`
   - Response: `{ userId, verificationRequired: true }`

2. **Email Verification Endpoint**
   - Expected: `POST https://auth.alummahnow.net/api/verify`
   - Payload: `{ email, code }`
   - Response: `{ success: true, userId }`

3. **Token Endpoint**
   - Expected: `POST https://auth.alummahnow.net/token`
   - Payload: `{ email, password }` or OAuth2 authorization code flow
   - Response: `{ access_token, refresh_token, expires_in }`

**⚠️ CRITICAL:** These endpoints need to be discovered or confirmed with the auth server maintainers before implementation.

---

## Resend API Integration

### API Overview

**Resend API Documentation:** https://resend.com/docs/api-reference/introduction

**Primary Use Case:** Retrieve email verification codes sent by the auth server

### Authentication

**Method:** Bearer token authentication

**Header Format:**
```http
Authorization: Bearer re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**API Key Location:**
- Development: `.env.local` → `RESEND_API_KEY`
- CI/CD: GitHub Secrets → `RESEND_API_KEY`

### Key Endpoints

#### 1. List Emails

**Endpoint:** `GET https://api.resend.com/emails`

**Purpose:** Retrieve recent emails to extract verification codes

**Request:**
```bash
curl -X GET 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

**Response:**
```json
{
  "data": [
    {
      "id": "email_abc123",
      "from": "noreply@auth.alummahnow.net",
      "to": ["test@example.com"],
      "subject": "Email Verification - Al Ummah Now",
      "created_at": "2025-11-23T12:00:00Z",
      "html": "<p>Your verification code is: <strong>123456</strong></p>"
    }
  ]
}
```

#### 2. Get Email by ID

**Endpoint:** `GET https://api.resend.com/emails/{email_id}`

**Purpose:** Retrieve full email content for code extraction

**Request:**
```bash
curl -X GET 'https://api.resend.com/emails/email_abc123' \
  -H 'Authorization: Bearer re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

**Response:**
```json
{
  "id": "email_abc123",
  "from": "noreply@auth.alummahnow.net",
  "to": ["test@example.com"],
  "subject": "Email Verification - Al Ummah Now",
  "html": "<p>Your verification code is: <strong>123456</strong></p>",
  "text": "Your verification code is: 123456",
  "created_at": "2025-11-23T12:00:00Z"
}
```

### Code Extraction Strategy

**Pattern Matching (multiple approaches):**

1. **6-digit code pattern:**
   ```typescript
   const codeMatch = emailHtml.match(/\b\d{6}\b/);
   const code = codeMatch ? codeMatch[0] : null;
   ```

2. **Strong tag extraction:**
   ```typescript
   const codeMatch = emailHtml.match(/<strong>(\d{6})<\/strong>/);
   const code = codeMatch ? codeMatch[1] : null;
   ```

3. **Text content extraction:**
   ```typescript
   const codeMatch = emailText.match(/verification code is:?\s*(\d{6})/i);
   const code = codeMatch ? codeMatch[1] : null;
   ```

### Rate Limits and Quotas

**Resend Free Tier:**
- 100 emails/day
- 3,000 emails/month
- API rate limit: 10 requests/second

**Paid Tiers:**
- $20/month: 50,000 emails/month
- $80/month: 100,000 emails/month

**Best Practices:**
- Implement exponential backoff for retries
- Cache email lookups (avoid duplicate requests)
- Use batch operations when possible
- Monitor rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`

---

## Test User Registration Flow

### Complete Registration Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Test User Registration Flow                     │
└─────────────────────────────────────────────────────────────────┘

Step 1: Call Auth Server Registration
   ↓
   POST https://auth.alummahnow.net/api/register
   Body: { email: "test-user-1@example.com", password: "Test123!", displayName: "Test User 1" }
   ↓
   Response: { userId: "user-001", verificationRequired: true }

Step 2: Wait for Verification Email (via Resend)
   ↓
   Poll: GET https://api.resend.com/emails?to=test-user-1@example.com
   Wait: 5-10 seconds with exponential backoff
   ↓
   Response: { data: [{ id: "email_abc", html: "...code: 123456..." }] }

Step 3: Extract Verification Code
   ↓
   Parse email HTML/text content
   Extract: 6-digit code (e.g., 123456)

Step 4: Verify Email with Code
   ↓
   POST https://auth.alummahnow.net/api/verify
   Body: { email: "test-user-1@example.com", code: "123456" }
   ↓
   Response: { success: true, userId: "user-001" }

Step 5: Obtain JWT Tokens
   ↓
   POST https://auth.alummahnow.net/token
   Body: { email: "test-user-1@example.com", password: "Test123!" }
   ↓
   Response: { access_token: "eyJhbGc...", refresh_token: "eyJhbGc...", expires_in: 3600 }

Step 6: Store Credentials
   ↓
   Write to .env.test.local:
   TEST_USER_1_EMAIL=test-user-1@example.com
   TEST_USER_1_PASSWORD=Test123!
   TEST_USER_1_USER_ID=user-001
   TEST_USER_1_ACCESS_TOKEN=eyJhbGc...
   TEST_USER_1_REFRESH_TOKEN=eyJhbGc...

Step 7: Validation
   ↓
   Verify token with: client.verify(subjects, accessToken)
   ✅ Registration complete
```

### Error Handling and Retry Logic

**Common Errors:**

1. **Email Not Found (Resend API)**
   - Retry with exponential backoff (5s, 10s, 20s, 40s)
   - Max retries: 5 (total wait: ~75 seconds)
   - Fallback: Manual verification prompt

2. **Invalid Verification Code**
   - Verify code extraction logic
   - Check for expired codes (5-10 minute validity)
   - Log raw email content for debugging

3. **Rate Limiting**
   - Resend: Wait for `X-RateLimit-Reset` header
   - Auth server: Implement 429 handling with backoff

4. **Network Failures**
   - Retry with exponential backoff
   - Max retries: 3
   - Timeout: 30 seconds per request

**Implementation Example:**
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 5000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

---

## Implementation Approaches

### Option A: Setup Script (Recommended) ⭐

**Description:** One-time script to register all test users and store credentials

**Pros:**
- ✅ Run once, use many times
- ✅ Fast test execution (no registration overhead)
- ✅ Credentials versioned in CI/CD secrets
- ✅ Easy to re-run if users expire/deleted

**Cons:**
- ❌ Manual execution required initially
- ❌ Credentials may expire (refresh token needed)
- ❌ User data cleanup responsibility

**Implementation:**

**File:** `apps/web/e2e/setup-test-users.ts`

```typescript
/**
 * Test User Registration Script
 *
 * Registers test users with auth.alummahnow.net and stores credentials
 *
 * Usage:
 *   pnpm tsx apps/web/e2e/setup-test-users.ts
 *
 * Environment:
 *   RESEND_API_KEY - Resend API key for email retrieval
 *   AUTH_SERVER_URL - Auth server URL (default: https://auth.alummahnow.net)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

interface TestUser {
  email: string;
  password: string;
  displayName: string;
  channels: number;
  expectedVideos: number;
}

const TEST_USERS: TestUser[] = [
  {
    email: 'test-user-single-001@alummahnow-test.com',
    password: 'TestUser001!',
    displayName: 'Single Channel User',
    channels: 1,
    expectedVideos: 10
  },
  {
    email: 'test-user-multi-002@alummahnow-test.com',
    password: 'TestUser002!',
    displayName: 'Multi Channel User',
    channels: 3,
    expectedVideos: 20
  },
  {
    email: 'test-user-none-003@alummahnow-test.com',
    password: 'TestUser003!',
    displayName: 'No Channels User',
    channels: 0,
    expectedVideos: 0
  }
];

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://auth.alummahnow.net';

if (!RESEND_API_KEY) {
  console.error('❌ RESEND_API_KEY environment variable required');
  process.exit(1);
}

async function registerUser(user: TestUser): Promise<{
  userId: string;
  accessToken: string;
  refreshToken: string;
}> {
  console.log(`\n📝 Registering user: ${user.email}`);

  // Step 1: Register user
  const registerRes = await fetch(`${AUTH_SERVER_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      displayName: user.displayName
    })
  });

  if (!registerRes.ok) {
    const error = await registerRes.text();
    throw new Error(`Registration failed: ${error}`);
  }

  const { userId } = await registerRes.json();
  console.log(`✅ User registered: ${userId}`);

  // Step 2: Wait for verification email
  console.log('📧 Waiting for verification email...');
  const verificationCode = await retryWithBackoff(
    () => getVerificationCodeFromEmail(user.email),
    5,
    5000
  );
  console.log(`✅ Verification code retrieved: ${verificationCode}`);

  // Step 3: Verify email
  console.log('🔐 Verifying email...');
  const verifyRes = await fetch(`${AUTH_SERVER_URL}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      code: verificationCode
    })
  });

  if (!verifyRes.ok) {
    const error = await verifyRes.text();
    throw new Error(`Verification failed: ${error}`);
  }
  console.log('✅ Email verified');

  // Step 4: Get tokens
  console.log('🎟️  Obtaining JWT tokens...');
  const tokenRes = await fetch(`${AUTH_SERVER_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password
    })
  });

  if (!tokenRes.ok) {
    const error = await tokenRes.text();
    throw new Error(`Token request failed: ${error}`);
  }

  const { access_token, refresh_token } = await tokenRes.json();
  console.log('✅ Tokens obtained');

  return {
    userId,
    accessToken: access_token,
    refreshToken: refresh_token
  };
}

async function getVerificationCodeFromEmail(email: string): Promise<string> {
  const res = await fetch(`https://api.resend.com/emails?to=${email}`, {
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`
    }
  });

  if (!res.ok) {
    throw new Error(`Resend API error: ${res.status}`);
  }

  const { data } = await res.json();

  if (!data || data.length === 0) {
    throw new Error('No emails found');
  }

  // Get most recent email
  const latestEmail = data[0];

  // Fetch full email content
  const emailRes = await fetch(`https://api.resend.com/emails/${latestEmail.id}`, {
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`
    }
  });

  if (!emailRes.ok) {
    throw new Error(`Failed to fetch email: ${emailRes.status}`);
  }

  const emailData = await emailRes.json();

  // Extract verification code (6 digits)
  const htmlMatch = emailData.html?.match(/\b(\d{6})\b/);
  const textMatch = emailData.text?.match(/\b(\d{6})\b/);

  const code = htmlMatch?.[1] || textMatch?.[1];

  if (!code) {
    throw new Error('Verification code not found in email');
  }

  return code;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  initialDelay: number
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`   ⏳ Retry ${i + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

async function main() {
  console.log('🚀 Test User Registration Script');
  console.log(`📍 Auth Server: ${AUTH_SERVER_URL}`);
  console.log(`👥 Users to register: ${TEST_USERS.length}`);

  const credentials: Record<string, any> = {};

  for (const user of TEST_USERS) {
    try {
      const result = await registerUser(user);

      const key = user.email.split('@')[0].toUpperCase().replace(/-/g, '_');
      credentials[`${key}_EMAIL`] = user.email;
      credentials[`${key}_PASSWORD`] = user.password;
      credentials[`${key}_USER_ID`] = result.userId;
      credentials[`${key}_ACCESS_TOKEN`] = result.accessToken;
      credentials[`${key}_REFRESH_TOKEN`] = result.refreshToken;

      console.log(`✅ User setup complete: ${user.email}`);
    } catch (error) {
      console.error(`❌ Failed to register ${user.email}:`, error);
      process.exit(1);
    }
  }

  // Write credentials to .env.test.local
  const envPath = join(__dirname, '../../../.env.test.local');
  const envContent = Object.entries(credentials)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(envPath, envContent);
  console.log(`\n✅ Credentials saved to .env.test.local`);
  console.log('\n📋 Next steps:');
  console.log('   1. Add .env.test.local credentials to GitHub Secrets');
  console.log('   2. Update E2E tests to use real auth tokens');
  console.log('   3. Run tests: pnpm test:e2e');
}

main().catch(console.error);
```

**Usage:**
```bash
# Set Resend API key
export RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Run registration script
pnpm tsx apps/web/e2e/setup-test-users.ts

# Credentials saved to .env.test.local
```

---

### Option B: Automated in Tests (Not Recommended)

**Description:** Register users dynamically in `beforeAll()` hook

**Pros:**
- ✅ No manual setup required
- ✅ Fresh users for each test run
- ✅ Automatic cleanup possible

**Cons:**
- ❌ Slow test execution (registration overhead)
- ❌ Resend API rate limits hit quickly
- ❌ Complex error handling in tests
- ❌ CI/CD unpredictability

**Not recommended** due to performance and complexity issues.

---

### Option C: Manual Registration (Fallback)

**Description:** Manually register users via auth server UI

**Pros:**
- ✅ Simple to understand
- ✅ No automation code needed
- ✅ Visual verification

**Cons:**
- ❌ Time-consuming
- ❌ Error-prone
- ❌ Not scalable
- ❌ Difficult to replicate in CI/CD

**Use only as a fallback** if automated registration fails.

---

## Test User Fixtures

### Required Test Users

Based on E2E test requirements (from `19-dashboard-videos-ownership-README.md`):

```typescript
export const TEST_USERS = {
  // User 1: Single channel owner
  SINGLE_CHANNEL: {
    email: 'test-user-single-001@alummahnow-test.com',
    password: 'TestUser001!',
    displayName: 'Single Channel User',
    userId: '', // Set during registration
    accessToken: '', // Set during registration
    refreshToken: '', // Set during registration
    channels: 1,
    videos: {
      total: 10,
      public: 5,
      private: 5,
      short: 2,     // < 60 seconds
      standard: 5,  // 60s - 10min
      long: 3       // > 10 minutes
    }
  },

  // User 2: Multi-channel owner
  MULTI_CHANNEL: {
    email: 'test-user-multi-002@alummahnow-test.com',
    password: 'TestUser002!',
    displayName: 'Multi Channel User',
    userId: '',
    accessToken: '',
    refreshToken: '',
    channels: 3,
    videos: {
      total: 20,
      public: 10,
      private: 10,
      short: 4,
      standard: 10,
      long: 6
    }
  },

  // User 3: No channels (empty state)
  NO_CHANNELS: {
    email: 'test-user-none-003@alummahnow-test.com',
    password: 'TestUser003!',
    displayName: 'No Channels User',
    userId: '',
    accessToken: '',
    refreshToken: '',
    channels: 0,
    videos: {
      total: 0,
      public: 0,
      private: 0,
      short: 0,
      standard: 0,
      long: 0
    }
  },

  // Optional: Admin/moderator user (if applicable)
  ADMIN: {
    email: 'test-admin@alummahnow-test.com',
    password: 'AdminTest001!',
    displayName: 'Test Admin',
    userId: '',
    accessToken: '',
    refreshToken: '',
    role: 'admin',
    channels: 0,
    videos: { total: 0, public: 0, private: 0, short: 0, standard: 0, long: 0 }
  }
};
```

### Test Data Setup Requirements

**After user registration, additional setup needed:**

1. **Create channels** for each user (via API or UI)
2. **Upload videos** with specific privacy/duration settings
3. **Verify video metadata** matches test expectations

**Potential Setup Script:**
```bash
# After user registration
pnpm tsx apps/web/e2e/setup-test-data.ts
```

This script would:
- Create channels for users
- Upload sample videos
- Set video privacy/metadata
- Verify data integrity

---

## Security Considerations

### Credential Storage

**Development (Local):**
```bash
# .env.test.local (gitignored)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Test user credentials
TEST_USER_SINGLE_CHANNEL_EMAIL=test-user-single-001@alummahnow-test.com
TEST_USER_SINGLE_CHANNEL_PASSWORD=TestUser001!
TEST_USER_SINGLE_CHANNEL_USER_ID=user-001
TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN=eyJhbGc...
TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN=eyJhbGc...

TEST_USER_MULTI_CHANNEL_EMAIL=test-user-multi-002@alummahnow-test.com
# ... (repeat for all users)
```

**CI/CD (GitHub Actions):**
```yaml
# .github/workflows/e2e-tests.yml
env:
  RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
  TEST_USER_SINGLE_CHANNEL_EMAIL: ${{ secrets.TEST_USER_SINGLE_CHANNEL_EMAIL }}
  TEST_USER_SINGLE_CHANNEL_PASSWORD: ${{ secrets.TEST_USER_SINGLE_CHANNEL_PASSWORD }}
  TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN: ${{ secrets.TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN }}
  # ... (all test user credentials as secrets)
```

### Security Best Practices

**1. Separate Test Emails:**
- Use dedicated domain for tests (e.g., `alummahnow-test.com`)
- Use catch-all email forwarding to Resend
- Prevents production email pollution

**2. Strong Passwords:**
- Minimum 12 characters
- Mix of uppercase, lowercase, numbers, symbols
- Use password generator for consistency

**3. Token Rotation:**
- Refresh tokens before expiration (15 minutes before)
- Re-authenticate if refresh fails
- Store token expiration timestamps

**4. API Key Protection:**
- Never commit `.env.test.local` to git
- Use GitHub Secrets for CI/CD
- Rotate Resend API key quarterly
- Monitor API key usage in Resend dashboard

**5. Secure Transmission:**
- Always use HTTPS for auth requests
- Verify SSL certificates
- No credential logging (redact in logs)

**6. Cleanup Strategy:**
- Delete test users after test runs (optional)
- Archive old test data monthly
- Monitor auth server for abandoned accounts

### Gitignore Configuration

**Already configured in `.gitignore`:**
```gitignore
# Local env files
.env
.env*.local
.env.production
.env.development
```

**Verify `.env.test.local` is ignored:**
```bash
git check-ignore .env.test.local
# Should output: .env.test.local
```

---

## Development vs CI/CD Setup

### Local Development Setup

**Initial Setup (One-time):**
```bash
# 1. Install dependencies
pnpm install

# 2. Get Resend API key (from Resend dashboard)
#    https://resend.com/api-keys

# 3. Create .env.test.local
cat > .env.test.local <<EOF
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF

# 4. Run registration script
pnpm tsx apps/web/e2e/setup-test-users.ts

# 5. Verify credentials saved
cat .env.test.local

# 6. Run E2E tests
pnpm test:e2e
```

**Daily Development:**
```bash
# Tests read credentials from .env.test.local automatically
pnpm test:e2e

# If tokens expire, re-run registration:
pnpm tsx apps/web/e2e/setup-test-users.ts
```

### CI/CD Environment Setup

**GitHub Secrets Configuration:**

Navigate to: `https://github.com/meywd/AlUmmahNow/settings/secrets/actions`

**Required Secrets:**
```
RESEND_API_KEY
TEST_USER_SINGLE_CHANNEL_EMAIL
TEST_USER_SINGLE_CHANNEL_PASSWORD
TEST_USER_SINGLE_CHANNEL_USER_ID
TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN
TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN

TEST_USER_MULTI_CHANNEL_EMAIL
TEST_USER_MULTI_CHANNEL_PASSWORD
TEST_USER_MULTI_CHANNEL_USER_ID
TEST_USER_MULTI_CHANNEL_ACCESS_TOKEN
TEST_USER_MULTI_CHANNEL_REFRESH_TOKEN

TEST_USER_NO_CHANNELS_EMAIL
TEST_USER_NO_CHANNELS_PASSWORD
TEST_USER_NO_CHANNELS_USER_ID
TEST_USER_NO_CHANNELS_ACCESS_TOKEN
TEST_USER_NO_CHANNELS_REFRESH_TOKEN
```

**GitHub Actions Workflow (`.github/workflows/e2e-tests.yml`):**
```yaml
name: E2E Tests

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: pnpm --filter @al-ummah/web exec playwright install --with-deps

      - name: Create test environment file
        run: |
          cat > apps/web/.env.test.local <<EOF
          RESEND_API_KEY=${{ secrets.RESEND_API_KEY }}
          TEST_USER_SINGLE_CHANNEL_EMAIL=${{ secrets.TEST_USER_SINGLE_CHANNEL_EMAIL }}
          TEST_USER_SINGLE_CHANNEL_PASSWORD=${{ secrets.TEST_USER_SINGLE_CHANNEL_PASSWORD }}
          TEST_USER_SINGLE_CHANNEL_USER_ID=${{ secrets.TEST_USER_SINGLE_CHANNEL_USER_ID }}
          TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN=${{ secrets.TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN }}
          TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN=${{ secrets.TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN }}
          # ... (all test users)
          EOF

      - name: Run E2E tests
        run: pnpm --filter @al-ummah/web exec playwright test
        env:
          CI: true

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/
          retention-days: 30
```

**Token Refresh in CI/CD:**

Option 1: Manual rotation (every 24 hours)
```bash
# Run locally, update GitHub Secrets
pnpm tsx apps/web/e2e/setup-test-users.ts
```

Option 2: Automated refresh in workflow
```yaml
- name: Refresh test user tokens
  run: pnpm tsx apps/web/e2e/refresh-test-tokens.ts
  env:
    RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
    # User credentials...
```

---

## Code Implementation

### Directory Structure

```
apps/web/e2e/
├── setup-test-users.ts          # Main registration script
├── refresh-test-tokens.ts       # Token refresh script
├── test-user-config.ts          # Test user definitions
├── resend-client.ts             # Resend API client
├── auth-client.ts               # Auth server client
└── utils/
    ├── retry.ts                 # Retry logic with backoff
    ├── code-extractor.ts        # Email verification code extraction
    └── env-writer.ts            # .env file writing utility
```

### Core Modules

#### 1. Resend API Client (`resend-client.ts`)

```typescript
/**
 * Resend API Client for email retrieval
 */

export interface ResendEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  created_at: string;
}

export class ResendClient {
  private apiKey: string;
  private baseUrl = 'https://api.resend.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async listEmails(to?: string): Promise<ResendEmail[]> {
    const url = to
      ? `${this.baseUrl}/emails?to=${encodeURIComponent(to)}`
      : `${this.baseUrl}/emails`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!res.ok) {
      throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
    }

    const { data } = await res.json();
    return data || [];
  }

  async getEmail(emailId: string): Promise<ResendEmail> {
    const res = await fetch(`${this.baseUrl}/emails/${emailId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch email: ${res.status}`);
    }

    return res.json();
  }

  async getLatestEmailForAddress(email: string): Promise<ResendEmail | null> {
    const emails = await this.listEmails(email);
    return emails.length > 0 ? emails[0] : null;
  }
}
```

#### 2. Auth Server Client (`auth-client.ts`)

```typescript
/**
 * Auth Server Client for user registration and authentication
 */

export interface RegisterResponse {
  userId: string;
  verificationRequired: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class AuthClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://auth.alummahnow.net') {
    this.baseUrl = baseUrl;
  }

  async register(
    email: string,
    password: string,
    displayName: string
  ): Promise<RegisterResponse> {
    const res = await fetch(`${this.baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Registration failed: ${error}`);
    }

    return res.json();
  }

  async verifyEmail(email: string, code: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Email verification failed: ${error}`);
    }
  }

  async getTokens(email: string, password: string): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Token request failed: ${error}`);
    }

    return res.json();
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return res.json();
  }
}
```

#### 3. Verification Code Extractor (`utils/code-extractor.ts`)

```typescript
/**
 * Extract verification codes from email content
 */

export function extractVerificationCode(email: {
  html?: string;
  text?: string;
}): string | null {
  // Try HTML first
  if (email.html) {
    // Try strong tag
    const strongMatch = email.html.match(/<strong>(\d{6})<\/strong>/i);
    if (strongMatch) return strongMatch[1];

    // Try bold tag
    const boldMatch = email.html.match(/<b>(\d{6})<\/b>/i);
    if (boldMatch) return boldMatch[1];

    // Try generic 6-digit pattern
    const genericMatch = email.html.match(/\b(\d{6})\b/);
    if (genericMatch) return genericMatch[1];
  }

  // Try text content
  if (email.text) {
    // Try "code is: 123456" pattern
    const codeIsMatch = email.text.match(/code\s+is:?\s*(\d{6})/i);
    if (codeIsMatch) return codeIsMatch[1];

    // Try generic 6-digit pattern
    const genericMatch = email.text.match(/\b(\d{6})\b/);
    if (genericMatch) return genericMatch[1];
  }

  return null;
}
```

#### 4. Retry Utility (`utils/retry.ts`)

```typescript
/**
 * Retry function with exponential backoff
 */

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, delay: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelay = 5000,
    maxDelay = 60000,
    onRetry
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        const delay = Math.min(
          initialDelay * Math.pow(2, attempt),
          maxDelay
        );

        onRetry?.(attempt + 1, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

---

## Environment Setup Instructions

### For Developers

**Step 1: Get Resend API Key**
1. Go to https://resend.com/api-keys
2. Click "Create API Key"
3. Name: "Al Ummah Now E2E Tests"
4. Permissions: "Full Access"
5. Copy the API key (starts with `re_`)

**Step 2: Create `.env.test.local`**
```bash
cd /home/meywd/AlUmmahNow

cat > .env.test.local <<EOF
# Resend API Key for test user registration
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Test user credentials (will be populated by setup script)
EOF
```

**Step 3: Run Registration Script**
```bash
# Make script executable
chmod +x apps/web/e2e/setup-test-users.ts

# Run registration
pnpm tsx apps/web/e2e/setup-test-users.ts

# Verify credentials
cat .env.test.local
```

**Step 4: Update E2E Tests**

Modify `apps/web/e2e/fixtures.ts` to use real credentials:

```typescript
// Load test users from environment
const TEST_USER_SINGLE = {
  email: process.env.TEST_USER_SINGLE_CHANNEL_EMAIL!,
  password: process.env.TEST_USER_SINGLE_CHANNEL_PASSWORD!,
  userId: process.env.TEST_USER_SINGLE_CHANNEL_USER_ID!,
  accessToken: process.env.TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN!,
  refreshToken: process.env.TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN!
};

// Update login helper to use real auth
helpers.loginWithRealAuth = async (page: Page, user: typeof TEST_USER_SINGLE) => {
  // Set real JWT token
  await page.goto('/en');
  await page.evaluate((token) => {
    localStorage.setItem('access_token', token);
  }, user.accessToken);

  // Navigate to protected page
  await page.goto('/en/dashboard/videos');
  await page.waitForLoadState('networkidle');
};
```

**Step 5: Run E2E Tests**
```bash
pnpm --filter @al-ummah/web exec playwright test
```

---

### For CI/CD Setup

**Step 1: Add GitHub Secrets**

Navigate to: https://github.com/meywd/AlUmmahNow/settings/secrets/actions

Add each secret from `.env.test.local`:
1. Click "New repository secret"
2. Name: `RESEND_API_KEY`
3. Value: `re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
4. Click "Add secret"

Repeat for all test user credentials (15+ secrets total).

**Step 2: Update GitHub Actions Workflow**

Add secret injection to `.github/workflows/e2e-tests.yml`:

```yaml
- name: Create test environment
  run: |
    cat > apps/web/.env.test.local <<EOF
    RESEND_API_KEY=${{ secrets.RESEND_API_KEY }}
    TEST_USER_SINGLE_CHANNEL_EMAIL=${{ secrets.TEST_USER_SINGLE_CHANNEL_EMAIL }}
    TEST_USER_SINGLE_CHANNEL_PASSWORD=${{ secrets.TEST_USER_SINGLE_CHANNEL_PASSWORD }}
    TEST_USER_SINGLE_CHANNEL_USER_ID=${{ secrets.TEST_USER_SINGLE_CHANNEL_USER_ID }}
    TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN=${{ secrets.TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN }}
    TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN=${{ secrets.TEST_USER_SINGLE_CHANNEL_REFRESH_TOKEN }}
    # ... (all test users)
    EOF
```

**Step 3: Test CI/CD Pipeline**
```bash
# Push to trigger workflow
git add .github/workflows/e2e-tests.yml
git commit -m "feat: add real auth to E2E tests"
git push

# Monitor workflow in GitHub Actions
# https://github.com/meywd/AlUmmahNow/actions
```

---

## CI/CD Integration Strategy

### Token Lifecycle Management

**Problem:** JWT tokens expire (typically 1 hour)

**Solutions:**

**Option 1: Long-lived refresh tokens**
- Store refresh tokens in GitHub Secrets
- Add token refresh step before tests
- Refresh if access token expired

**Option 2: Re-register users before each test run**
- Run `setup-test-users.ts` in CI/CD
- Fresh tokens for each run
- Cleanup users after tests

**Option 3: Scheduled token refresh**
- GitHub Actions cron job (daily)
- Updates secrets via GitHub API
- Requires GitHub token with `repo` scope

**Recommended: Option 1** (simplest and most reliable)

### GitHub Actions Workflow Integration

```yaml
name: E2E Tests with Real Auth

on:
  pull_request:
  push:
    branches: [main, develop]
  schedule:
    # Refresh tokens daily at 00:00 UTC
    - cron: '0 0 * * *'

jobs:
  refresh-tokens:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - name: Refresh test user tokens
        run: pnpm tsx apps/web/e2e/refresh-test-tokens.ts
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          # ... all user credentials

  e2e-tests:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - name: Install dependencies
        run: pnpm install

      - name: Setup test environment
        run: |
          cat > apps/web/.env.test.local <<EOF
          RESEND_API_KEY=${{ secrets.RESEND_API_KEY }}
          # ... all credentials
          EOF

      - name: Install Playwright
        run: pnpm --filter @al-ummah/web exec playwright install --with-deps

      - name: Run E2E tests
        run: pnpm --filter @al-ummah/web exec playwright test
```

---

## Troubleshooting Guide

### Issue 1: Auth Server Endpoints Unknown

**Symptom:** Registration script fails with 404

**Diagnosis:**
```bash
# Test registration endpoint
curl -X POST https://auth.alummahnow.net/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","displayName":"Test"}'
```

**Solutions:**
1. Contact auth server maintainers for API documentation
2. Inspect auth server codebase for endpoint routes
3. Use browser dev tools on auth UI to capture API calls

---

### Issue 2: Resend API Not Receiving Emails

**Symptom:** No emails found when polling Resend

**Diagnosis:**
```bash
# Check Resend email list
curl -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/emails
```

**Solutions:**
1. Verify Resend is configured in auth server
2. Check auth server email sending logs
3. Verify email domain matches Resend domain
4. Check spam/junk folders (if using real domain)

---

### Issue 3: Verification Code Not Found in Email

**Symptom:** Code extraction fails

**Diagnosis:**
```bash
# Fetch email and inspect raw content
curl -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/emails/EMAIL_ID | jq .
```

**Solutions:**
1. Update regex pattern in `code-extractor.ts`
2. Log raw email content for debugging
3. Check email template in auth server

---

### Issue 4: JWT Token Invalid/Expired

**Symptom:** Tests fail with 401 Unauthorized

**Diagnosis:**
```typescript
// Decode JWT to check expiration
const payload = JSON.parse(atob(accessToken.split('.')[1]));
console.log('Expires:', new Date(payload.exp * 1000));
```

**Solutions:**
1. Refresh token using refresh token endpoint
2. Re-run registration script to get new tokens
3. Implement automatic token refresh in tests

---

### Issue 5: Rate Limited by Resend

**Symptom:** HTTP 429 Too Many Requests

**Diagnosis:**
```bash
# Check rate limit headers
curl -i -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/emails
```

**Solutions:**
1. Implement exponential backoff (already in retry logic)
2. Cache email lookups to reduce requests
3. Upgrade Resend plan for higher limits
4. Add delay between registration attempts

---

### Issue 6: GitHub Secrets Not Loading

**Symptom:** Tests fail in CI/CD with undefined environment variables

**Diagnosis:**
```yaml
- name: Debug secrets
  run: |
    echo "RESEND_API_KEY: ${RESEND_API_KEY:0:10}..." # Show first 10 chars
    echo "ACCESS_TOKEN: ${TEST_USER_SINGLE_CHANNEL_ACCESS_TOKEN:0:20}..."
```

**Solutions:**
1. Verify secrets are added to repository (not organization)
2. Check secret names match exactly (case-sensitive)
3. Ensure workflow has permission to access secrets
4. Re-add secrets if corrupted

---

## Security Best Practices Summary

### DO ✅

1. **Use dedicated test domain** (`alummahnow-test.com`)
2. **Store credentials in `.env.test.local`** (gitignored)
3. **Use GitHub Secrets for CI/CD**
4. **Rotate API keys quarterly**
5. **Use strong passwords** (12+ chars, mixed)
6. **Implement token refresh logic**
7. **Monitor API usage** (Resend dashboard)
8. **Use HTTPS for all requests**
9. **Redact credentials in logs**
10. **Cleanup test data periodically**

### DON'T ❌

1. **Never commit `.env.test.local`** to git
2. **Never hardcode credentials** in source code
3. **Never log full credentials** (redact sensitive parts)
4. **Never use production emails** for testing
5. **Never share API keys** publicly
6. **Never disable SSL verification**
7. **Never use weak passwords** (< 12 chars)
8. **Never store tokens in localStorage** (production apps)
9. **Never skip token expiration checks**
10. **Never reuse test credentials** for production

---

## Next Steps

### Phase 1: Discovery (Week 1)

**Tasks:**
- [ ] Contact auth server team for API documentation
- [ ] Confirm registration endpoint: `POST /api/register`
- [ ] Confirm verification endpoint: `POST /api/verify`
- [ ] Confirm token endpoint: `POST /token`
- [ ] Test endpoints manually with curl
- [ ] Document API contracts

**Deliverable:** API documentation for auth server

---

### Phase 2: Implementation (Week 2)

**Tasks:**
- [ ] Create Resend API client (`resend-client.ts`)
- [ ] Create Auth server client (`auth-client.ts`)
- [ ] Implement verification code extractor
- [ ] Implement retry utility with backoff
- [ ] Create main registration script (`setup-test-users.ts`)
- [ ] Test registration locally

**Deliverable:** Working registration script

---

### Phase 3: Integration (Week 3)

**Tasks:**
- [ ] Update E2E fixtures to use real auth
- [ ] Modify test helpers (`loginWithRealAuth()`)
- [ ] Test E2E suite locally with real auth
- [ ] Fix failing tests
- [ ] Document E2E test changes

**Deliverable:** E2E tests using real authentication

---

### Phase 4: CI/CD Setup (Week 4)

**Tasks:**
- [ ] Add GitHub Secrets (15+ secrets)
- [ ] Update GitHub Actions workflow
- [ ] Implement token refresh job (cron)
- [ ] Test CI/CD pipeline
- [ ] Monitor test runs for 1 week
- [ ] Document CI/CD setup

**Deliverable:** Production-ready CI/CD with real auth

---

## Conclusion

This comprehensive plan provides a clear roadmap for registering test users with the Al Ummah Now authentication server using automated email verification via Resend API. The recommended approach (Option A: Setup Script) balances automation, security, and maintainability.

**Key Takeaways:**
1. **Automated registration** reduces manual effort and errors
2. **Resend API integration** enables reliable email verification
3. **Secure credential management** protects sensitive data
4. **CI/CD integration** ensures tests run consistently
5. **Token refresh strategy** maintains long-term test reliability

**Critical Path:**
1. Discover auth server API endpoints (Week 1)
2. Implement registration script (Week 2)
3. Update E2E tests (Week 3)
4. Setup CI/CD (Week 4)

**Success Criteria:**
- ✅ 3+ test users registered and verified
- ✅ E2E tests pass with real authentication
- ✅ CI/CD pipeline runs reliably
- ✅ No credentials committed to git
- ✅ Token refresh works automatically

**Questions or Issues?**
- Development Team: dev@alummahnow.net
- Security Team: security@alummahnow.net
- Documentation: https://docs.alummahnow.net

---

**Document Maintained By:** QA Engineering Team
**Last Updated:** 2025-11-23
**Next Review:** 2025-12-23
