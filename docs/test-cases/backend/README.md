# Backend Testing Implementation

This directory contains comprehensive testing implementations for all Al Ummah Now backend services.

## Structure

- **[api/](./api/)** - API endpoint testing, OpenAPI contract testing, authentication middleware tests
- **[processor/](./processor/)** - Queue message processing tests, all 13+ message types, retry logic
- **[queue/](./queue/)** - Cloudflare Queue testing strategies, message publishing/consuming tests
- **[r2/](./r2/)** - Object storage operation tests, bucket security tests, data consistency validation
- **[integration/](./integration/)** - Cross-service workflow tests, end-to-end flows
- **[performance/](./performance/)** - Load testing scenarios with k6, stress testing configurations
- **[security/](./security/)** - Vulnerability scanning setup, authentication security tests

## Quick Start

### Running All Backend Tests

```bash
# API Tests
cd apps/api-videos && pnpm test

# Processor Tests
cd apps/processor && pnpm test

# Integration Tests
pnpm test:integration

# Performance Tests
cd docs/test-cases/backend/performance && k6 run load-test.js

# Security Tests
cd docs/test-cases/backend/security && pnpm test:security
```

### Test Coverage Requirements

- **API**: 95%+ endpoint coverage, 100% authentication coverage
- **Processor**: 100% message type coverage, all retry scenarios
- **R2**: All CRUD operations, security validations
- **Integration**: Critical user journeys, error scenarios
- **Performance**: Load testing up to 10x expected traffic
- **Security**: OWASP Top 10 coverage, authentication bypass tests

## Testing Standards

### 1. Test Organization
- Each test file focuses on a single responsibility
- Tests are organized by feature/functionality
- Mock and stub implementations are shared
- Test data is versioned and maintainable

### 2. Test Data Management
- Use factories for test data generation
- Environment-specific test configurations
- Cleanup procedures for each test suite
- Isolated test environments

### 3. CI/CD Integration
- All tests run on every PR
- Performance tests run on schedule
- Security scans run nightly
- Coverage reports are generated and tracked

### 4. Mock and Stub Strategy
- External services are mocked
- Database operations use test fixtures
- Network calls are stubbed
- Time-dependent tests use fixed timestamps

## Test Execution Order

1. **Unit Tests** - Fastest, most isolated
2. **Integration Tests** - Service interactions
3. **API Tests** - Endpoint validation
4. **Performance Tests** - Load and stress
5. **Security Tests** - Vulnerability scanning

## Environment Setup

### Development Environment
```bash
# Setup test databases
pnpm test:setup:dev

# Run with hot reload
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Staging Environment
```bash
# Run against staging services
pnpm test:staging

# Performance baseline
pnpm test:performance:baseline

# Security scan
pnpm test:security:staging
```

### Production Environment
```bash
# Smoke tests only
pnpm test:smoke:prod

# Health checks
pnpm test:health:prod
```

## Test Results and Reporting

### Coverage Reports
- HTML reports: `coverage/lcov-report/index.html`
- JSON reports: `coverage/coverage-final.json`
- Threshold enforcement in CI/CD

### Performance Reports
- K6 HTML reports: `performance/reports/`
- Baseline comparisons
- Regression detection

### Security Reports
- OWASP ZAP reports: `security/reports/`
- Vulnerability tracking
- Remediation tracking

## Troubleshooting

### Common Issues
1. **Test timeouts**: Increase timeout in jest.config.js
2. **Mock failures**: Verify mock implementations
3. **Environment issues**: Check test environment setup
4. **Coverage gaps**: Add missing test cases

### Debug Mode
```bash
# Run with debug logging
DEBUG=true pnpm test

# Run specific test file
pnpm test -- path/to/test.test.ts

# Run with coverage for specific file
pnpm test:coverage -- path/to/test.test.ts
```

## Contributing

When adding new tests:

1. Follow existing patterns and conventions
2. Ensure proper cleanup and isolation
3. Add meaningful assertions
4. Update documentation
5. Verify coverage thresholds

## Test Metrics Dashboard

Access the live test metrics dashboard at:
- Development: http://localhost:3000/test-metrics
- Staging: https://staging.alummahnow.net/test-metrics
- Production: https://alummahnow.net/test-metrics