# Al Ummah Now Backend Testing Strategy

## Executive Summary

This document provides comprehensive testing strategies for the Al Ummah Now backend architecture, covering all four Cloudflare Workers applications: API Videos, Processor, WebSocket Server, and their integration with Cloudflare services (R2, Queue, KV, Durable Objects).

## Architecture Overview

### Current Backend Components

1. **API Videos** (`apps/api-videos/`)
   - Hono v4 API framework with chanfana (OpenAPI 3.1)
   - 80+ REST endpoints across 8 domains
   - R2 repository pattern (8 buckets)
   - Bunny.net integration for video streaming
   - OpenAuth JWT authentication
   - Queue producer for analytics events

2. **Processor** (`apps/processor/`)
   - Queue consumer for `al-ummah-now-videos`
   - Processes 35+ message types
   - R2 storage for all messages
   - Retry logic with DLQ support
   - Analytics and watch history processing

3. **WebSocket Server** (`apps/websocket-server/`)
   - Durable Objects for real-time communication
   - JWT authentication with OpenAuth
   - Presence tracking via KV
   - Rate limiting and broadcasting

4. **Cloudflare Services**
   - **R2**: 8 buckets for object storage
   - **Queue**: `al-ummah-now-videos` + DLQ
   - **KV**: Auth storage + presence tracking
   - **Durable Objects**: WebSocket state management

## Current Testing State Analysis

### ✅ Strengths
- **Processor**: Comprehensive Jest unit tests (254 lines)
- **API Videos**: Basic integration test runner
- **CI/CD**: Multi-stage validation pipeline
- **Type Safety**: Full TypeScript coverage

### ❌ Critical Gaps
- **API Videos**: No unit tests, only basic integration tests
- **WebSocket Server**: Zero test coverage
- **Integration Tests**: No cross-service testing
- **Performance Tests**: No load testing
- **Security Tests**: No vulnerability scanning
- **E2E Tests**: No full workflow testing

---

## 1. API Testing Strategy (apps/api-videos/)

### 1.1 Current Testing Approach Analysis

**Existing Tests:**
- Basic API test runner (`src/tests/api.test.ts`)
- Manual endpoint validation via curl
- OpenAPI specification generation

**Gaps:**
- No automated unit tests
- No request/response validation
- No authentication testing
- No error handling validation

### 1.2 Recommended Testing Tools

```json
{
  "unitTesting": {
    "framework": "Jest",
    "reason": "Already used in processor, familiar to team"
  },
  "apiTesting": {
    "framework": "supertest",
    "reason": "HTTP assertion library for Node.js"
  },
  "contractTesting": {
    "tool": "Dredd",
    "reason": "OpenAPI contract validation"
  },
  "loadTesting": {
    "tool": "k6",
    "reason": "Cloudflare Workers compatible"
  }
}
```

### 1.3 Test Environment Setup

```typescript
// test/setup/api-test-setup.ts
import { Hono } from 'hono';
import { createTestApp } from './test-app-factory';

export interface TestEnvironment {
  app: Hono;
  mockR2: MockR2Buckets;
  mockQueue: MockQueue;
  mockAuth: MockAuthService;
}

export function createTestEnv(): TestEnvironment {
  return {
    app: createTestApp(),
    mockR2: createMockR2(),
    mockQueue: createMockQueue(),
    mockAuth: createMockAuth()
  };
}
```

### 1.4 Mock/Stub Strategies

#### R2 Repository Mocks
```typescript
// test/mocks/r2-mock.ts
export class MockR2Bucket {
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

  async list(): Promise<{ objects: Array<{ key: string }> }> {
    return {
      objects: Array.from(this.storage.keys()).map(key => ({ key }))
    };
  }
}
```

#### Authentication Mock
```typescript
// test/mocks/auth-mock.ts
export class MockAuthService {
  private validTokens = new Set<string>();

  addValidToken(token: string): void {
    this.validTokens.add(token);
  }

  async validateToken(token: string): Promise<{ userId: string } | null> {
    if (this.validTokens.has(token)) {
      return { userId: 'test-user-123' };
    }
    return null;
  }
}
```

### 1.5 Unit Testing Implementation

#### Endpoint Testing Example
```typescript
// test/unit/video-endpoints.test.ts
import { createTestEnv } from '../setup/api-test-setup';
import { VideoCreate } from '../../src/endpoints/video/videoCreate';

describe('Video Endpoints', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnv();
  });

  describe('POST /api/videos', () => {
    it('should create video with valid data', async () => {
      const videoData = {
        title: 'Test Video',
        description: 'Test Description',
        channelId: 'test-channel-123'
      };

      const response = await env.app.request('/api/videos', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(videoData)
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.title).toBe(videoData.title);
    });

    it('should reject unauthorized requests', async () => {
      const response = await env.app.request('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' })
      });

      expect(response.status).toBe(401);
    });

    it('should validate required fields', async () => {
      const response = await env.app.request('/api/videos', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({}) // Missing required fields
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });
});
```

### 1.6 Integration Testing Approaches

#### OpenAPI Contract Testing
```typescript
// test/integration/openapi-contract.test.ts
import Dredd from 'dredd';
import { createTestApp } from '../setup/test-app-factory';

describe('OpenAPI Contract Validation', () => {
  let dredd: Dredd;

  beforeAll(async () => {
    dredd = new Dredd({
      server: 'http://localhost:3086',
      path: './openapi.json',
      options: {
        hookfiles: ['./test/hooks/api-hooks.js']
      }
    });
  });

  it('should validate all endpoints against OpenAPI spec', async () => {
    const results = await dredd.run();
    expect(results.stats).toEqual({
      tests: expect.any(Number),
      errors: 0,
      failures: 0,
      skipped: 0
    });
  });
});
```

#### Cross-Service Integration
```typescript
// test/integration/api-processor-integration.test.ts
describe('API → Processor Integration', () => {
  it('should queue video view events', async () => {
    // 1. Create video via API
    const videoResponse = await createTestVideo();
    const videoId = videoResponse.data.id;

    // 2. View video via API
    await viewVideo(videoId);

    // 3. Verify message was queued
    const messages = await getQueuedMessages();
    const viewMessage = messages.find(m => 
      m.type === 'VideoView' && m.payload.videoId === videoId
    );
    expect(viewMessage).toBeDefined();
  });
});
```

### 1.7 Performance Testing Methodologies

#### Load Testing with k6
```javascript
// test/performance/api-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp up to 200 users
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.1'],    // Error rate under 10%
  },
};

export default function () {
  // Test video listing
  let response = http.get('http://localhost:3086/api/videos');
  check(response, {
    'video list status is 200': (r) => r.status === 200,
    'video list response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Test video creation (authenticated)
  response = http.post('http://localhost:3086/api/videos', 
    JSON.stringify({
      title: `Load Test Video ${__VU}`,
      description: 'Load test description',
      channelId: 'test-channel'
    }),
    {
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      }
    }
  );
  
  check(response, {
    'video creation status is 201': (r) => r.status === 201,
    'video creation response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  sleep(1);
}
```

### 1.8 Security Testing Considerations

#### Authentication Security Tests
```typescript
// test/security/auth-security.test.ts
describe('Authentication Security', () => {
  it('should reject malformed JWT tokens', async () => {
    const response = await env.app.request('/api/videos', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer malformed.jwt.token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test' })
    });

    expect(response.status).toBe(401);
  });

  it('should reject expired tokens', async () => {
    const expiredToken = generateExpiredToken();
    const response = await env.app.request('/api/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${expiredToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test' })
    });

    expect(response.status).toBe(401);
  });

  it('should prevent token replay attacks', async () => {
    const token = generateValidToken();
    
    // First request should succeed
    const response1 = await makeAuthenticatedRequest(token);
    expect(response1.status).toBe(201);

    // Replay with same token should be rejected (if jti is implemented)
    const response2 = await makeAuthenticatedRequest(token);
    expect(response2.status).toBe(401);
  });
});
```

#### Input Validation Security Tests
```typescript
// test/security/input-validation.test.ts
describe('Input Validation Security', () => {
  it('should prevent XSS in video titles', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const response = await createVideoWithTitle(xssPayload);
    
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain('invalid characters');
  });

  it('should prevent SQL injection in search', async () => {
    const sqlInjection = "'; DROP TABLE videos; --";
    const response = await env.app.request(`/api/videos/search?q=${sqlInjection}`);
    
    expect(response.status).toBe(400);
  });

  it('should limit request payload size', async () => {
    const largePayload = 'x'.repeat(10 * 1024 * 1024); // 10MB
    const response = await env.app.request('/api/videos', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid-token',
        'Content-Type': 'application/json'
      },
      body: largePayload
    });

    expect(response.status).toBe(413); // Payload Too Large
  });
});
```

---

## 2. Processor Testing Strategy (apps/processor/)

### 2.1 Current Testing Approach Analysis

**Existing Tests:**
- ✅ Comprehensive unit tests (254 lines)
- ✅ Message validation tests
- ✅ R2 save failure scenarios
- ✅ Retry logic testing

**Strengths:**
- Good coverage of message types
- Mock environment setup
- Error handling validation

**Gaps:**
- No integration with real Cloudflare Queue
- No performance testing under load
- No DLQ testing
- No end-to-end message flow testing

### 2.2 Recommended Testing Enhancements

#### Queue Integration Testing
```typescript
// test/integration/queue-integration.test.ts
describe('Cloudflare Queue Integration', () => {
  let realQueue: Queue;
  let testEnv: QueueEnvironment;

  beforeAll(async () => {
    // Set up test queue
    realQueue = new Queue('test-al-ummah-now-videos');
    testEnv = createRealQueueEnv(realQueue);
  });

  it('should process messages from real queue', async () => {
    const testMessage: AlUmmahMessage = {
      id: 'test-queue-1',
      type: MessageType.VideoView,
      timestamp: Date.now(),
      payload: {
        videoId: 'test-video-123',
        viewerId: 'test-user-456'
      }
    };

    // Send message to real queue
    await realQueue.send(testMessage);

    // Wait for processing
    await sleep(2000);

    // Verify message was processed
    const processedMessages = await getProcessedMessages();
    expect(processedMessages).toContain(
      expect.objectContaining({ id: 'test-queue-1' })
    );
  });

  it('should handle batch processing', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-test-${i}`,
      type: MessageType.VideoView,
      timestamp: Date.now(),
      payload: { videoId: `video-${i}`, viewerId: `user-${i}` }
    }));

    // Send batch
    await Promise.all(messages.map(msg => realQueue.send(msg)));

    // Wait for batch processing
    await sleep(5000);

    // Verify all messages processed
    const processedMessages = await getProcessedMessages();
    expect(processedMessages).toHaveLength(10);
  });
});
```

#### Dead Letter Queue Testing
```typescript
// test/integration/dlq-testing.test.ts
describe('Dead Letter Queue Testing', () => {
  it('should send failed messages to DLQ after max retries', async () => {
    const failingMessage: AlUmmahMessage = {
      id: 'failing-message',
      type: MessageType.VideoView,
      timestamp: Date.now(),
      payload: { /* Invalid payload that will always fail */ }
    };

    // Send message that will fail processing
    await testQueue.send(failingMessage);

    // Wait for retries and DLQ transfer
    await sleep(10000);

    // Verify message ended up in DLQ
    const dlqMessages = await getDLQMessages();
    expect(dlqMessages).toContain(
      expect.objectContaining({ id: 'failing-message' })
    );

    // Verify retry count
    const dlqMessage = dlqMessages.find(m => m.id === 'failing-message');
    expect(dlqMessage.retryCount).toBeGreaterThanOrEqual(3);
  });
});
```

#### Performance Testing Under Load
```typescript
// test/performance/processor-load.test.ts
describe('Processor Performance Testing', () => {
  it('should handle 1000 messages/minute', async () => {
    const startTime = Date.now();
    const messageCount = 1000;
    const messages = generateTestMessages(messageCount);

    // Send all messages
    await Promise.all(messages.map(msg => testQueue.send(msg)));

    // Wait for processing
    await waitForProcessing(messageCount);

    const endTime = Date.now();
    const duration = endTime - startTime;
    const messagesPerMinute = (messageCount / duration) * 60000;

    expect(messagesPerMinute).toBeGreaterThan(1000);
  });

  it('should maintain memory usage under load', async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Process large batch
    await processLargeMessageBatch(10000);

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    // Memory increase should be reasonable (< 100MB)
    expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
  });
});
```

### 2.3 Message Type Validation Enhancement

#### Comprehensive Message Testing
```typescript
// test/unit/message-types-comprehensive.test.ts
describe('All Message Types Validation', () => {
  const messageTypes = Object.values(MessageType);

  messageTypes.forEach(messageType => {
    describe(`${MessageType[messageType]} messages`, () => {
      it(`should validate ${MessageType[messageType]} structure`, () => {
        const message = generateValidMessage(messageType);
        const validation = validateMessage(message);
        expect(validation.isValid).toBe(true);
      });

      it(`should reject invalid ${MessageType[messageType]} messages`, () => {
        const message = generateInvalidMessage(messageType);
        const validation = validateMessage(message);
        expect(validation.isValid).toBe(false);
        expect(validation.errors).not.toHaveLength(0);
      });

      it(`should process ${MessageType[messageType]} successfully`, async () => {
        const message = generateValidMessage(messageType);
        const result = await processor.processMessage(message, mockEnv);
        expect(result.success).toBe(true);
      });
    });
  });
});
```

---

## 3. Queue Testing Strategy (Cloudflare Queue)

### 3.1 Queue Testing Framework

#### Test Queue Setup
```typescript
// test/setup/queue-test-setup.ts
export class TestQueueManager {
  private testQueues = new Map<string, Queue>();

  async createTestQueue(name: string): Promise<Queue> {
    const queue = new Queue(`test-${name}-${Date.now()}`);
    this.testQueues.set(name, queue);
    return queue;
  }

  async cleanup(): Promise<void> {
    for (const [name, queue] of this.testQueues) {
      await queue.purge(); // Clear all messages
    }
    this.testQueues.clear();
  }

  async getQueueStats(name: string): Promise<QueueStats> {
    const queue = this.testQueues.get(name);
    if (!queue) throw new Error(`Queue ${name} not found`);
    return queue.getStats();
  }
}
```

#### Message Ordering Tests
```typescript
// test/integration/queue-ordering.test.ts
describe('Queue Message Ordering', () => {
  let queueManager: TestQueueManager;

  beforeAll(async () => {
    queueManager = new TestQueueManager();
  });

  it('should preserve FIFO ordering', async () => {
    const queue = await queueManager.createTestQueue('fifo-test');
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `message-${i}`,
      timestamp: Date.now() + i,
      payload: { order: i }
    }));

    // Send messages in order
    for (const message of messages) {
      await queue.send(message);
    }

    // Receive and verify order
    const receivedMessages = [];
    for await (const message of queue.receive()) {
      receivedMessages.push(message);
      if (receivedMessages.length === 100) break;
    }

    for (let i = 0; i < 100; i++) {
      expect(receivedMessages[i].payload.order).toBe(i);
    }
  });

  it('should handle priority messages correctly', async () => {
    const queue = await queueManager.createTestQueue('priority-test');
    
    // Send normal messages
    await queue.send({ id: 'normal-1', priority: 'normal' });
    await queue.send({ id: 'normal-2', priority: 'normal' });
    
    // Send high priority message
    await queue.send({ id: 'urgent-1', priority: 'high' });
    
    // Send more normal messages
    await queue.send({ id: 'normal-3', priority: 'normal' });

    const receivedMessages = [];
    for await (const message of queue.receive({ batchSize: 10 })) {
      receivedMessages.push(message);
      if (receivedMessages.length === 4) break;
    }

    // High priority message should be processed first
    expect(receivedMessages[0].id).toBe('urgent-1');
  });
});
```

### 3.2 Queue Durability Testing

#### Message Persistence Tests
```typescript
// test/integration/queue-durability.test.ts
describe('Queue Durability Testing', () => {
  it('should survive worker restarts', async () => {
    const queue = await queueManager.createTestQueue('durability-test');
    
    // Send messages
    await queue.send({ id: 'survival-test-1' });
    await queue.send({ id: 'survival-test-2' });
    
    // Simulate worker restart
    await simulateWorkerRestart();
    
    // Messages should still be available
    const messages = [];
    for await (const message of queue.receive()) {
      messages.push(message);
      if (messages.length === 2) break;
    }
    
    expect(messages).toHaveLength(2);
    expect(messages.map(m => m.id)).toEqual(['survival-test-1', 'survival-test-2']);
  });

  it('should handle network partitions gracefully', async () => {
    const queue = await queueManager.createTestQueue('partition-test');
    
    // Send messages before partition
    await queue.send({ id: 'pre-partition' });
    
    // Simulate network partition
    await simulateNetworkPartition(5000); // 5 seconds
    
    // Send messages during partition
    await queue.send({ id: 'during-partition' });
    
    // Heal partition
    await healNetworkPartition();
    
    // All messages should be processed
    const messages = [];
    for await (const message of queue.receive()) {
      messages.push(message);
      if (messages.length === 2) break;
    }
    
    expect(messages).toHaveLength(2);
  });
});
```

### 3.3 Queue Performance Testing

#### Throughput Testing
```typescript
// test/performance/queue-throughput.test.ts
describe('Queue Performance Testing', () => {
  it('should handle 10,000 messages/minute', async () => {
    const queue = await queueManager.createTestQueue('throughput-test');
    const messageCount = 10000;
    const startTime = Date.now();

    // Send messages in parallel
    const sendPromises = Array.from({ length: messageCount }, (_, i) =>
      queue.send({ id: `perf-${i}`, payload: { data: 'x'.repeat(1024) } })
    );

    await Promise.all(sendPromises);

    const sendTime = Date.now() - startTime;
    const messagesPerSecond = messageCount / (sendTime / 1000);

    expect(messagesPerSecond).toBeGreaterThan(166); // 10,000/minute
  });

  it('should maintain low latency under load', async () => {
    const queue = await queueManager.createTestQueue('latency-test');
    const latencies = [];

    for (let i = 0; i < 1000; i++) {
      const start = Date.now();
      await queue.send({ id: `latency-${i}` });
      const end = Date.now();
      latencies.push(end - start);
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
    const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

    expect(avgLatency).toBeLessThan(100); // < 100ms average
    expect(p95Latency).toBeLessThan(200); // < 200ms p95
  });
});
```

---

## 4. R2 Testing Strategy (Cloudflare R2)

### 4.1 R2 Testing Framework

#### R2 Test Manager
```typescript
// test/setup/r2-test-setup.ts
export class R2TestManager {
  private testBuckets = new Map<string, R2Bucket>();

  async createTestBucket(name: string): Promise<R2Bucket> {
    const bucketName = `test-${name}-${Date.now()}`;
    const bucket = new R2Bucket(bucketName);
    this.testBuckets.set(name, bucket);
    return bucket;
  }

  async cleanup(): Promise<void> {
    for (const [name, bucket] of this.testBuckets) {
      // Delete all objects
      const objects = await bucket.list();
      for (const object of objects.objects) {
        await bucket.delete(object.key);
      }
    }
    this.testBuckets.clear();
  }

  async getBucketStats(name: string): Promise<BucketStats> {
    const bucket = this.testBuckets.get(name);
    if (!bucket) throw new Error(`Bucket ${name} not found`);
    
    const objects = await bucket.list();
    return {
      objectCount: objects.objects.length,
      totalSize: objects.objects.reduce((sum, obj) => sum + obj.size, 0)
    };
  }
}
```

### 4.2 Object Storage Operations Testing

#### CRUD Operations Testing
```typescript
// test/integration/r2-crud.test.ts
describe('R2 CRUD Operations', () => {
  let r2Manager: R2TestManager;
  let testBucket: R2Bucket;

  beforeAll(async () => {
    r2Manager = new R2TestManager();
    testBucket = await r2Manager.createTestBucket('crud-test');
  });

  it('should store and retrieve objects', async () => {
    const key = 'test-object-1';
    const data = { message: 'Hello R2!', timestamp: Date.now() };
    const jsonData = JSON.stringify(data);

    // Store object
    await testBucket.put(key, jsonData, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { version: '1.0' }
    });

    // Retrieve object
    const result = await testBucket.get(key);
    expect(result).toBeDefined();
    
    const retrievedData = await result.json();
    expect(retrievedData).toEqual(data);
    expect(result.customMetadata.version).toBe('1.0');
  });

  it('should handle large files efficiently', async () => {
    const key = 'large-file';
    const largeData = 'x'.repeat(100 * 1024 * 1024); // 100MB

    const startTime = Date.now();
    await testBucket.put(key, largeData);
    const uploadTime = Date.now() - startTime;

    const downloadStart = Date.now();
    const result = await testBucket.get(key);
    const downloadedData = await result.text();
    const downloadTime = Date.now() - downloadStart;

    expect(downloadedData).toBe(largeData);
    expect(uploadTime).toBeLessThan(10000); // < 10s upload
    expect(downloadTime).toBeLessThan(5000); // < 5s download
  });

  it('should handle concurrent operations', async () => {
    const concurrentOperations = 100;
    const operations = Array.from({ length: concurrentOperations }, (_, i) =>
      testBucket.put(`concurrent-${i}`, `data-${i}`)
    );

    const startTime = Date.now();
    await Promise.all(operations);
    const duration = Date.now() - startTime;

    // Verify all objects were stored
    const objects = await testBucket.list();
    expect(objects.objects).toHaveLength(concurrentOperations);

    // Should complete in reasonable time
    expect(duration).toBeLessThan(5000);
  });
});
```

### 4.3 Bucket Permissions and Security Testing

#### Access Control Testing
```typescript
// test/security/r2-access-control.test.ts
describe('R2 Access Control', () => {
  it('should enforce bucket permissions', async () => {
    const publicBucket = await r2Manager.createTestBucket('public');
    const privateBucket = await r2Manager.createTestBucket('private');

    // Store test data
    await publicBucket.put('public-file', 'public data');
    await privateBucket.put('private-file', 'private data');

    // Test public access
    const publicAccess = await testPublicAccess(publicBucket.name, 'public-file');
    expect(publicAccess.success).toBe(true);

    // Test private access restriction
    const privateAccess = await testPublicAccess(privateBucket.name, 'private-file');
    expect(privateAccess.success).toBe(false);
    expect(privateAccess.error).toContain('Forbidden');
  });

  it('should prevent unauthorized bucket operations', async () => {
    const bucket = await r2Manager.createTestBucket('secure');
    
    // Try to access with invalid credentials
    const unauthorizedAccess = await testUnauthorizedAccess(bucket.name);
    expect(unauthorizedAccess.success).toBe(false);
    expect(unauthorizedAccess.error).toContain('Unauthorized');
  });
});
```

### 4.4 Data Consistency Validation

#### Consistency Testing
```typescript
// test/integration/r2-consistency.test.ts
describe('R2 Data Consistency', () => {
  it('should provide read-after-write consistency', async () => {
    const bucket = await r2Manager.createTestBucket('consistency');
    const key = 'consistency-test';
    const data = { version: 1, timestamp: Date.now() };

    // Write data
    await bucket.put(key, JSON.stringify(data));

    // Immediate read should return latest data
    const result = await bucket.get(key);
    const readData = await result.json();
    expect(readData).toEqual(data);
  });

  it('should handle concurrent writes correctly', async () => {
    const bucket = await r2Manager.createTestBucket('concurrent-writes');
    const key = 'concurrent-key';

    // Simulate concurrent writes
    const writePromises = Array.from({ length: 10 }, (_, i) =>
      bucket.put(key, JSON.stringify({ version: i + 1 }))
    );

    await Promise.all(writePromises);

    // Final read should return one of the versions
    const result = await bucket.get(key);
    const finalData = await result.json();
    expect(finalData.version).toBeGreaterThan(0);
    expect(finalData.version).toBeLessThanOrEqual(10);
  });
});
```

### 4.5 Performance and Latency Testing

#### R2 Performance Benchmarks
```typescript
// test/performance/r2-performance.test.ts
describe('R2 Performance Testing', () => {
  it('should meet latency requirements', async () => {
    const bucket = await r2Manager.createTestBucket('performance');
    const latencies = [];

    for (let i = 0; i < 100; i++) {
      const key = `perf-test-${i}`;
      const data = `test-data-${i}`;

      // Measure write latency
      const writeStart = Date.now();
      await bucket.put(key, data);
      const writeLatency = Date.now() - writeStart;

      // Measure read latency
      const readStart = Date.now();
      await bucket.get(key);
      const readLatency = Date.now() - readStart;

      latencies.push({ write: writeLatency, read: readLatency });
    }

    const avgWriteLatency = latencies.reduce((sum, l) => sum + l.write, 0) / latencies.length;
    const avgReadLatency = latencies.reduce((sum, l) => sum + l.read, 0) / latencies.length;

    expect(avgWriteLatency).toBeLessThan(200); // < 200ms write
    expect(avgReadLatency).toBeLessThan(100);  // < 100ms read
  });

  it('should handle high throughput', async () => {
    const bucket = await r2Manager.createTestBucket('throughput');
    const objectCount = 1000;
    const objectSize = 1024 * 1024; // 1MB each

    const startTime = Date.now();
    
    // Upload objects in parallel
    const uploadPromises = Array.from({ length: objectCount }, (_, i) =>
      bucket.put(`throughput-${i}`, 'x'.repeat(objectSize))
    );

    await Promise.all(uploadPromises);
    
    const duration = Date.now() - startTime;
    const throughput = (objectCount * objectSize) / (duration / 1000); // bytes/second

    expect(throughput).toBeGreaterThan(10 * 1024 * 1024); // > 10MB/s
  });
});
```

---

## 5. WebSocket Server Testing Strategy (apps/websocket-server/)

### 5.1 Current Testing Gap Analysis

**Current State:**
- ❌ Zero test coverage
- ❌ No WebSocket connection testing
- ❌ No Durable Object testing
- ❌ No authentication testing

### 5.2 WebSocket Testing Framework

#### WebSocket Test Client
```typescript
// test/setup/websocket-test-client.ts
export class WebSocketTestClient {
  private ws: WebSocket | null = null;
  private messages: any[] = [];
  private connectionPromise: Promise<void>;

  constructor(private url: string) {
    this.connectionPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => resolve();
      this.ws.onerror = (error) => reject(error);
      this.ws.onmessage = (event) => {
        this.messages.push(JSON.parse(event.data));
      };
    });
  }

  async connect(): Promise<void> {
    await this.connectionPromise;
  }

  async send(message: any): Promise<void> {
    if (!this.ws) throw new Error('WebSocket not connected');
    this.ws.send(JSON.stringify(message));
  }

  async waitForMessage(predicate: (msg: any) => boolean, timeout = 5000): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const message = this.messages.find(predicate);
      if (message) {
        this.messages = this.messages.filter(m => m !== message);
        return message;
      }
      await sleep(100);
    }
    
    throw new Error('Message not received within timeout');
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

### 5.3 WebSocket Connection Testing

#### Connection Lifecycle Tests
```typescript
// test/integration/websocket-connections.test.ts
describe('WebSocket Connection Testing', () => {
  let client: WebSocketTestClient;

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  it('should establish connection successfully', async () => {
    client = new WebSocketTestClient('ws://localhost:3087/ws');
    await client.connect();
    
    // Connection should be established
    expect(client.isConnected()).toBe(true);
  });

  it('should reject unauthorized connections', async () => {
    const unauthorizedClient = new WebSocketTestClient('ws://localhost:3087/ws');
    
    await expect(unauthorizedClient.connect()).rejects.toThrow('Unauthorized');
  });

  it('should handle connection timeouts', async () => {
    const slowClient = new WebSocketTestClient('ws://localhost:3087/ws');
    
    // Simulate slow connection
    const connectPromise = slowClient.connect();
    await sleep(100);
    
    // Should timeout after configured period
    await expect(connectPromise).rejects.toThrow('timeout');
  });
});
```

### 5.4 Durable Objects Testing

#### Durable Object State Management
```typescript
// test/integration/durable-objects.test.ts
describe('Durable Objects Testing', () => {
  let doStub: DurableObjectStub;

  beforeAll(async () => {
    doStub = env.WEBSOCKET_DO.get(env.WEBSOCKET_DO.idFromName('test-instance'));
  });

  it('should maintain state across requests', async () => {
    // Set initial state
    await doStub.fetch(new Request('http://internal/set-state', {
      method: 'POST',
      body: JSON.stringify({ counter: 1 })
    }));

    // Read state
    const response = await doStub.fetch(new Request('http://internal/get-state'));
    const state = await response.json();
    
    expect(state.counter).toBe(1);
  });

  it('should handle concurrent connections', async () => {
    const connectionCount = 100;
    const clients = Array.from({ length: connectionCount }, () =>
      new WebSocketTestClient('ws://localhost:3087/ws')
    );

    // Connect all clients concurrently
    await Promise.all(clients.map(client => client.connect()));

    // Verify all connections are active
    const statsResponse = await fetch('http://localhost:3087/stats');
    const stats = await statsResponse.json();
    expect(stats.activeConnections).toBe(connectionCount);

    // Cleanup
    clients.forEach(client => client.disconnect());
  });
});
```

### 5.5 Authentication and Security Testing

#### WebSocket Authentication
```typescript
// test/security/websocket-auth.test.ts
describe('WebSocket Authentication', () => {
  it('should authenticate with valid JWT', async () => {
    const validToken = generateValidJWT();
    const client = new WebSocketTestClient(`ws://localhost:3087/ws?token=${validToken}`);
    
    await client.connect();
    expect(client.isConnected()).toBe(true);
    
    client.disconnect();
  });

  it('should reject invalid JWT', async () => {
    const invalidToken = 'invalid.jwt.token';
    const client = new WebSocketTestClient(`ws://localhost:3087/ws?token=${invalidToken}`);
    
    await expect(client.connect()).rejects.toThrow('authentication failed');
  });

  it('should handle token expiration during session', async () => {
    const expiringToken = generateExpiringJWT(1000); // Expires in 1 second
    const client = new WebSocketTestClient(`ws://localhost:3087/ws?token=${expiringToken}`);
    
    await client.connect();
    
    // Wait for token to expire
    await sleep(2000);
    
    // Next message should be rejected
    await expect(client.send({ type: 'test' })).rejects.toThrow('token expired');
    
    client.disconnect();
  });
});
```

### 5.6 Rate Limiting and Performance Testing

#### Rate Limiting Tests
```typescript
// test/performance/websocket-rate-limiting.test.ts
describe('WebSocket Rate Limiting', () => {
  it('should enforce message rate limits', async () => {
    const client = new WebSocketTestClient('ws://localhost:3087/ws');
    await client.connect();

    // Send messages rapidly (should exceed rate limit)
    const messagePromises = Array.from({ length: 150 }, (_, i) =>
      client.send({ type: 'test', id: i })
    );

    const results = await Promise.allSettled(messagePromises);
    const rejectedCount = results.filter(r => r.status === 'rejected').length;
    
    // Some messages should be rejected due to rate limiting
    expect(rejectedCount).toBeGreaterThan(0);
    
    client.disconnect();
  });

  it('should handle high connection load', async () => {
    const connectionCount = 1000;
    const clients = Array.from({ length: connectionCount }, () =>
      new WebSocketTestClient('ws://localhost:3087/ws')
    );

    const startTime = Date.now();
    
    // Connect all clients
    await Promise.all(clients.map(client => client.connect()));
    
    const connectionTime = Date.now() - startTime;
    
    // Should handle connections efficiently
    expect(connectionTime).toBeLessThan(10000); // < 10 seconds
    
    // Verify server is still responsive
    const healthResponse = await fetch('http://localhost:3087/health');
    expect(healthResponse.ok).toBe(true);
    
    // Cleanup
    clients.forEach(client => client.disconnect());
  });
});
```

---

## 6. Integration Testing Strategy

### 6.1 End-to-End Workflow Testing

#### Complete Video Upload Workflow
```typescript
// test/e2e/video-upload-workflow.test.ts
describe('Complete Video Upload Workflow', () => {
  it('should process video from upload to viewing', async () => {
    // 1. Upload video via API
    const uploadResponse = await uploadTestVideo();
    const videoId = uploadResponse.data.id;

    // 2. Verify video stored in R2
    const videoObject = await getR2Object('videos', videoId);
    expect(videoObject).toBeDefined();

    // 3. Verify message queued for processing
    const queuedMessages = await getQueuedMessages();
    const uploadMessage = queuedMessages.find(m => 
      m.type === MessageType.VideoCreate && m.payload.videoId === videoId
    );
    expect(uploadMessage).toBeDefined();

    // 4. Wait for processor to handle message
    await sleep(2000);

    // 5. Verify video appears in listings
    const listResponse = await fetch(`http://localhost:3086/api/videos`);
    const videos = await listResponse.json();
    expect(videos.data).toContain(
      expect.objectContaining({ id: videoId })
    );

    // 6. View video (triggers analytics)
    await viewVideo(videoId);

    // 7. Verify view analytics message queued
    const viewMessages = await getQueuedMessages();
    const viewMessage = viewMessages.find(m => 
      m.type === MessageType.VideoView && m.payload.videoId === videoId
    );
    expect(viewMessage).toBeDefined();

    // 8. Verify WebSocket notification sent
    const wsClient = new WebSocketTestClient('ws://localhost:3087/ws');
    await wsClient.connect();
    await wsClient.send({ type: 'subscribe', channel: `video-${videoId}` });
    
    const notification = await wsClient.waitForMessage(
      msg => msg.type === 'video_view_update'
    );
    expect(notification.videoId).toBe(videoId);
    
    wsClient.disconnect();
  });
});
```

### 6.2 Cross-Service Communication Testing

#### API → Queue → Processor → WebSocket Flow
```typescript
// test/integration/cross-service-flow.test.ts
describe('Cross-Service Communication', () => {
  it('should handle real-time updates across services', async () => {
    const wsClient = new WebSocketTestClient('ws://localhost:3087/ws');
    await wsClient.connect();
    await wsClient.send({ type: 'subscribe', channel: 'global-updates' });

    // 1. Create video via API
    const video = await createTestVideo();

    // 2. Wait for WebSocket notification
    const notification = await wsClient.waitForMessage(
      msg => msg.type === 'video_created' && msg.videoId === video.id
    );

    expect(notification).toBeDefined();
    expect(notification.title).toBe(video.title);

    // 3. Verify analytics were processed
    await sleep(3000); // Wait for processor
    const analytics = await getVideoAnalytics(video.id);
    expect(analytics.views).toBe(0); // Should be 0, just created

    wsClient.disconnect();
  });
});
```

---

## 7. CI/CD Integration Strategy

### 7.1 Enhanced GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Comprehensive Backend Testing

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app: [api-videos, processor, websocket-server]
    steps:
      - uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.15.4
      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build shared packages
        run: |
          pnpm --filter @al-ummah/shared-types build
          pnpm --filter @al-ummah/logger build
      - name: Run unit tests
        run: pnpm --filter @al-ummah/${{ matrix.app }} test
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./apps/${{ matrix.app }}/coverage/lcov.info

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - name: Setup environment
        run: |
          pnpm install --frozen-lockfile
          pnpm --filter @al-ummah/shared-types build
          pnpm --filter @al-ummah/logger build
      - name: Start services
        run: |
          pnpm dev &
          sleep 30 # Wait for services to start
      - name: Run integration tests
        run: pnpm test:integration
      - name: Run API contract tests
        run: pnpm test:contract

  performance-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Setup k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      - name: Run load tests
        run: k6 run test/performance/load-test.js
      - name: Upload performance results
        uses: actions/upload-artifact@v4
        with:
          name: performance-results
          path: performance-results.json

  security-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - name: Run security audit
        run: pnpm audit
      - name: Run SAST scan
        uses: github/super-linter@v4
        env:
          DEFAULT_BRANCH: main
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VALIDATE_TYPESCRIPT_ES: true
```

### 7.2 Test Scripts Configuration

```json
// package.json additions
{
  "scripts": {
    "test": "pnpm run test:unit && pnpm run test:integration",
    "test:unit": "pnpm --filter '*test*' test",
    "test:integration": "jest --config jest.integration.config.js",
    "test:contract": "dredd openapi.json http://localhost:3086",
    "test:performance": "k6 run test/performance/load-test.js",
    "test:security": "pnpm audit && npm run test:sast",
    "test:sast": "eslint --ext .ts,.js . --format json --output-file sast-report.json",
    "test:coverage": "pnpm test --coverage",
    "test:watch": "jest --watch",
    "pre-test": "pnpm build && pnpm dev &",
    "post-test": "pkill -f 'wrangler dev'"
  }
}
```

---

## 8. Testing Best Practices and Guidelines

### 8.1 Test Organization

```
apps/
├── api-videos/
│   ├── src/
│   └── test/
│       ├── unit/           # Unit tests for individual functions
│       ├── integration/    # API endpoint tests
│       ├── contract/       # OpenAPI contract tests
│       ├── performance/    # Load and stress tests
│       ├── security/       # Security vulnerability tests
│       ├── fixtures/       # Test data and mocks
│       └── setup/          # Test configuration and utilities
├── processor/
│   └── test/
│       ├── unit/
│       ├── integration/
│       ├── performance/
│       └── fixtures/
└── websocket-server/
    └── test/
        ├── unit/
        ├── integration/
        ├── performance/
        └── fixtures/
```

### 8.2 Test Data Management

#### Test Data Factories
```typescript
// test/factories/message-factory.ts
export class MessageFactory {
  static createVideoView(overrides?: Partial<AlUmmahMessage>): AlUmmahMessage {
    return {
      id: `video-view-${Date.now()}`,
      type: MessageType.VideoView,
      timestamp: Date.now(),
      payload: {
        videoId: `video-${Math.random().toString(36).substr(2, 9)}`,
        viewerId: `user-${Math.random().toString(36).substr(2, 9)}`,
        watchTime: Math.floor(Math.random() * 3600)
      },
      ...overrides
    };
  }

  static createVideoCreate(overrides?: Partial<AlUmmahMessage>): AlUmmahMessage {
    return {
      id: `video-create-${Date.now()}`,
      type: MessageType.VideoCreate,
      timestamp: Date.now(),
      payload: {
        videoId: `video-${Math.random().toString(36).substr(2, 9)}`,
        userId: `user-${Math.random().toString(36).substr(2, 9)}`,
        title: 'Test Video',
        description: 'Test Description'
      },
      ...overrides
    };
  }
}
```

### 8.3 Mock and Stub Guidelines

#### When to Mock vs Real Services

| Scenario | Use Mock | Use Real Service |
|----------|----------|------------------|
| Unit tests | ✅ | ❌ |
| Integration tests | ❌ | ✅ |
| Performance tests | ❌ | ✅ |
| External APIs | ✅ | ❌ |
| Cloudflare services | ❌ (use test env) | ✅ |

### 8.4 Test Environment Management

#### Environment Configuration
```typescript
// test/config/test-environments.ts
export const testEnvironments = {
  unit: {
    mockR2: true,
    mockQueue: true,
    mockAuth: true,
    mockWebSocket: true
  },
  integration: {
    mockR2: false,
    mockQueue: false,
    mockAuth: true,
    mockWebSocket: false
  },
  e2e: {
    mockR2: false,
    mockQueue: false,
    mockAuth: false,
    mockWebSocket: false
  }
};
```

---

## 9. Monitoring and Reporting

### 9.1 Test Metrics Dashboard

#### Key Performance Indicators

| Metric | Target | Measurement |
|--------|--------|-------------|
| Code Coverage | > 80% | Unit tests |
| API Response Time | < 500ms p95 | Load tests |
| Queue Throughput | > 1000 msg/min | Performance tests |
| Error Rate | < 1% | Integration tests |
| Security Vulnerabilities | 0 critical | Security scans |

### 9.2 Automated Reporting

#### Test Results Notification
```typescript
// scripts/test-reporter.ts
export class TestReporter {
  async generateReport(): Promise<TestReport> {
    const coverage = await this.getCoverageReport();
    const performance = await this.getPerformanceReport();
    const security = await this.getSecurityReport();

    return {
      timestamp: new Date().toISOString(),
      coverage: {
        total: coverage.lines.total,
        covered: coverage.lines.covered,
        percentage: coverage.lines.pct
      },
      performance: {
        avgResponseTime: performance.avgResponseTime,
        p95ResponseTime: performance.p95ResponseTime,
        throughput: performance.throughput
      },
      security: {
        vulnerabilities: security.vulnerabilities,
        criticalIssues: security.criticalIssues
      }
    };
  }

  async notifySlack(report: TestReport): Promise<void> {
    const message = this.formatSlackMessage(report);
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  }
}
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Set up testing frameworks (Jest, supertest, k6)
- [ ] Create test environment setup
- [ ] Implement basic unit tests for API Videos
- [ ] Add WebSocket server basic tests
- [ ] Configure CI/CD pipeline enhancements

### Phase 2: Coverage Expansion (Week 3-4)
- [ ] Complete unit test coverage for all apps
- [ ] Implement integration tests
- [ ] Add contract testing with OpenAPI
- [ ] Create performance test suites
- [ ] Implement security testing

### Phase 3: Advanced Testing (Week 5-6)
- [ ] End-to-end workflow testing
- [ ] Cross-service integration tests
- [ ] Load testing and optimization
- [ ] Monitoring and reporting dashboard
- [ ] Documentation and training

### Phase 4: Maintenance (Ongoing)
- [ ] Regular test maintenance
- [ ] Performance benchmarking
- [ ] Security audit scheduling
- [ ] Test metrics monitoring
- [ ] Continuous improvement

---

## Conclusion

This comprehensive testing strategy provides a roadmap for achieving robust, reliable, and performant backend services for Al Ummah Now. By implementing these testing approaches, the team can:

1. **Ensure Quality**: Comprehensive test coverage across all components
2. **Prevent Regressions**: Automated testing in CI/CD pipeline
3. **Maintain Performance**: Regular performance monitoring and optimization
4. **Security Assurance**: Proactive security vulnerability detection
5. **Reliability**: Resilient services that handle failures gracefully

The strategy balances thoroughness with practicality, focusing on high-impact testing areas while providing a foundation for continuous improvement in testing practices.