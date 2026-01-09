# Performance Testing Implementation

Comprehensive performance testing suite for Al Ummah Now backend services using k6 and custom benchmarks.

## Overview

This testing suite covers:
- **Load Testing**: Simulate realistic user traffic patterns
- **Stress Testing**: Push system beyond normal capacity
- **Endurance Testing**: Validate performance over extended periods
- **Spike Testing**: Handle sudden traffic surges
- **Volume Testing**: Test with large data volumes
- **Scalability Testing**: Measure performance scaling

## Test Structure

```
performance/
├── README.md                    # This file
├── k6/                         # k6 performance tests
│   ├── load-testing.js          # Basic load testing scenarios
│   ├── stress-testing.js        # Stress testing beyond limits
│   ├── spike-testing.js        # Sudden traffic spikes
│   ├── endurance-testing.js     # Long-running performance
│   ├── api-endpoints.js        # Individual endpoint performance
│   ├── auth-performance.js     # Authentication performance
│   ├── video-streaming.js      # Video streaming performance
│   └── websocket-load.js       # WebSocket connection testing
├── benchmarks/                 # Custom benchmark scripts
│   ├── api-benchmarks.ts       # API endpoint benchmarks
│   ├── processor-benchmarks.ts # Message processor benchmarks
│   ├── r2-benchmarks.ts        # R2 storage benchmarks
│   └── queue-benchmarks.ts     # Queue performance benchmarks
├── scenarios/                  # Test scenario definitions
│   ├── user-journeys.js        # Complete user journey tests
│   ├── content-creation.js     # Content upload workflows
│   ├── viewing-patterns.js     # Video viewing patterns
│   └── social-interactions.js  # Comments, likes, subscriptions
├── reports/                    # Performance reports
│   ├── templates/              # Report templates
│   ├── baseline/               # Baseline performance data
│   └── historical/             # Historical performance data
├── configs/                    # Test configurations
│   ├── development.json        # Development environment config
│   ├── staging.json           # Staging environment config
│   ├── production.json        # Production environment config
│   └── thresholds.json        # Performance thresholds
└── utils/                      # Utility functions
    ├── metrics.js              # Metrics collection utilities
    ├── helpers.js             # Test helper functions
    └── data-generator.js      # Test data generation
```

## Quick Start

### Prerequisites
- Node.js 18+
- k6 (https://k6.io/docs/get-started/installation/)
- pnpm package manager

### Installation

```bash
# Install k6 (macOS)
brew install k6

# Install k6 (Ubuntu/Debian)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Install Node.js dependencies
pnpm install
```

### Running Tests

```bash
# Run basic load test
k6 run k6/load-testing.js

# Run with specific configuration
k6 run --config configs/staging.json k6/load-testing.js

# Run stress test
k6 run k6/stress-testing.js

# Run spike test
k6 run k6/spike-testing.js

# Run endurance test (24 hours)
k6 run --duration 24h k6/endurance-testing.js

# Run with custom VUs and duration
k6 run --vus 100 --duration 10m k6/load-testing.js

# Run API endpoint benchmarks
pnpm run benchmark:api

# Run processor benchmarks
pnpm run benchmark:processor
```

## Test Scenarios

### 1. Load Testing

Simulates normal user traffic with realistic patterns:

```javascript
// k6/load-testing.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 10 },   // Stay at 10 users
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.1'],    // Error rate under 10%
    errors: ['rate<0.1'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3086';

export default function () {
  // Test video listing
  let response = http.get(`${BASE_URL}/api/videos?page=1&limit=20`);
  let success = check(response, {
    'video list status is 200': (r) => r.status === 200,
    'video list response time < 500ms': (r) => r.timings.duration < 500,
    'video list has data': (r) => JSON.parse(r.body).data.length > 0,
  });
  
  errorRate.add(!success);

  // Test video details
  if (Math.random() > 0.3) {
    response = http.get(`${BASE_URL}/api/videos/sample-video-123`);
    success = check(response, {
      'video details status is 200': (r) => r.status === 200,
      'video details response time < 300ms': (r) => r.timings.duration < 300,
    });
    errorRate.add(!success);
  }

  // Test search
  if (Math.random() > 0.5) {
    const searchQuery = ['tutorial', 'gaming', 'music', 'education'][Math.floor(Math.random() * 4)];
    response = http.get(`${BASE_URL}/api/videos/search?q=${searchQuery}`);
    success = check(response, {
      'search status is 200': (r) => r.status === 200,
      'search response time < 800ms': (r) => r.timings.duration < 800,
    });
    errorRate.add(!success);
  }

  sleep(1);
}
```

### 2. Stress Testing

Pushes the system beyond normal capacity:

```javascript
// k6/stress-testing.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 100 },   // Stay at 100 users
    { duration: '2m', target: 500 },   // Ramp up to 500 users
    { duration: '5m', target: 500 },   // Stay at 500 users
    { duration: '2m', target: 1000 },  // Ramp up to 1000 users
    { duration: '5m', target: 1000 },  // Stay at 1000 users
    { duration: '2m', target: 2000 },  // Push to 2000 users
    { duration: '5m', target: 2000 },  // Stay at 2000 users
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // More lenient during stress
    http_req_failed: ['rate<0.3'],     // Allow higher error rate
    errors: ['rate<0.3'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3086';

export default function () {
  // Mix of different request types
  const requests = [
    () => http.get(`${BASE_URL}/api/videos`),
    () => http.get(`${BASE_URL}/api/videos/sample-video-123`),
    () => http.get(`${BASE_URL}/api/videos/search?q=test`),
    () => http.get(`${BASE_URL}/api/channels`),
    () => http.get(`${BASE_URL}/api/channels/sample-channel-123`),
  ];

  // Execute random request
  const randomRequest = requests[Math.floor(Math.random() * requests.length)];
  const response = randomRequest();
  
  const success = check(response, {
    'response status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'response time < 5000ms': (r) => r.timings.duration < 5000,
  });
  
  errorRate.add(!success);
  sleep(0.5);
}
```

### 3. Spike Testing

Tests system's ability to handle sudden traffic spikes:

```javascript
// k6/spike-testing.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },    // Normal load
    { duration: '5m', target: 10 },    // Stay normal
    { duration: '30s', target: 1000 },  // Spike! (20x increase)
    { duration: '5m', target: 1000 },   // Stay at spike
    { duration: '30s', target: 10 },    // Back to normal
    { duration: '5m', target: 10 },     // Stay normal
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // Allow slower during spike
    http_req_failed: ['rate<0.2'],     // Some errors acceptable during spike
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3086';

export default function () {
  // Focus on most critical endpoints during spike
  const response = http.get(`${BASE_URL}/api/videos`);
  
  check(response, {
    'videos endpoint responds': (r) => r.status < 500,
    'response time reasonable': (r) => r.timings.duration < 2000,
  });

  sleep(0.1); // Very short sleep during spike
}
```

### 4. API Endpoint Benchmarks

Detailed performance testing for specific endpoints:

```typescript
// benchmarks/api-benchmarks.ts
import { performance } from 'perf_hooks';
import { createTestClient } from '../api/helpers/test-client';

interface BenchmarkResult {
  endpoint: string;
  method: string;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  totalRequests: number;
}

export class APIBenchmarks {
  private client: any;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.client = createTestClient(baseUrl);
  }

  async benchmarkEndpoint(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    duration: number = 30000 // 30 seconds
  ): Promise<BenchmarkResult> {
    const responseTimes: number[] = [];
    const errors: number[] = [];
    const startTime = performance.now();
    let totalRequests = 0;

    while (performance.now() - startTime < duration) {
      const requestStart = performance.now();
      
      try {
        let response;
        switch (method.toUpperCase()) {
          case 'GET':
            response = await this.client.get(endpoint);
            break;
          case 'POST':
            response = await this.client.post(endpoint, body);
            break;
          case 'PUT':
            response = await this.client.put(endpoint, body);
            break;
          default:
            throw new Error(`Unsupported method: ${method}`);
        }

        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;
        
        responseTimes.push(responseTime);
        totalRequests++;

        if (response.status >= 400) {
          errors.push(response.status);
        }
      } catch (error) {
        errors.push(-1); // Network error
        totalRequests++;
      }
    }

    // Calculate statistics
    responseTimes.sort((a, b) => a - b);
    const actualDuration = (performance.now() - startTime) / 1000; // in seconds

    return {
      endpoint,
      method,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      p95ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.95)],
      p99ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.99)],
      requestsPerSecond: totalRequests / actualDuration,
      errorRate: errors.length / totalRequests,
      totalRequests,
    };
  }

  async runAllBenchmarks(): Promise<BenchmarkResult[]> {
    const benchmarks = [
      { endpoint: '/api/videos', method: 'GET' },
      { endpoint: '/api/videos?page=1&limit=50', method: 'GET' },
      { endpoint: '/api/videos/search?q=test', method: 'GET' },
      { endpoint: '/api/channels', method: 'GET' },
      { endpoint: '/api/channels/popular', method: 'GET' },
      { endpoint: '/api/playlists', method: 'GET' },
      { endpoint: '/api/comments/video/sample-video-123', method: 'GET' },
    ];

    const results: BenchmarkResult[] = [];

    for (const benchmark of benchmarks) {
      console.log(`Benchmarking ${benchmark.method} ${benchmark.endpoint}...`);
      const result = await this.benchmarkEndpoint(
        benchmark.endpoint,
        benchmark.method
      );
      results.push(result);
      
      console.log(`  Avg: ${result.avgResponseTime.toFixed(2)}ms`);
      console.log(`  RPS: ${result.requestsPerSecond.toFixed(2)}`);
      console.log(`  Error Rate: ${(result.errorRate * 100).toFixed(2)}%`);
    }

    return results;
  }

  generateReport(results: BenchmarkResult[]): string {
    let report = '# API Performance Benchmark Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;
    
    report += '| Endpoint | Method | Avg (ms) | P95 (ms) | P99 (ms) | RPS | Error Rate |\n';
    report += '|----------|--------|----------|----------|----------|-----|------------|\n';

    for (const result of results) {
      report += `| ${result.endpoint} | ${result.method} | `;
      report += `${result.avgResponseTime.toFixed(2)} | `;
      report += `${result.p95ResponseTime.toFixed(2)} | `;
      report += `${result.p99ResponseTime.toFixed(2)} | `;
      report += `${result.requestsPerSecond.toFixed(2)} | `;
      report += `${(result.errorRate * 100).toFixed(2)}% |\n`;
    }

    return report;
  }
}

// CLI usage
if (require.main === module) {
  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3086';
  const benchmarks = new APIBenchmarks(baseUrl);
  
  benchmarks.runAllBenchmarks()
    .then(results => {
      console.log(benchmarks.generateReport(results));
    })
    .catch(error => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });
}
```

## Performance Thresholds

### Response Time Targets

```json
// configs/thresholds.json
{
  "responseTime": {
    "critical": {
      "p50": 100,
      "p95": 500,
      "p99": 1000
    },
    "important": {
      "p50": 200,
      "p95": 800,
      "p99": 1500
    },
    "normal": {
      "p50": 300,
      "p95": 1200,
      "p99": 2000
    }
  },
  "throughput": {
    "api": {
      "minRPS": 100,
      "targetRPS": 500,
      "maxRPS": 1000
    },
    "videoStreaming": {
      "minRPS": 50,
      "targetRPS": 200,
      "maxRPS": 500
    },
    "websocket": {
      "minConnections": 1000,
      "targetConnections": 5000,
      "maxConnections": 10000
    }
  },
  "errorRate": {
    "critical": 0.01,    // 1%
    "important": 0.05,   // 5%
    "normal": 0.1        // 10%
  },
  "resourceUsage": {
    "cpu": {
      "warning": 70,
      "critical": 90
    },
    "memory": {
      "warning": 80,
      "critical": 95
    },
    "disk": {
      "warning": 80,
      "critical": 90
    }
  }
}
```

## Environment Configurations

### Development Environment

```json
// configs/development.json
{
  "baseUrl": "http://127.0.0.1:3086",
  "websocketUrl": "ws://127.0.0.1:8787",
  "stages": [
    { "duration": "1m", "target": 5 },
    { "duration": "2m", "target": 5 },
    { "duration": "1m", "target": 0 }
  ],
  "thresholds": {
    "http_req_duration": ["p(95)<1000"],
    "http_req_failed": ["rate<0.2"]
  }
}
```

### Production Environment

```json
// configs/production.json
{
  "baseUrl": "https://api.alummahnow.net",
  "websocketUrl": "wss://ws.alummahnow.net",
  "stages": [
    { "duration": "5m", "target": 100 },
    { "duration": "10m", "target": 100 },
    { "duration": "5m", "target": 500 },
    { "duration": "10m", "target": 500 },
    { "duration": "5m", "target": 1000 },
    { "duration": "10m", "target": 1000 },
    { "duration": "5m", "target": 0 }
  ],
  "thresholds": {
    "http_req_duration": ["p(95)<500"],
    "http_req_failed": ["rate<0.05"]
  },
  "headers": {
    "User-Agent": "k6-performance-test"
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/performance-tests.yml
name: Performance Tests

on:
  pull_request:
    paths:
      - 'apps/**'
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  performance-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
          
      - name: Install dependencies
        run: pnpm install
        
      - name: Run load tests
        run: |
          cd docs/test-cases/backend/performance
          k6 run --config configs/staging.json k6/load-testing.js
          
      - name: Run API benchmarks
        run: |
          cd docs/test-cases/backend/performance
          pnpm run benchmark:api
          
      - name: Upload performance reports
        uses: actions/upload-artifact@v3
        with:
          name: performance-reports
          path: docs/test-cases/backend/performance/reports/
```

## Monitoring and Alerting

### Performance Metrics Collection

```javascript
// utils/metrics.js
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom metrics
export const metrics = {
  // Response time trends
  apiResponseTime: new Trend('api_response_time'),
  dbQueryTime: new Trend('db_query_time'),
  cacheHitTime: new Trend('cache_hit_time'),
  
  // Error rates
  apiErrors: new Rate('api_errors'),
  dbErrors: new Rate('db_errors'),
  cacheErrors: new Rate('cache_errors'),
  
  // Counters
  totalRequests: new Counter('total_requests'),
  cacheHits: new Counter('cache_hits'),
  cacheMisses: new Counter('cache_misses'),
  
  // Custom business metrics
  videoViews: new Counter('video_views'),
  userLogins: new Counter('user_logins'),
  videoUploads: new Counter('video_uploads'),
};

export function recordAPICall(response, endpoint) {
  metrics.apiResponseTime.add(response.timings.duration);
  metrics.totalRequests.add(1);
  
  if (response.status >= 400) {
    metrics.apiErrors.add(1);
  }
  
  // Track specific endpoints
  if (endpoint.includes('/videos/')) {
    metrics.videoViews.add(1);
  }
}

export function recordCacheOperation(hit, duration) {
  if (hit) {
    metrics.cacheHits.add(1);
    metrics.cacheHitTime.add(duration);
  } else {
    metrics.cacheMisses.add(1);
  }
}
```

## Best Practices

### Test Design
1. **Realistic Scenarios**: Simulate actual user behavior
2. **Gradual Ramp-up**: Avoid shocking the system
3. **Mixed Workloads**: Test different endpoint combinations
4. **Data Variations**: Use diverse test data
5. **Think Times**: Include realistic delays between requests

### Performance Optimization
1. **Baseline First**: Establish performance baselines
2. **Incremental Testing**: Test changes incrementally
3. **Monitor Resources**: Track CPU, memory, and network
4. **Identify Bottlenecks**: Focus on limiting factors
5. **Continuous Monitoring**: Track performance over time

### Result Analysis
1. **Statistical Significance**: Run tests long enough
2. **Multiple Runs**: Verify consistency
3. **Compare Baselines**: Track performance changes
4. **Investigate Anomalies**: Understand unusual results
5. **Document Findings**: Keep detailed performance records

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   ```bash
   # Increase timeout in k6 options
   export K6_TIMEOUT=60s
   k6 run k6/load-testing.js
   ```

2. **High Error Rates**
   ```bash
   # Check system resources
   k6 run --vus 10 --duration 5m k6/load-testing.js --http-debug
   ```

3. **Memory Issues**
   ```bash
   # Limit VUs and monitor memory
   k6 run --vus 50 --max-memory-usage 512MB k6/load-testing.js
   ```

### Debug Mode

```bash
# Enable debug logging
DEBUG=k6:* k6 run k6/load-testing.js

# Run with verbose output
k6 run --verbose k6/load-testing.js

# Generate HTML report
k6 run --out html=report.html k6/load-testing.js
```

## Performance Reports

### Automated Report Generation

```bash
# Generate comprehensive performance report
pnpm run performance:report

# Generate comparison report
pnpm run performance:compare --baseline baseline.json --current current.json

# Generate trend analysis
pnpm run performance:trend --days 30
```

### Report Templates

Performance reports include:
- **Executive Summary**: Key performance indicators
- **Detailed Metrics**: Response times, throughput, error rates
- **Trend Analysis**: Performance over time
- **Bottleneck Analysis**: Identified performance issues
- **Recommendations**: Optimization suggestions
- **Environment Comparison**: Performance across environments