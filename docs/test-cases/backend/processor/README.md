# Processor Testing Implementation

Comprehensive testing suite for the Al Ummah Now message processor (Cloudflare Workers + Queue).

## Overview

This testing suite covers:
- **Message Processing**: All 13+ message types with validation
- **Queue Integration**: Cloudflare Queue consumer testing
- **R2 Storage**: Message persistence and watch history tracking
- **Retry Logic**: Error handling and dead letter queue
- **Performance**: Batch processing and throughput validation
- **Analytics**: Message processing statistics and monitoring

## Message Types Covered

### Profile Messages
- `ProfileCreate` - User profile creation
- `ProfileUpdate` - User profile updates  
- `ProfileDelete` - User profile deletion
- `ProfileView` - Profile view tracking

### Channel Messages
- `ChannelCreate` - Channel creation
- `ChannelUpdate` - Channel updates
- `ChannelDelete` - Channel deletion
- `ChannelView` - Channel view tracking

### Video Messages
- `VideoCreate` - Video upload/creation
- `VideoEdit` - Video editing
- `VideoDelete` - Video deletion
- `VideoView` - Video view tracking
- `VideoLike` - Video like action
- `VideoUnlike` - Video unlike action
- `VideoDislike` - Video dislike action
- `VideoUndislike` - Video undislike action

### Comment Messages
- `CommentCreate` - Comment creation
- `CommentEdit` - Comment editing
- `CommentDelete` - Comment deletion
- `CommentLike` - Comment like action
- `CommentDislike` - Comment dislike action
- `CommentUnlike` - Comment unlike action
- `CommentUndislike` - Comment undislike action

### Playlist Messages
- `PlaylistCreate` - Playlist creation
- `PlaylistEdit` - Playlist editing
- `PlaylistDelete` - Playlist deletion
- `PlaylistAdd` - Add video to playlist
- `PlaylistRemove` - Remove video from playlist
- `PlaylistClone` - Clone existing playlist

### Subscription Messages
- `Subscribe` - User subscribes to a channel
- `Unsubscribe` - User unsubscribes from a channel

### Watch History Messages
- `WatchHistoryUpdate` - Update watch progress and history
- `WatchHistoryDelete` - Delete watch history entry

## Test Structure

```
processor/
├── README.md                    # This file
├── unit/                        # Unit tests
│   ├── messageProcessor.test.ts # Core message processing logic
│   ├── queueHandler.test.ts     # Queue consumer logic
│   ├── r2Storage.test.ts        # R2 storage operations
│   ├── retryLogic.test.ts       # Retry and DLQ handling
│   └── analytics.test.ts        # Analytics processing
├── integration/                 # Integration tests
│   ├── end-to-end.test.ts       # Complete message flows
│   ├── queue-to-r2.test.ts      # Queue to R2 persistence
│   └── watch-history.test.ts    # Watch history tracking
├── performance/                 # Performance tests
│   ├── batch-processing.test.ts # Batch processing efficiency
│   ├── throughput.test.ts        # Message throughput testing
│   └── memory-usage.test.ts     # Memory consumption validation
├── fixtures/                    # Test data
│   ├── messages.json            # Sample messages
│   ├── invalid-messages.json    # Invalid message examples
│   └── bulk-messages.json       # Large message sets
├── mocks/                       # Mock implementations
│   ├── queue.mock.ts            # Cloudflare Queue mock
│   ├── r2.mock.ts               # R2 storage mock
│   └── analytics.mock.ts        # Analytics service mock
└── helpers/                     # Test utilities
    ├── messageFactory.ts        # Message generation
    ├── testEnvironment.ts       # Test environment setup
    └── assertions.ts            # Custom assertions
```

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm package manager
- Local development environment

### Running Tests

```bash
# Run all processor tests
cd apps/processor && pnpm test

# Run specific test suites
pnpm test:unit              # Unit tests only
pnpm test:integration       # Integration tests only
pnpm test:performance       # Performance tests only
pnpm test:watch             # Watch mode for development

# Run with coverage
pnpm test:coverage

# Run specific message type tests
pnpm test -- --testNamePattern="VideoView"
pnpm test -- --testNamePattern="ProfileCreate"
```

## Test Configuration

### Environment Setup

```typescript
// test-config.ts
export const testConfig = {
  queue: {
    name: 'alummah-messages-test',
    dlqName: 'alummah-dlq-test',
    batchSize: 10,
    maxRetries: 3,
    waitTime: 30
  },
  storage: {
    messagesBucket: 'al-ummah-now-messages-test',
    watchHistoryBucket: 'watch-history-test',
    watchHistoryPreviewBucket: 'watch-history-preview-test'
  },
  performance: {
    maxProcessingTime: 5000, // 5 seconds per batch
    maxMemoryUsage: 128 * 1024 * 1024, // 128MB
    minThroughput: 100 // messages per second
  }
};
```

### Message Factory

```typescript
// helpers/messageFactory.ts
export class MessageFactory {
  static createProfileMessage(type: string, overrides: any = {}) {
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: new Date().toISOString(),
      data: {
        userId: `user-${Math.random().toString(36).substr(2, 9)}`,
        ...overrides
      },
      priority: 'normal'
    };
  }

  static createVideoMessage(type: string, overrides: any = {}) {
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: new Date().toISOString(),
      data: {
        videoId: `video-${Math.random().toString(36).substr(2, 9)}`,
        userId: `user-${Math.random().toString(36).substr(2, 9)}`,
        ...overrides
      },
      priority: 'normal'
    };
  }

  // ... other message type factories
}
```

## Test Categories

### 1. Unit Tests

#### Message Processing Tests
- **Validation**: Message schema validation
- **Transformation**: Data transformation logic
- **Business Logic**: Core processing rules
- **Error Handling**: Graceful error management

#### Queue Handler Tests
- **Batch Processing**: Multiple message handling
- **Acknowledgment**: Proper queue acknowledgment
- **Retry Logic**: Retry mechanism validation
- **DLQ Handling**: Dead letter queue processing

#### R2 Storage Tests
- **Message Persistence**: Saving messages to R2
- **Watch History**: Watch history tracking
- **Data Retrieval**: Reading stored data
- **Cleanup**: Old data removal

### 2. Integration Tests

#### End-to-End Message Flow
```typescript
describe('End-to-End Message Processing', () => {
  it('should process VideoView message completely', async () => {
    // 1. Create VideoView message
    const message = MessageFactory.createVideoMessage('VideoView', {
      watchTime: 120,
      duration: 300
    });

    // 2. Send to queue
    await queue.send(message);

    // 3. Process message
    await processor.processBatch([message]);

    // 4. Verify R2 storage
    const stored = await r2.get(`messages/${message.id}`);
    expect(stored).toBeTruthy();

    // 5. Verify watch history
    const history = await r2.get(`watch-history/${message.data.userId}`);
    expect(history).toContain(message.data.videoId);

    // 6. Verify analytics
    const analytics = await analytics.getVideoStats(message.data.videoId);
    expect(analytics.views).toBe(1);
  });
});
```

#### Queue to R2 Integration
- **Message Persistence**: All messages saved to R2
- **File Naming**: Proper timestamp-based naming
- **Data Integrity**: Message content preserved
- **Metadata**: Proper metadata storage

### 3. Performance Tests

#### Batch Processing Performance
```typescript
describe('Batch Processing Performance', () => {
  it('should process 1000 messages within time limit', async () => {
    const messages = Array.from({ length: 1000 }, () => 
      MessageFactory.createVideoMessage('VideoView')
    );

    const startTime = Date.now();
    await processor.processBatch(messages);
    const processingTime = Date.now() - startTime;

    expect(processingTime).toBeLessThan(testConfig.performance.maxProcessingTime);
  });

  it('should maintain memory usage within limits', async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Process large batch
    const messages = Array.from({ length: 5000 }, () => 
      MessageFactory.createVideoMessage('VideoView')
    );
    await processor.processBatch(messages);

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    expect(memoryIncrease).toBeLessThan(testConfig.performance.maxMemoryUsage);
  });
});
```

#### Throughput Testing
- **Messages per Second**: Processing rate validation
- **Concurrent Processing**: Multiple batch handling
- **Resource Usage**: CPU and memory efficiency
- **Scalability**: Performance under load

### 4. Message Type Specific Tests

#### Video View Processing
```typescript
describe('VideoView Message Processing', () => {
  it('should track video views correctly', async () => {
    const message = MessageFactory.createVideoMessage('VideoView', {
      videoId: 'test-video-123',
      userId: 'test-user-456',
      watchTime: 120,
      duration: 300
    });

    const result = await processor.processMessage(message);

    expect(result.success).toBe(true);
    expect(result.analyticsUpdated).toBe(true);
    expect(result.watchHistoryUpdated).toBe(true);
  });

  it('should handle partial watch progress', async () => {
    const message = MessageFactory.createVideoMessage('VideoView', {
      watchTime: 30,
      duration: 300,
      completed: false
    });

    const result = await processor.processMessage(message);

    expect(result.watchHistoryUpdated).toBe(true);
    expect(result.completed).toBe(false);
  });
});
```

#### Subscription Processing
```typescript
describe('Subscription Message Processing', () => {
  it('should process channel subscription', async () => {
    const message = MessageFactory.createSubscriptionMessage('Subscribe', {
      userId: 'user-123',
      channelId: 'channel-456'
    });

    const result = await processor.processMessage(message);

    expect(result.success).toBe(true);
    expect(result.subscriptionRecorded).toBe(true);
    expect(result.channelStatsUpdated).toBe(true);
  });

  it('should handle duplicate subscriptions', async () => {
    const message = MessageFactory.createSubscriptionMessage('Subscribe', {
      userId: 'user-123',
      channelId: 'channel-456'
    });

    // Process twice
    await processor.processMessage(message);
    const result = await processor.processMessage(message);

    expect(result.success).toBe(true);
    expect(result.duplicateHandled).toBe(true);
  });
});
```

## Mock Implementations

### Queue Mock
```typescript
// mocks/queue.mock.ts
export class QueueMock {
  private messages: any[] = [];
  private dlqMessages: any[] = [];

  async send(message: any): Promise<void> {
    this.messages.push(message);
  }

  async sendBatch(messages: any[]): Promise<void> {
    this.messages.push(...messages);
  }

  async receive(): Promise<any[]> {
    return this.messages.splice(0, 10); // Return batch of 10
  }

  async sendToDLQ(message: any): Promise<void> {
    this.dlqMessages.push(message);
  }

  getDLQMessages(): any[] {
    return this.dlqMessages;
  }

  clear(): void {
    this.messages = [];
    this.dlqMessages = [];
  }
}
```

### R2 Storage Mock
```typescript
// mocks/r2.mock.ts
export class R2Mock {
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

  clear(): void {
    this.storage.clear();
  }
}
```

## Test Data Management

### Message Fixtures
```json
// fixtures/messages.json
{
  "videoView": {
    "id": "msg-video-view-001",
    "type": "VideoView",
    "timestamp": "2024-01-15T10:30:00Z",
    "data": {
      "videoId": "video-123",
      "userId": "user-456",
      "watchTime": 120,
      "duration": 300,
      "completed": false
    },
    "priority": "normal"
  },
  "channelSubscribe": {
    "id": "msg-subscribe-001",
    "type": "Subscribe",
    "timestamp": "2024-01-15T10:31:00Z",
    "data": {
      "userId": "user-456",
      "channelId": "channel-789"
    },
    "priority": "normal"
  }
}
```

### Invalid Messages for Error Testing
```json
// fixtures/invalid-messages.json
{
  "missingType": {
    "id": "msg-invalid-001",
    "timestamp": "2024-01-15T10:30:00Z",
    "data": {}
  },
  "invalidTimestamp": {
    "id": "msg-invalid-002",
    "type": "VideoView",
    "timestamp": "invalid-date",
    "data": {}
  },
  "missingData": {
    "id": "msg-invalid-003",
    "type": "VideoView",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow
```yaml
# .github/workflows/processor-tests.yml
name: Processor Tests

on:
  pull_request:
    paths:
      - 'apps/processor/**'
  push:
    branches: [main]

jobs:
  processor-tests:
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
        
      - name: Run processor tests
        run: |
          cd apps/processor
          pnpm test:coverage
          
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          file: ./apps/processor/coverage/lcov.info
          
      - name: Run performance tests
        run: |
          cd apps/processor
          pnpm test:performance
```

## Coverage Requirements

### Minimum Coverage Thresholds
- **Statements**: 95%
- **Branches**: 90%
- **Functions**: 95%
- **Lines**: 95%

### Critical Path Coverage
- **Message Processing**: 100%
- **Error Handling**: 100%
- **Retry Logic**: 100%
- **R2 Operations**: 95%

## Performance Benchmarks

### Processing Targets
- **Single Message**: < 10ms
- **Batch of 100**: < 500ms
- **Batch of 1000**: < 2000ms
- **Throughput**: > 1000 messages/second

### Memory Usage
- **Base Memory**: < 50MB
- **Peak Memory**: < 128MB
- **Memory Growth**: < 1MB per 1000 messages

## Troubleshooting

### Common Issues

1. **Test Timeouts**
   ```bash
   # Increase timeout in jest.config.js
   testTimeout: 30000
   ```

2. **Mock Failures**
   ```bash
   # Verify mock implementations
   pnpm test -- --testNamePattern="Mock"
   ```

3. **Performance Test Failures**
   ```bash
   # Run with increased limits
   PERFORMANCE_TIMEOUT=10000 pnpm test:performance
   ```

### Debug Mode

```bash
# Run with debug logging
DEBUG=processor:* pnpm test

# Run specific test file
pnpm test unit/messageProcessor.test.ts

# Run with verbose output
pnpm test -- --verbose
```

## Best Practices

### Test Organization
1. **One test per scenario**: Focus on specific functionality
2. **Clear test names**: Describe what is being tested
3. **Arrange-Act-Assert**: Clear test structure
4. **Isolation**: Tests should not depend on each other

### Mock Usage
1. **Consistent behavior**: Mocks should behave predictably
2. **Reset state**: Clean up mocks between tests
3. **Realistic data**: Use representative test data
4. **Error scenarios**: Test both success and failure cases

### Performance Testing
1. **Baseline measurements**: Establish performance baselines
2. **Regression detection**: Monitor for performance degradation
3. **Resource monitoring**: Track memory and CPU usage
4. **Scalability testing**: Test under realistic load conditions