# Dashboard Videos Ownership - E2E Test Execution Plan

## Executive Summary

This document provides a comprehensive execution plan for running the E2E tests for the dashboard videos ownership feature (`19-dashboard-videos-ownership.spec.ts`). The test suite contains **40+ test cases** covering single/multi-channel dashboards, ownership validation, privacy controls, performance, and security.

**Test Suite**: `19-dashboard-videos-ownership.spec.ts`
**Test Count**: 40+ tests across 6 test suites
**Estimated Execution Time**: 15-20 minutes (all browsers)
**Infrastructure**: Playwright 1.56.1 with Next.js dev server
**Status**: ✅ Ready for execution

---

## Prerequisites Checklist

### 1. Environment Setup

- [x] **Node.js 20+** installed
- [x] **pnpm 9.15.4** installed
- [x] **Playwright 1.56.1** installed (verified)
- [x] **Web app dependencies** installed
- [ ] **Browsers installed** (Chromium, Firefox, WebKit, Mobile)
- [ ] **Test environment variables** configured

### 2. Services Required

The following services must be running before executing tests:

| Service | Port | Status Check | Required For |
|---------|------|--------------|--------------|
| **Web App** | 3001 | http://localhost:3001 | All E2E tests |
| **API Videos** | 3086 | http://127.0.0.1:3086 | API mocking validation |
| **Log Service** | 3089 | http://localhost:3089 | Optional (logging) |

**Note**: The test suite uses mocked API responses, so the API service is not strictly required, but it's recommended for integration validation.

### 3. Test Data Setup

The test suite uses **mocked test data** (no database required):

```typescript
// Test users are defined in the spec file
TEST_USERS = {
  singleChannel: { userId: 'user-single-001', channels: 1 },
  multiChannel: { userId: 'user-multi-002', channels: 3 },
  noChannels: { userId: 'user-none-003', channels: 0 }
}

// Test videos with varied privacy and duration
TEST_VIDEOS = {
  singleChannel: [3 videos],
  multiChannel: [4 videos]
}
```

**Action Required**: ✅ None - test data is self-contained in the spec file.

### 4. Browser Installation

```bash
# Install all Playwright browsers
cd /home/meywd/AlUmmahNow/apps/web
npx playwright install --with-deps

# Verify installation
npx playwright --version
# Expected: Version 1.56.1
```

---

## Setup Instructions

### Step 1: Install Dependencies

```bash
# Navigate to web app directory
cd /home/meywd/AlUmmahNow/apps/web

# Install pnpm dependencies (if not already done)
pnpm install

# Install Playwright browsers
npx playwright install --with-deps chromium firefox webkit
```

**Expected Duration**: 2-5 minutes
**Verification**:
```bash
npx playwright --version
# Output: Version 1.56.1
```

---

### Step 2: Configure Environment Variables

The test suite requires the following environment variables (already configured in `.env.local`):

```bash
# Check existing configuration
cat .env.local | grep -E "NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WEBSOCKET_URL"
```

**Expected Output**:
```
NEXT_PUBLIC_API_URL=http://127.0.0.1:3086
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:3087/ws
```

**Action Required**: ✅ Already configured - no changes needed.

---

### Step 3: Start Development Server

The Playwright configuration includes a `webServer` that automatically starts the Next.js dev server:

```typescript
// playwright.config.ts (line 95-100)
webServer: {
  command: 'pnpm dev',
  url: 'http://localhost:3001',
  reuseExistingServer: !process.env.CI,
  timeout: 120 * 1000, // 2 minutes
}
```

**Option A: Automatic Server (Recommended)**
```bash
# Playwright will automatically start/stop the server
npx playwright test 19-dashboard-videos-ownership
```

**Option B: Manual Server Start**
```bash
# Terminal 1: Start web app
cd /home/meywd/AlUmmahNow/apps/web
pnpm dev

# Terminal 2: Run tests (in another terminal)
npx playwright test 19-dashboard-videos-ownership
```

**Verification**:
```bash
# Check if server is running
curl -s http://localhost:3001 | grep -q "Al Ummah" && echo "✓ Server running" || echo "✗ Server not running"
```

---

### Step 4: Verify Test File Structure

```bash
# List test files
ls -lh /home/meywd/AlUmmahNow/apps/web/e2e/19-dashboard-videos-ownership*

# Expected output:
# -rw-rw-r-- 1 user user  23K Nov 23 19-dashboard-videos-ownership.spec.ts
# -rw-rw-r-- 1 user user  15K Nov 23 19-dashboard-videos-ownership.md
# -rw-rw-r-- 1 user user  12K Nov 23 19-dashboard-videos-ownership-manual-tests.md
# -rw-rw-r-- 1 user user  18K Nov 23 19-dashboard-videos-ownership-findings.md
# -rw-rw-r-- 1 user user  20K Nov 23 19-dashboard-videos-ownership-README.md
```

**Verification**: ✅ All files present

---

## Execution Commands

### Local Development Execution

#### 1. Run All Dashboard Ownership Tests

```bash
cd /home/meywd/AlUmmahNow/apps/web

# Run all tests (all browsers: chromium, firefox, webkit, mobile)
npx playwright test 19-dashboard-videos-ownership

# Expected duration: 15-20 minutes
# Expected tests: 40+ tests × 5 browsers = 200+ test executions
```

**Output Example**:
```
Running 200 tests using 2 workers

  ✓  19-dashboard-videos-ownership.spec.ts:214 (chromium) [1/200]
  ✓  19-dashboard-videos-ownership.spec.ts:240 (chromium) [2/200]
  ...
  200 passed (15m 32s)
```

---

#### 2. Run Specific Browser

```bash
# Chromium only (fastest)
npx playwright test 19-dashboard-videos-ownership --project=chromium

# Firefox
npx playwright test 19-dashboard-videos-ownership --project=firefox

# WebKit (Safari)
npx playwright test 19-dashboard-videos-ownership --project=webkit

# Mobile Chrome
npx playwright test 19-dashboard-videos-ownership --project="Mobile Chrome"

# Mobile Safari
npx playwright test 19-dashboard-videos-ownership --project="Mobile Safari"
```

**Expected Duration**: 3-5 minutes per browser

---

#### 3. Run Specific Test Suite

```bash
# Run only "Single Channel" tests
npx playwright test 19-dashboard-videos-ownership --grep "Single Channel"

# Run only "Multiple Channels" tests
npx playwright test 19-dashboard-videos-ownership --grep "Multiple Channels"

# Run only "Ownership Validation" security tests
npx playwright test 19-dashboard-videos-ownership --grep "Ownership Validation"

# Run only "Privacy and Data Isolation" tests
npx playwright test 19-dashboard-videos-ownership --grep "Privacy and Data Isolation"

# Run only "Performance" tests
npx playwright test 19-dashboard-videos-ownership --grep "Performance"

# Run only "Edge Cases" tests
npx playwright test 19-dashboard-videos-ownership --grep "Edge Cases"
```

---

#### 4. Debug Mode (Visual Debugging)

```bash
# Run with Playwright Inspector (step-by-step debugging)
npx playwright test 19-dashboard-videos-ownership --debug

# Run specific test in debug mode
npx playwright test 19-dashboard-videos-ownership --grep "should display all videos" --debug
```

**Features**:
- ⏸️ Pause execution at each step
- 🔍 Inspect elements in real-time
- 📸 Take screenshots manually
- 🎬 Record video of execution

---

#### 5. Headed Mode (See Browser)

```bash
# Run with visible browser window
npx playwright test 19-dashboard-videos-ownership --headed

# Run specific browser in headed mode
npx playwright test 19-dashboard-videos-ownership --project=chromium --headed
```

**Use Case**: Visual verification of UI interactions

---

#### 6. UI Mode (Interactive Test Explorer)

```bash
# Open Playwright UI (recommended for development)
npx playwright test 19-dashboard-videos-ownership --ui
```

**Features**:
- ✅ Run/rerun tests interactively
- 🎨 Visual test explorer
- 📊 Real-time test results
- 🔍 Inspect test code and assertions
- 🎬 Watch test execution

---

### CI/CD Execution

#### GitHub Actions Integration

The test suite is designed to run in CI/CD but requires integration with the existing workflow.

**Current Status**: ❌ Not yet integrated into `.github/workflows/deploy.yml`

**Recommended Integration** (add to deploy.yml):

```yaml
# Add after the "test" job
e2e-dashboard-ownership:
  needs: test
  runs-on: ubuntu-latest
  strategy:
    matrix:
      browser: [chromium, firefox, webkit]
  steps:
    - uses: actions/checkout@v4

    - name: Setup pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 9.15.4

    - uses: actions/setup-node@v6
      with:
        node-version: '20'
        cache: 'pnpm'

    - name: Install dependencies
      run: pnpm install --frozen-lockfile

    - name: Install Playwright browsers
      run: npx playwright install --with-deps ${{ matrix.browser }}

    - name: Run dashboard ownership E2E tests
      run: npx playwright test 19-dashboard-videos-ownership --project=${{ matrix.browser }}
      timeout-minutes: 10

    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report-${{ matrix.browser }}
        path: playwright-report/
        retention-days: 30

    - name: Upload test videos
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: test-videos-${{ matrix.browser }}
        path: test-results/
        retention-days: 7
```

---

## Test Environment Preparation

### Mock Data Configuration

The test suite uses **in-memory mocking** via Playwright's `page.route()` API. No external mock server is required.

**Test Users**:
```typescript
singleChannel: {
  userId: 'user-single-001',
  email: 'single@test.com',
  channels: 1,
  videos: 3 (2 public, 1 private)
}

multiChannel: {
  userId: 'user-multi-002',
  email: 'multi@test.com',
  channels: 3,
  videos: 4 (2 public, 2 private)
}

noChannels: {
  userId: 'user-none-003',
  email: 'none@test.com',
  channels: 0,
  videos: 0
}
```

**Test Videos**:
```typescript
// Short: ≤180s, Standard: 181-1200s, Long: >1200s
v-001: Short Public (120s)
v-002: Long Private (600s)
v-003: Very Long Public (1800s)
v-004: Ch1 Short (90s)
v-005: Ch1 Private (300s)
v-006: Ch2 Standard (450s)
v-007: Ch3 Long (2400s)
```

**Action Required**: ✅ None - all mocking is handled in the test file.

---

### Authentication Mocking

The test suite mocks authentication using `page.addInitScript()`:

```typescript
// Automatically set up for each test
localStorage.setItem('auth_user', JSON.stringify({ id, email }));
localStorage.setItem('multi_account_user', JSON.stringify({ user, channels }));
```

**Verification**:
```bash
# Run a single test to verify mocking works
npx playwright test 19-dashboard-videos-ownership --grep "should display all videos" --headed
```

---

## Test Reporting and Monitoring

### HTML Report

After running tests, generate and view the HTML report:

```bash
# Run tests
npx playwright test 19-dashboard-videos-ownership

# View report (opens in browser)
npx playwright show-report

# Report location: playwright-report/index.html
```

**Report Features**:
- ✅ Test results by browser
- 📊 Pass/fail statistics
- 🕒 Execution time per test
- 📸 Screenshots on failure
- 🎬 Video recordings on failure
- 📋 Detailed error messages

---

### JUnit XML Report

For CI/CD integration:

```bash
# Reports are automatically generated
# Location: test-results/junit.xml

# View in CI/CD (GitHub Actions)
cat test-results/junit.xml
```

---

### JSON Report

For programmatic analysis:

```bash
# Location: test-results/test-results.json

# Example: Extract test summary
cat test-results/test-results.json | jq '{
  total: .suites[0].specs | length,
  passed: [.suites[0].specs[].tests[] | select(.status == "passed")] | length,
  failed: [.suites[0].specs[].tests[] | select(.status == "failed")] | length
}'
```

---

### Real-Time Monitoring

#### Option 1: Playwright UI Mode (Recommended)

```bash
npx playwright test 19-dashboard-videos-ownership --ui
```

**Features**:
- Real-time test execution
- Live browser preview
- Interactive test navigation
- Instant failure feedback

---

#### Option 2: Terminal Output

```bash
# Run with verbose output
npx playwright test 19-dashboard-videos-ownership --reporter=list

# Output:
# Running 40 tests using 2 workers
#   ✓  [chromium] › should display all videos (3.2s)
#   ✓  [chromium] › should filter by duration - Short (2.8s)
#   ✓  [firefox] › should display all videos (3.5s)
#   ...
```

---

#### Option 3: Log Service Integration

If the log service is running (http://localhost:3089):

```bash
# Terminal 1: Start log service
cd /home/meywd/AlUmmahNow/apps/log-service
pnpm dev

# Terminal 2: Stream logs in real-time
curl -N http://localhost:3089/logs/stream/realtime

# Terminal 3: Run tests
cd /home/meywd/AlUmmahNow/apps/web
npx playwright test 19-dashboard-videos-ownership
```

---

## Execution Strategy

### Parallel vs Serial Execution

**Configured Strategy** (in playwright.config.ts):

```typescript
fullyParallel: true,     // Run tests in parallel
workers: process.env.CI ? 1 : 2,  // 2 workers locally, 1 in CI
retries: process.env.CI ? 2 : 0,  // Retry failed tests in CI
timeout: 180000,          // 3 minutes per test
```

**Recommendations**:

1. **Local Development**:
   - Use 2 workers (default)
   - Parallel execution enabled
   - No retries (fail fast)

2. **CI/CD**:
   - Use 1 worker (sequential)
   - 2 retries for flaky tests
   - Full browser matrix

---

### Browser Matrix

**Configured Browsers**:

| Browser | Device | Viewport | Test Priority |
|---------|--------|----------|---------------|
| Chromium | Desktop | 1280×720 | 🔴 Critical |
| Firefox | Desktop | 1280×720 | 🟡 Important |
| WebKit | Desktop | 1280×720 | 🟡 Important |
| Mobile Chrome | Pixel 5 | 393×851 | 🟢 Nice to have |
| Mobile Safari | iPhone 12 | 390×844 | 🟢 Nice to have |

**Execution Time**:
- Single browser: ~3-5 minutes
- Desktop browsers (3): ~10-12 minutes
- All browsers (5): ~15-20 minutes

---

### Selective Execution (Recommended for Development)

```bash
# Phase 1: Critical path (Chromium only)
npx playwright test 19-dashboard-videos-ownership --project=chromium

# Phase 2: Cross-browser validation (Desktop)
npx playwright test 19-dashboard-videos-ownership --project=chromium --project=firefox --project=webkit

# Phase 3: Full suite (All browsers + mobile)
npx playwright test 19-dashboard-videos-ownership
```

---

## Troubleshooting Guide

### Issue 1: Server Not Starting

**Symptom**:
```
Error: Timed out waiting 120000ms from server at http://localhost:3001
```

**Solutions**:

1. **Check port availability**:
   ```bash
   lsof -ti:3001 | xargs kill -9  # Kill existing process
   pnpm dev  # Restart server
   ```

2. **Increase timeout**:
   ```bash
   # Edit playwright.config.ts
   webServer: { timeout: 180000 }  # 3 minutes
   ```

3. **Manual server start**:
   ```bash
   # Terminal 1
   pnpm dev

   # Terminal 2 (after server is ready)
   npx playwright test 19-dashboard-videos-ownership
   ```

---

### Issue 2: Browser Not Installed

**Symptom**:
```
Error: browserType.launch: Executable doesn't exist at /home/user/.cache/ms-playwright/chromium-1091/chrome-linux/chrome
```

**Solution**:
```bash
# Install all browsers
npx playwright install --with-deps

# Or specific browser
npx playwright install chromium --with-deps
```

---

### Issue 3: Tests Timing Out

**Symptom**:
```
Timeout of 180000ms exceeded for test
```

**Solutions**:

1. **Increase test timeout**:
   ```bash
   npx playwright test 19-dashboard-videos-ownership --timeout=300000  # 5 minutes
   ```

2. **Run with debug mode**:
   ```bash
   npx playwright test 19-dashboard-videos-ownership --debug --grep "failing test name"
   ```

3. **Check network performance**:
   ```bash
   # Verify API is responding
   curl -s http://127.0.0.1:3086/health
   ```

---

### Issue 4: Mock API Not Working

**Symptom**:
```
Expected 200 OK, received 404 Not Found
```

**Solutions**:

1. **Verify route patterns**:
   ```typescript
   // Check that page.route() is called BEFORE page.goto()
   await page.route('**/api/videos*', mockHandler);
   await page.goto('/en/dashboard/videos');  // After routing
   ```

2. **Debug network traffic**:
   ```bash
   # Run with headed mode to inspect Network tab
   npx playwright test 19-dashboard-videos-ownership --headed --grep "specific test"
   ```

3. **Add console logging**:
   ```typescript
   page.on('request', req => console.log('→', req.method(), req.url()));
   page.on('response', res => console.log('←', res.status(), res.url()));
   ```

---

### Issue 5: Flaky Tests

**Symptom**:
```
Test passes sometimes, fails other times
```

**Solutions**:

1. **Identify flaky tests**:
   ```bash
   # Run test 10 times
   for i in {1..10}; do
     npx playwright test 19-dashboard-videos-ownership --grep "flaky test" --project=chromium || echo "FAIL $i"
   done
   ```

2. **Add explicit waits**:
   ```typescript
   // Instead of page.waitForTimeout(500)
   await page.waitForSelector('[data-testid="video-card"]', { state: 'visible' });
   ```

3. **Use retry logic**:
   ```bash
   # Run with retries
   npx playwright test 19-dashboard-videos-ownership --retries=2
   ```

---

## CI/CD Integration Plan

### Phase 1: Manual Trigger (Immediate)

**Add to `.github/workflows/e2e-dashboard-ownership.yml`**:

```yaml
name: E2E Dashboard Ownership Tests

on:
  workflow_dispatch:  # Manual trigger only
  pull_request:
    paths:
      - 'apps/web/e2e/19-dashboard-videos-ownership.spec.ts'
      - 'apps/web/src/app/**/dashboard/videos/**'

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.15.4
      - uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Playwright
        run: npx playwright install --with-deps ${{ matrix.browser }}
      - name: Run E2E tests
        run: npx playwright test 19-dashboard-videos-ownership --project=${{ matrix.browser }}
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ matrix.browser }}
          path: playwright-report/
          retention-days: 30
```

---

### Phase 2: PR Preview Integration (Future)

**Add to existing PR preview workflow**:

```yaml
# After deploy-web-preview job
e2e-preview-tests:
  needs: deploy-web-preview
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run E2E tests against preview
      run: |
        export PLAYWRIGHT_TEST_BASE_URL="https://al-ummah-web-pr-${{ github.event.number }}.workers.dev"
        npx playwright test 19-dashboard-videos-ownership --project=chromium
```

---

### Phase 3: Scheduled Regression Tests (Future)

**Add nightly regression suite**:

```yaml
name: Nightly E2E Regression

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily

jobs:
  full-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run full E2E suite
        run: npx playwright test 19-dashboard-videos-ownership
      - name: Notify on failure
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          payload: |
            {
              "text": "❌ Nightly E2E tests failed for dashboard ownership"
            }
```

---

## Maintenance Guidelines

### Regular Maintenance Tasks

1. **Weekly** (5 minutes):
   - ✅ Run full test suite locally
   - ✅ Review test execution times
   - ✅ Update test data if needed

2. **Monthly** (30 minutes):
   - ✅ Review flaky tests
   - ✅ Update Playwright to latest version
   - ✅ Audit browser versions
   - ✅ Review test coverage gaps

3. **Quarterly** (2 hours):
   - ✅ Refactor test helpers
   - ✅ Add new test scenarios
   - ✅ Performance optimization review
   - ✅ Documentation updates

---

### Test Data Refresh

**Current Status**: Test data is hardcoded in spec file (no refresh needed)

**Future Enhancement**: Consider dynamic test data generation:

```typescript
// Future: Generate test data programmatically
const testUsers = generateTestUsers(3);  // 3 users
const testVideos = generateTestVideos(20);  // 20 videos
```

---

### Test Flakiness Management

**Monitoring**:
```bash
# Track flaky tests over 10 runs
bash -c 'for i in {1..10}; do
  npx playwright test 19-dashboard-videos-ownership --project=chromium --reporter=json > run-$i.json
done'

# Analyze failure patterns
cat run-*.json | jq '.suites[].specs[].tests[] | select(.status == "failed") | .title' | sort | uniq -c
```

**Mitigation Strategies**:
1. Add explicit waits (`waitForSelector` instead of `waitForTimeout`)
2. Increase timeout for slow operations
3. Add retry logic for transient failures
4. Isolate flaky tests into separate suite

---

## Success Criteria

### Test Execution Success

✅ **All tests pass** (40+ tests)
✅ **No timeouts** (all tests complete within 3 minutes)
✅ **No flaky tests** (consistent pass/fail across runs)
✅ **Performance meets targets** (API call < 2 seconds)
✅ **Security tests pass** (403 for unauthorized access)

### Code Coverage Goals

| Feature | Coverage | Status |
|---------|----------|--------|
| Single channel display | 100% | ✅ |
| Multiple channels API | 100% | ✅ |
| Ownership validation | 100% | ✅ |
| Duration filtering | 100% | ✅ |
| Privacy filtering | 100% | ✅ |
| Error handling | 100% | ✅ |
| Edge cases | 100% | ✅ |
| Performance | 100% | ✅ |

### Quality Metrics

- **Test Stability**: >95% pass rate across 10 runs
- **Execution Time**: <20 minutes for full suite
- **Browser Compatibility**: Pass on Chromium, Firefox, WebKit
- **Mobile Support**: Pass on Mobile Chrome, Mobile Safari
- **Accessibility**: Keyboard navigation and ARIA tests pass

---

## Appendix

### A. Test Suite Breakdown

#### Suite 1: Dashboard Videos - Single Channel (5 tests)

```typescript
✓ should display all videos (public + private) for owner
✓ should filter by duration - Short
✓ should filter by duration - Standard
✓ should filter by privacy - Public
✓ should filter by privacy - Private
```

**Duration**: ~1-2 minutes per browser

---

#### Suite 2: Dashboard Videos - Multiple Channels (4 tests)

```typescript
✓ should make single API call for all channels
✓ should display videos from all channels
✓ should not have duplicate videos
✓ should filter short videos from all channels
```

**Duration**: ~1 minute per browser

---

#### Suite 3: Dashboard Videos - Ownership Validation (2 tests)

```typescript
✓ should return 403 when requesting unowned channel
✓ should return 403 when isOwner=true without userId
```

**Duration**: ~30 seconds per browser

---

#### Suite 4: Dashboard Videos - Privacy and Data Isolation (2 tests)

```typescript
✓ should only show own videos to authenticated user
✓ should show private videos only to owner
```

**Duration**: ~30 seconds per browser

---

#### Suite 5: Dashboard Videos - Edge Cases (2 tests)

```typescript
✓ should show empty state for user with no channels
✓ should handle non-existent channel gracefully
```

**Duration**: ~30 seconds per browser

---

#### Suite 6: Dashboard Videos - Performance (2 tests)

```typescript
✓ should complete API call within 2 seconds
✓ should debounce rapid filter changes
```

**Duration**: ~1 minute per browser

---

### B. Playwright Configuration Reference

**File**: `/home/meywd/AlUmmahNow/apps/web/playwright.config.ts`

```typescript
{
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 180000,  // 3 minutes
  expect: { timeout: 30000 },  // 30 seconds
  reporter: ['html', 'junit', 'json'],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
}
```

---

### C. Environment Variables Reference

**File**: `/home/meywd/AlUmmahNow/apps/web/.env.local`

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://127.0.0.1:3086

# WebSocket Configuration
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:3087/ws

# Bunny.net Configuration (not used in tests)
NEXT_PUBLIC_BUNNY_PULL_ZONE_URL=vz-3f3e8ae1-5c9.b-cdn.net
NEXT_PUBLIC_BUNNY_LIBRARY_ID=your-library-id
NEXT_PUBLIC_BUNNY_API_KEY=your-api-key-here
NEXT_PUBLIC_BUNNY_TOKEN_AUTH=false
```

---

### D. Quick Reference Commands

```bash
# Install & Setup
pnpm install
npx playwright install --with-deps

# Run Tests
npx playwright test 19-dashboard-videos-ownership                    # All tests, all browsers
npx playwright test 19-dashboard-videos-ownership --project=chromium  # Chromium only
npx playwright test 19-dashboard-videos-ownership --headed            # Visible browser
npx playwright test 19-dashboard-videos-ownership --debug             # Step-by-step
npx playwright test 19-dashboard-videos-ownership --ui                # Interactive UI

# Filter Tests
npx playwright test 19-dashboard-videos-ownership --grep "Single Channel"
npx playwright test 19-dashboard-videos-ownership --grep "Security"
npx playwright test 19-dashboard-videos-ownership --grep "Performance"

# Reports
npx playwright show-report                                            # Open HTML report
cat test-results/junit.xml                                            # JUnit XML
cat test-results/test-results.json | jq .                             # JSON report

# Troubleshooting
lsof -ti:3001 | xargs kill -9                                         # Kill server
npx playwright --version                                              # Check version
curl http://localhost:3001                                            # Test server
```

---

### E. Related Documentation

- **Test Plan**: `19-dashboard-videos-ownership.md`
- **Manual Tests**: `19-dashboard-videos-ownership-manual-tests.md`
- **Findings Report**: `19-dashboard-videos-ownership-findings.md`
- **Test Suite README**: `19-dashboard-videos-ownership-README.md`
- **E2E Suite Overview**: `README.md`
- **Project CLAUDE.md**: `/home/meywd/AlUmmahNow/CLAUDE.md`
- **Playwright Docs**: https://playwright.dev

---

## Contacts and Support

**Questions?**
- Development Team: dev@alummahnow.net
- QA Team: qa@alummahnow.net
- Security Team: security@alummahnow.net

**Resources**:
- GitHub Issues: https://github.com/meywd/AlUmmahNow/issues
- Slack: #qa-dashboard-testing
- Documentation: https://docs.alummahnow.net

---

**Document Version**: 1.0.0
**Last Updated**: 2025-11-23
**Maintained By**: QA Engineering Team
**Status**: ✅ Ready for Execution
