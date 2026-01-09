# Test Execution Guide

## Overview

This guide provides comprehensive instructions for executing all test cases in the Al Ummah Now platform, including setup, execution, reporting, and maintenance procedures.

## Prerequisites

### System Requirements

- **Node.js**: 18.x or higher
- **pnpm**: 9.x or higher
- **Playwright**: Latest version
- **Memory**: Minimum 8GB RAM
- **Storage**: Minimum 10GB free space
- **Network**: Stable internet connection

### Environment Setup

```bash
# Clone repository (if not already done)
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow

# Install dependencies
pnpm install

# Build shared types (required first)
pnpm --filter @al-ummah/shared-types build

# Install Playwright browsers
pnpm exec playwright install

# Verify setup
pnpm test:e2e --dry-run
```

## Test Categories and Execution

### 1. Video Platform Tests (10/10 completed)

```bash
# Run all video platform tests
pnpm test:e2e --grep "TC-VID"

# Run specific video tests
pnpm test:e2e --grep "TC-VID-001"  # Video Playback
pnpm test:e2e --grep "TC-VID-002"  # Video Quality Selection
pnpm test:e2e --grep "TC-VID-003"  # Video Progress Tracking
```

### 2. Authentication Tests (16/16 completed)

```bash
# Run all authentication tests
pnpm test:e2e --grep "TC-AUTH"

# Run specific auth tests
pnpm test:e2e --grep "TC-AUTH-001"  # User Login Valid
pnpm test:e2e --grep "TC-AUTH-002"  # User Login Invalid
pnpm test:e2e --grep "TC-AUTH-003"  # Multi-Account Switching
```

### 3. Bilingual Support Tests (10/10 completed)

```bash
# Run all bilingual tests
pnpm test:e2e --grep "TC-BIL"

# Run specific bilingual tests
pnpm test:e2e --grep "TC-BIL-001"  # Language Switching
pnpm test:e2e --grep "TC-BIL-002"  # Translation Accuracy
pnpm test:e2e --grep "TC-BIL-003"  # RTL Layout Consistency
```

### 4. Mobile Responsive Tests (9/9 completed)

```bash
# Run all mobile tests
pnpm test:e2e --grep "TC-MOB"

# Run specific mobile tests
pnpm test:e2e --grep "TC-MOB-001"  # Mobile Touch Targets
pnpm test:e2e --grep "TC-MOB-002"  # Mobile Navigation
pnpm test:e2e --grep "TC-MOB-003"  # Mobile Form Testing
```

### 5. Channel Management Tests (NEW)

```bash
# Run all channel management tests
pnpm test:e2e --grep "TC-CHAN"

# Run specific channel tests
pnpm test:e2e --grep "TC-CHAN-001"  # Channel Creation
pnpm test:e2e --grep "TC-CHAN-002"  # Channel Customization
pnpm test:e2e --grep "TC-CHAN-003"  # Content Management
```

### 6. Search and Discovery Tests (NEW)

```bash
# Run all search tests
pnpm test:e2e --grep "TC-SEARCH"

# Run specific search tests
pnpm test:e2e --grep "TC-SEARCH-001"  # Advanced Search
pnpm test:e2e --grep "TC-SEARCH-002"  # Search Performance
pnpm test:e2e --grep "TC-SEARCH-003"  # Search Relevance
```

### 7. Real-time Features Tests (NEW)

```bash
# Run all real-time tests
pnpm test:e2e --grep "TC-REAL"

# Run specific real-time tests
pnpm test:e2e --grep "TC-REAL-001"  # WebSocket Connection
pnpm test:e2e --grep "TC-REAL-002"  # Real-time Progress
pnpm test:e2e --grep "TC-REAL-003"  # Live Chat
```

## Test Execution Commands

### Running All Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests with specific browser
pnpm test:e2e --project=chromium
pnpm test:e2e --project=firefox
pnpm test:e2e --project=webkit

# Run tests in headless mode
pnpm test:e2e --headed=false

# Run tests with UI mode
pnpm test:e2e --ui
```

### Running Tests by Priority

```bash
# Run critical priority tests only
pnpm test:e2e --grep "Critical"

# Run high priority tests
pnpm test:e2e --grep "High"

# Run medium priority tests
pnpm test:e2e --grep "Medium"
```

### Running Tests by Type

```bash
# Run E2E tests only
pnpm test:e2e --grep "E2E"

# Run integration tests
pnpm test:e2e --grep "Integration"

# Run performance tests
pnpm test:e2e --grep "Performance"

# Run accessibility tests
pnpm test:e2e --grep "Accessibility"
```

### Running Tests in Parallel

```bash
# Run tests with multiple workers
pnpm test:e2e --workers=4

# Run tests with auto-detected workers
pnpm test:e2e --workers=max

# Run tests sequentially (for debugging)
pnpm test:e2e --workers=1
```

## Test Configuration

### Environment Variables

```bash
# Set test environment
export NODE_ENV=test

# Set base URL for tests
export BASE_URL=http://localhost:3001

# Set API base URL
export API_BASE_URL=http://127.0.0.1:3086

# Enable debug mode
export DEBUG=true
```

### Test Configuration Files

```bash
# Playwright configuration
# apps/web/playwright.config.ts

# Test environment configuration
# .env.test

# Test data configuration
# test-data/config.json
```

## Test Data Management

### Test Data Setup

```bash
# Setup test data
pnpm test:setup

# Setup specific test data
pnpm test:setup --category=video-platform
pnpm test:setup --category=authentication
pnpm test:setup --category=channel-management
```

### Test Data Cleanup

```bash
# Cleanup all test data
pnpm test:cleanup

# Cleanup specific test data
pnpm test:cleanup --category=video-platform
pnpm test:cleanup --user=test@example.com
```

### Test Data Templates

```bash
# Generate test data from templates
pnpm test:generate-data --template=users --count=100
pnpm test:generate-data --template=channels --count=50
pnpm test:generate-data --template=videos --count=200
```

## Test Reporting

### Generate Test Reports

```bash
# Generate HTML report
pnpm test:e2e --reporter=html

# Generate JSON report
pnpm test:e2e --reporter=json

# Generate JUnit report (for CI/CD)
pnpm test:e2e --reporter=junit

# Generate multiple reports
pnpm test:e2e --reporter=html,json,junit
```

### View Test Reports

```bash
# Open HTML report
pnpm test:report

# Open specific report
pnpm test:report --file=report.html
pnpm test:report --format=html
```

### Test Coverage

```bash
# Generate coverage report
pnpm test:coverage

# Generate coverage for specific category
pnpm test:coverage --category=video-platform
pnpm test:coverage --category=authentication
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm exec playwright install
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

### Local CI Simulation

```bash
# Run tests as if in CI
pnpm test:e2e --ci

# Run tests with CI configuration
pnpm test:e2e --ci --reporter=junit --output-file=test-results.xml
```

## Debugging Tests

### Debug Mode

```bash
# Run tests with debug mode
pnpm test:e2e --debug

# Run specific test with debug
pnpm test:e2e --debug --grep "TC-VID-001"

# Run tests with browser inspector
pnpm test:e2e --debug --browser=chromium
```

### Test Timeouts

```bash
# Increase timeout for slow tests
pnpm test:e2e --timeout=60000

# Set timeout per test
pnpm test:e2e --timeout=30000 --grep="TC-VID-001"
```

### Test Retries

```bash
# Run tests with retries
pnpm test:e2e --retries=3

# Run tests with retries only on failure
pnpm test:e2e --retries=3 --retry-on-failure
```

## Performance Testing

### Load Testing

```bash
# Run performance tests
pnpm test:performance

# Run load tests
pnpm test:load --concurrent-users=100 --duration=300

# Run stress tests
pnpm test:stress --max-users=1000 --ramp-up=60
```

### Performance Monitoring

```bash
# Monitor performance during tests
pnpm test:e2e --monitor-performance

# Generate performance report
pnpm test:performance-report
```

## Accessibility Testing

### Accessibility Tests

```bash
# Run accessibility tests
pnpm test:accessibility

# Run with axe-core integration
pnpm test:e2e --accessibility

# Generate accessibility report
pnpm test:a11y-report
```

### WCAG Compliance

```bash
# Test WCAG 2.1 AA compliance
pnpm test:wcag --level=AA

# Test specific WCAG guidelines
pnpm test:wcag --guidelines=1.1,1.2,2.1
```

## Mobile Testing

### Mobile Device Testing

```bash
# Run tests on mobile devices
pnpm test:e2e --project="Mobile Chrome"
pnpm test:e2e --project="Mobile Safari"

# Run tests on specific devices
pnpm test:e2e --device="iPhone 12"
pnpm test:e2e --device="Pixel 5"
```

### Responsive Testing

```bash
# Run responsive design tests
pnpm test:responsive

# Test specific viewports
pnpm test:e2e --viewport=375,667
pnpm test:e2e --viewport=768,1024
pnpm test:e2e --viewport=1920,1080
```

## Network Testing

### Network Conditions

```bash
# Test with different network conditions
pnpm test:e2e --network="Slow 3G"
pnpm test:e2e --network="Fast 3G"
pnpm test:e2e --network="Offline"

# Test with custom network conditions
pnpm test:e2e --network-throttle=1000 --network-latency=100
```

### Offline Testing

```bash
# Test offline functionality
pnpm test:offline

# Test service worker behavior
pnpm test:service-worker
```

## Internationalization Testing

### Language Testing

```bash
# Run tests in different languages
pnpm test:e2e --lang=en
pnpm test:e2e --lang=ar

# Run all language tests
pnpm test:i18n
```

### RTL Testing

```bash
# Run RTL layout tests
pnpm test:rtl

# Test Arabic specifically
pnpm test:e2e --locale=ar --rtl
```

## Test Maintenance

### Update Test Data

```bash
# Update test data templates
pnpm test:update-data

# Refresh test fixtures
pnpm test:refresh-fixtures
```

### Update Test Dependencies

```bash
# Update Playwright
pnpm exec playwright install --force

# Update test browsers
pnpm exec playwright install-deps
```

### Test Health Check

```bash
# Check test health
pnpm test:health

# Validate test configuration
pnpm test:validate-config

# Check test coverage
pnpm test:coverage-check
```

## Troubleshooting

### Common Issues

1. **Tests Fail to Start**
   ```bash
   # Check if dev server is running
   pnpm dev
   
   # Check port availability
   lsof -i:3001
   lsof -i:3086
   ```

2. **Browser Installation Issues**
   ```bash
   # Reinstall Playwright browsers
   pnpm exec playwright install --force
   
   # Install system dependencies
   pnpm exec playwright install-deps
   ```

3. **Test Timeouts**
   ```bash
   # Increase timeout
   pnpm test:e2e --timeout=120000
   
   # Run tests sequentially
   pnpm test:e2e --workers=1
   ```

4. **Memory Issues**
   ```bash
   # Reduce parallel workers
   pnpm test:e2e --workers=2
   
   # Run tests in chunks
   pnpm test:e2e --grep="TC-VID"
   pnpm test:e2e --grep="TC-AUTH"
   ```

### Debug Commands

```bash
# Check test environment
pnpm test:env

# Validate test setup
pnpm test:validate

# Run diagnostic tests
pnpm test:diagnostic
```

## Best Practices

### Test Organization

1. **Group related tests** using `test.describe()`
2. **Use descriptive test names** following the TC-XXX-YYY format
3. **Add proper setup and teardown** in `beforeEach` and `afterEach`
4. **Use page object pattern** for complex interactions

### Test Data Management

1. **Use factories** for generating test data
2. **Clean up test data** after each test
3. **Use consistent naming** for test data
4. **Mock external dependencies** when possible

### Performance Optimization

1. **Run tests in parallel** when possible
2. **Reuse browser contexts** across tests
3. **Use efficient selectors** (data-testid preferred)
4. **Avoid unnecessary waits** and use proper assertions

### Error Handling

1. **Provide clear error messages** in test assertions
2. **Use proper error boundaries** in test code
3. **Log relevant information** for debugging
4. **Handle network failures** gracefully

## Test Schedule

### Daily Tests

- Run smoke tests on every commit
- Run critical priority tests daily
- Monitor test execution times

### Weekly Tests

- Run full test suite weekly
- Update test data and fixtures
- Review test coverage metrics

### Monthly Tests

- Comprehensive test review
- Update test dependencies
- Optimize test performance
- Review and update test cases

## Contact Information

**Test Team**: test-team@alummahnow.net  
**QA Lead**: qa-lead@alummahnow.net  
**DevOps**: devops@alummahnow.net  

**Document Created**: 2025-11-20  
**Last Updated**: 2025-11-20  
**Next Review**: 2025-11-27