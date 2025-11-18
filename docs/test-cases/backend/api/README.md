# API Testing Implementation

Comprehensive testing suite for the Al Ummah Now API backend (Hono + Cloudflare Workers).

## Overview

This testing suite covers:
- **Endpoint Testing**: All REST API endpoints with various scenarios
- **OpenAPI Contract Testing**: Validation against OpenAPI 3.1 specification
- **Authentication Testing**: JWT/OAuth2 authentication and authorization
- **R2 Integration Testing**: Cloudflare R2 storage operations
- **Bunny.net Integration**: CDN and streaming service integration
- **Security Testing**: Rate limiting, input validation, CORS
- **Performance Testing**: Response times and throughput validation

## Test Structure

```
api/
├── README.md                    # This file
├── endpoints/                   # Endpoint-specific tests
│   ├── auth.test.ts            # Authentication endpoints
│   ├── videos.test.ts          # Video CRUD operations
│   ├── channels.test.ts        # Channel management
│   ├── playlists.test.ts       # Playlist operations
│   ├── comments.test.ts        # Comment system
│   ├── search.test.ts          # Search functionality
│   └── analytics.test.ts       # Analytics endpoints
├── integration/                # Integration test scenarios
│   ├── auth-flow.test.ts       # Complete authentication flows
│   ├── video-workflow.test.ts  # Video upload to publishing
│   └── user-journey.test.ts    # End-to-end user scenarios
├── contracts/                  # OpenAPI contract tests
│   ├── openapi-validation.test.ts
│   └── schema-compliance.test.ts
├── security/                   # Security-focused tests
│   ├── auth-bypass.test.ts     # Authentication bypass attempts
│   ├── rate-limiting.test.ts   # Rate limiting validation
│   ├── input-validation.test.ts # Input sanitization
│   └── cors.test.ts            # CORS configuration
├── performance/                # Performance tests
│   ├── load-testing.test.ts    # Load testing scenarios
│   └── response-times.test.ts  # Response time validation
├── mocks/                      # Mock implementations
│   ├── bunny-api.mock.ts       # Bunny.net API mocks
│   ├── r2-storage.mock.ts      # R2 storage mocks
│   └── auth-service.mock.ts    # Authentication service mocks
├── fixtures/                   # Test data fixtures
│   ├── users.json              # User test data
│   ├── videos.json             # Video test data
│   └── channels.json           # Channel test data
└── helpers/                    # Test utilities
    ├── test-client.ts          # HTTP test client
    ├── auth-helper.ts          # Authentication test helpers
    └── data-factory.ts         # Test data generation
```

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm package manager
- Development environment running (`pnpm dev`)

### Running Tests

```bash
# Run all API tests
cd apps/api-videos && pnpm test

# Run specific test suites
pnpm test:auth          # Authentication tests
pnpm test:videos        # Video endpoint tests
pnpm test:integration   # Integration tests
pnpm test:security      # Security tests
pnpm test:performance   # Performance tests

# Run with coverage
pnpm test:coverage

# Run in watch mode
pnpm test:watch

# Run against staging
pnpm test:staging
```

## Test Configuration

### Environment Setup

```typescript
// test-config.ts
export const testConfig = {
  baseUrl: process.env.API_BASE_URL || 'http://127.0.0.1:3086',
  timeout: 30000,
  retries: 3,
  auth: {
    testUser: {
      email: 'test@example.com',
      password: 'test-password-123'
    },
    adminUser: {
      email: 'admin@example.com',
      password: 'admin-password-123'
    }
  },
  storage: {
    testBucket: 'al-ummah-now-test',
    previewBucket: 'al-ummah-now-preview'
  }
};
```

### Test Client Configuration

```typescript
// helpers/test-client.ts
export class TestClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async authenticate(credentials: UserCredentials): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    
    const data = await response.json();
    this.authToken = data.token;
  }

  async request(endpoint: string, options: RequestOptions = {}): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
      ...options.headers
    };

    return fetch(url, {
      ...options,
      headers
    });
  }
}
```

## Test Categories

### 1. Endpoint Testing

Each endpoint is tested with:
- **Happy path**: Valid requests with expected responses
- **Error cases**: Invalid input, missing data, unauthorized access
- **Edge cases**: Boundary values, special characters, large payloads
- **Status codes**: Proper HTTP status code responses

Example:
```typescript
// endpoints/videos.test.ts
describe('Video Endpoints', () => {
  describe('GET /api/videos', () => {
    it('should return paginated video list', async () => {
      const response = await client.request('/api/videos?page=1&limit=10');
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should validate pagination parameters', async () => {
      const response = await client.request('/api/videos?page=-1&limit=1000');
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });
});
```

### 2. Authentication Testing

Comprehensive authentication flow testing:
- **Login/Logout**: Valid and invalid credentials
- **Token validation**: JWT token structure and expiration
- **Role-based access**: Admin, user, and public access levels
- **Session management**: Token refresh and revocation

### 3. OpenAPI Contract Testing

Validation against the OpenAPI 3.1 specification:
- **Schema validation**: Request/response body validation
- **Parameter validation**: Query parameters, path parameters
- **Response format**: Consistent response structure
- **Documentation accuracy**: API docs match implementation

### 4. Integration Testing

Cross-service integration scenarios:
- **Video workflow**: Upload → Process → Publish → Stream
- **User journey**: Register → Create channel → Upload video → Manage content
- **Analytics flow**: View → Track → Process → Report

### 5. Security Testing

Security vulnerability testing:
- **Authentication bypass**: Attempted unauthorized access
- **Input validation**: SQL injection, XSS, CSRF prevention
- **Rate limiting**: Request throttling and DDoS protection
- **CORS configuration**: Proper cross-origin resource sharing

### 6. Performance Testing

Performance and load testing:
- **Response times**: Endpoint response time validation
- **Concurrent requests**: Multiple simultaneous requests
- **Large payloads**: Handling of large files and data
- **Memory usage**: Resource consumption monitoring

## Test Data Management

### Fixtures

Static test data stored in JSON files:
```json
// fixtures/videos.json
{
  "validVideo": {
    "title": "Test Video Title",
    "description": "Test video description",
    "tags": ["test", "video"],
    "visibility": "public"
  },
  "invalidVideo": {
    "title": "",
    "description": "Too short"
  }
}
```

### Factories

Dynamic test data generation:
```typescript
// helpers/data-factory.ts
export class VideoFactory {
  static create(overrides: Partial<Video> = {}): Video {
    return {
      id: `video-${Date.now()}`,
      title: `Test Video ${Date.now()}`,
      description: 'Generated test video description',
      tags: ['test', 'generated'],
      visibility: 'public',
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }
}
```

## Mock Implementations

### Bunny.net API Mock

```typescript
// mocks/bunny-api.mock.ts
export class BunnyAPIMock {
  static videoLibrary = new Map<string, any>();
  
  static async uploadVideo(videoId: string, file: File): Promise<string> {
    // Simulate upload delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const videoUrl = `https://video.bunny.net/${videoId}`;
    this.videoLibrary.set(videoId, { url: videoUrl, status: 'uploaded' });
    
    return videoUrl;
  }
  
  static async getVideoStatus(videoId: string): Promise<any> {
    return this.videoLibrary.get(videoId) || { status: 'not_found' };
  }
}
```

### R2 Storage Mock

```typescript
// mocks/r2-storage.mock.ts
export class R2StorageMock {
  private storage = new Map<string, any>();
  
  async put(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }
  
  async get(key: string): Promise<any> {
    return this.storage.get(key);
  }
  
  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }
  
  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.storage.keys());
    return prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/api-tests.yml
name: API Tests

on:
  pull_request:
    paths:
      - 'apps/api-videos/**'
  push:
    branches: [main]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        
      - name: Install dependencies
        run: pnpm install
        
      - name: Build shared types
        run: pnpm --filter @al-ummah/shared-types build
        
      - name: Run API tests
        run: |
          cd apps/api-videos
          pnpm test:coverage
          
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          file: ./apps/api-videos/coverage/lcov.info
```

## Coverage Requirements

### Minimum Coverage Thresholds
- **Statements**: 95%
- **Branches**: 90%
- **Functions**: 95%
- **Lines**: 95%

### Coverage Reports
- **HTML Report**: `coverage/lcov-report/index.html`
- **JSON Report**: `coverage/coverage-final.json`
- **LCOV Format**: `coverage/lcov.info`

## Performance Benchmarks

### Response Time Targets
- **Simple endpoints**: < 100ms
- **Complex endpoints**: < 500ms
- **File uploads**: < 5s for 100MB files
- **Search queries**: < 200ms

### Load Testing Targets
- **Concurrent users**: 1000
- **Requests per second**: 500
- **Error rate**: < 0.1%
- **Availability**: 99.9%

## Troubleshooting

### Common Issues

1. **Test Timeouts**
   ```bash
   # Increase timeout in jest.config.js
   testTimeout: 30000
   ```

2. **Authentication Failures**
   ```bash
   # Check auth service status
   curl http://localhost:3086/auth/health
   ```

3. **Mock Failures**
   ```bash
   # Verify mock implementations
   pnpm test -- --testNamePattern="Mock"
   ```

4. **Coverage Gaps**
   ```bash
   # Generate detailed coverage report
   pnpm test:coverage -- --coverageReporters=text-lcov
   ```

### Debug Mode

```bash
# Run with debug logging
DEBUG=api:* pnpm test

# Run specific test file
pnpm test endpoints/videos.test.ts

# Run with verbose output
pnpm test -- --verbose
```

## Best Practices

### Test Writing
1. **Arrange, Act, Assert**: Clear test structure
2. **Descriptive names**: Test names should describe the scenario
3. **Isolation**: Tests should not depend on each other
4. **Cleanup**: Proper cleanup after each test
5. **Assertions**: Use specific assertions with clear messages

### Mock Usage
1. **Mock external services**: Never call real services in tests
2. **Consistent responses**: Mocks should return consistent data
3. **Error scenarios**: Mock both success and error cases
4. **Reset state**: Clean up mocks between tests

### Data Management
1. **Use factories**: Generate test data programmatically
2. **Version fixtures**: Keep test data versioned
3. **Isolate environments**: Use separate test databases/buckets
4. **Clean up**: Remove test data after tests complete