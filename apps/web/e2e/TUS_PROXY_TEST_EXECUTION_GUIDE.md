# TUS Proxy E2E Test Execution Guide

## Quick Start

```bash
# 1. Start all services
pnpm dev         # Web app (localhost:3001)
pnpm api:dev     # API (127.0.0.1:3086)

# 2. Run TUS proxy tests
pnpm test:e2e 17-tus-proxy-upload.spec.ts 18-tus-proxy-logs.spec.ts
```

## Prerequisites Checklist

### Required Services

- [ ] **Web App** running on http://localhost:3001
  ```bash
  pnpm web:dev
  # or
  cd apps/web && pnpm dev
  ```

- [ ] **API Server** running on http://127.0.0.1:3086
  ```bash
  pnpm api:dev
  # or
  cd apps/api-videos && pnpm dev
  ```

- [ ] **Log Service** running on http://localhost:3089 (optional for most tests)
  ```bash
  cd apps/log-service && pnpm dev
  ```

### Verify Services

```bash
# Check web app
curl http://localhost:3001 -I

# Check API
curl http://127.0.0.1:3086/api/videos -I

# Check logs (optional)
curl http://localhost:3089/logs/stream/realtime | head
```

### Verify Ports

```bash
# All services should be listening
lsof -i:3001,3086,3089 | grep LISTEN

# Expected output:
# node    <PID> user   xx TCP localhost:3001 (LISTEN)
# workerd <PID> user   xx TCP localhost:3086 (LISTEN)
# node    <PID> user   xx TCP localhost:3089 (LISTEN)
```

## Test Execution Commands

### Basic Execution

```bash
# Run all TUS proxy tests
pnpm test:e2e 17-tus-proxy-upload.spec.ts 18-tus-proxy-logs.spec.ts

# Run security tests only
pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "Security Verification"

# Run upload flow tests only
pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "Upload Flow"

# Run resumable upload tests only
pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "Resumable Upload"

# Run log tests only
pnpm test:e2e 18-tus-proxy-logs.spec.ts
```

### Browser-Specific Execution

```bash
# Chromium only (recommended for CI)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=chromium

# Firefox
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=firefox

# WebKit (Safari)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=webkit

# Mobile Chrome
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project="Mobile Chrome"

# Mobile Safari
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project="Mobile Safari"
```

### Debug and Development

```bash
# Run with UI mode (interactive, recommended for development)
pnpm test:e2e:ui 17-tus-proxy-upload.spec.ts

# Run in headed mode (see browser)
pnpm test:e2e:headed 17-tus-proxy-upload.spec.ts

# Run in debug mode (step through with debugger)
pnpm test:e2e:debug 17-tus-proxy-upload.spec.ts

# Run specific test by name
pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "should NEVER expose Bunny.net URLs"
```

### Reporting

```bash
# Generate HTML report (default)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=html

# View last HTML report
pnpm test:e2e:report

# Generate JSON report
pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=json

# Generate JUnit report (for CI)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=junit

# Multiple reporters
pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=html --reporter=json --reporter=junit
```

### Advanced Options

```bash
# Run with specific number of workers
pnpm test:e2e 17-tus-proxy-upload.spec.ts --workers=1

# Run with retries
pnpm test:e2e 17-tus-proxy-upload.spec.ts --retries=2

# Run with custom timeout (milliseconds)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --timeout=300000

# Run with video recording
pnpm test:e2e 17-tus-proxy-upload.spec.ts --video=on

# Run with screenshots
pnpm test:e2e 17-tus-proxy-upload.spec.ts --screenshot=on

# Run with tracing
pnpm test:e2e 17-tus-proxy-upload.spec.ts --trace=on
```

## Troubleshooting

### Issue: Tests Fail with "connect ECONNREFUSED"

**Cause**: Services not running

**Solution**:
```bash
# Check if services are running
lsof -i:3001,3086

# If not running, start them
pnpm dev
pnpm api:dev
```

### Issue: Tests Timeout

**Cause**: Upload takes too long or network issues

**Solution**:
```bash
# Increase timeout
pnpm test:e2e 17-tus-proxy-upload.spec.ts --timeout=600000

# Or run with fewer workers to reduce load
pnpm test:e2e 17-tus-proxy-upload.spec.ts --workers=1
```

### Issue: "Authentication required" Errors

**Cause**: Mock authentication not set up properly

**Solution**: Tests should handle this automatically. Check test fixtures in `/home/meywd/AlUmmahNow/apps/web/e2e/fixtures.ts`

### Issue: Log Service Tests Fail

**Cause**: Log service not running

**Solution**:
```bash
# Start log service
cd apps/log-service && pnpm dev

# Or skip log tests
pnpm test:e2e 17-tus-proxy-upload.spec.ts
```

### Issue: File Upload Fails in Tests

**Cause**: Test video files not created or permission issues

**Solution**:
```bash
# Check test fixtures directory
ls -la apps/web/e2e/test-fixtures/

# Clean up old test files
rm -rf apps/web/e2e/test-fixtures/*.mp4

# Re-run tests (files will be recreated)
pnpm test:e2e 17-tus-proxy-upload.spec.ts
```

### Issue: Network Interception Not Working

**Cause**: Playwright route handlers not properly set up

**Solution**: Check if you're using the latest Playwright version:
```bash
npx playwright --version
# Should be 1.40.0 or higher

# Update if needed
pnpm add -D @playwright/test@latest
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: TUS Proxy E2E Tests

on: [push, pull_request]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Start services in background
        run: |
          pnpm web:dev &
          pnpm api:dev &
          sleep 30

      - name: Run TUS proxy tests
        run: |
          pnpm test:e2e 17-tus-proxy-upload.spec.ts 18-tus-proxy-logs.spec.ts \
            --project=chromium \
            --workers=1 \
            --reporter=html \
            --reporter=junit

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/

      - name: Upload test videos
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: test-videos
          path: test-results/
```

## Test Data Management

### Test Video Files

Tests automatically create test video files in:
```
/home/meywd/AlUmmahNow/apps/web/e2e/test-fixtures/
```

**Cleanup**:
```bash
# Manual cleanup
rm -rf apps/web/e2e/test-fixtures/*.mp4

# Automatic cleanup happens after each test
```

**Custom test video**:
```typescript
// In your test
const videoPath = await helpers.createTestVideo('my-test.mp4', 2048); // 2MB
```

### Test Artifacts

After test execution, artifacts are stored in:
```
/home/meywd/AlUmmahNow/apps/web/test-results/
```

Contents:
- Screenshots (on failure)
- Videos (on failure or if `--video=on`)
- Traces (if `--trace=on`)
- Test reports (HTML/JSON/JUnit)

**View artifacts**:
```bash
# HTML report
open playwright-report/index.html
# or
pnpm test:e2e:report

# View trace
npx playwright show-trace test-results/<test-name>/trace.zip
```

## Performance Considerations

### Parallel Execution

```bash
# Fast (multiple workers, may cause timing issues)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --workers=4

# Recommended (single worker, more reliable)
pnpm test:e2e 17-tus-proxy-upload.spec.ts --workers=1
```

### Test Duration

Expected durations per test category:
- Security tests: 30-60 seconds
- Upload flow tests: 60-120 seconds
- Resumable upload tests: 90-180 seconds
- Error handling tests: 30-60 seconds
- Log tests: 30-60 seconds

**Total suite duration**: 10-20 minutes (single worker)

### Optimization Tips

1. **Run critical tests first**:
   ```bash
   pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "Security Verification"
   ```

2. **Use smaller test files**:
   ```typescript
   const videoPath = await helpers.createTestVideo('test.mp4', 512); // 512KB instead of 2MB
   ```

3. **Skip log tests in CI** (if log service not available):
   ```bash
   pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=chromium
   ```

4. **Run tests on specific browsers only**:
   ```bash
   pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=chromium
   ```

## Monitoring Test Execution

### Real-time Monitoring

```bash
# In one terminal: Run tests
pnpm test:e2e:headed 17-tus-proxy-upload.spec.ts

# In another terminal: Monitor network
watch -n 1 'lsof -i:3001,3086 | wc -l'

# Monitor logs
tail -f apps/log-service/logs/*.log
```

### Debugging Failed Tests

1. **Check test output**:
   ```bash
   pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=list
   ```

2. **Run specific failed test**:
   ```bash
   pnpm test:e2e 17-tus-proxy-upload.spec.ts --grep "test name" --headed
   ```

3. **View trace**:
   ```bash
   npx playwright show-trace test-results/<test-name>/trace.zip
   ```

4. **Check screenshots**:
   ```bash
   open test-results/<test-name>/test-failed-1.png
   ```

5. **Review video**:
   ```bash
   open test-results/<test-name>/video.webm
   ```

## Best Practices

1. ✅ **Always start services before running tests**
2. ✅ **Use single worker for upload tests** (--workers=1)
3. ✅ **Run security tests first** (critical for deployment)
4. ✅ **Keep test video files small** (< 2MB for faster execution)
5. ✅ **Clean up test artifacts regularly**
6. ✅ **Use UI mode for debugging** (pnpm test:e2e:ui)
7. ✅ **Review HTML report after each run**
8. ✅ **Run tests in CI/CD pipeline**

## Support

### Documentation
- [Test Documentation](./TUS_PROXY_TEST_DOCUMENTATION.md)
- [TUS Proxy Implementation](/home/meywd/AlUmmahNow/apps/api-videos/src/endpoints/video/tus/tusProxy.ts)
- [TUS Client Guide](/home/meywd/AlUmmahNow/apps/api-videos/TUS_PROXY_CLIENT_GUIDE.md)

### Issues
- GitHub Issues: https://github.com/meywd/AlUmmahNow/issues
- Test Failures: Check `playwright-report/index.html`
- CI/CD Logs: `.github/workflows/deploy.yml`

---

**Last Updated**: 2025-11-21
**Version**: 1.0.0
