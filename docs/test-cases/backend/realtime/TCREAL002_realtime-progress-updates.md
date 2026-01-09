# TC-REAL-002: Real-time Progress Updates

## Test Case Information

- **Test ID**: TC-REAL-002
- **Title**: Real-time Progress Updates
- **Priority**: High
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 15 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that real-time progress updates are properly synchronized across multiple clients for video watch progress, upload progress, and processing status.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Test users with valid authentication tokens
- Test videos in various processing states
- Multiple browser instances or devices for synchronization testing
- Network monitoring tools for latency measurement

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
// Test data for progress updates
interface TestProgressData {
  userId: string;
  videoId: string;
  watchProgress: number;
  uploadProgress: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  timestamp: number;
  deviceId: string;
}

const testProgressData: TestProgressData[] = [
  {
    userId: 'user-progress-001',
    videoId: 'video-progress-001',
    watchProgress: 0.25,
    uploadProgress: 1.0,
    processingStatus: 'completed',
    timestamp: Date.now(),
    deviceId: 'device-001'
  },
  {
    userId: 'user-progress-002',
    videoId: 'video-progress-002',
    watchProgress: 0.60,
    uploadProgress: 0.75,
    processingStatus: 'processing',
    timestamp: Date.now(),
    deviceId: 'device-002'
  }
];
```

## Test Scenarios

### Scenario 1: Video Watch Progress Synchronization

**Test Steps:**

1. **Setup Multiple Clients**
   ```typescript
   // Open two browser sessions with same user
   const client1 = await createWebSocketClient(authToken);
   const client2 = await createWebSocketClient(authToken);
   
   // Subscribe to video progress updates
   await client1.subscribe('video-progress', { videoId: 'video-progress-001' });
   await client2.subscribe('video-progress', { videoId: 'video-progress-001' });
   ```

2. **Start Video Playback**
   ```typescript
   // Start video on client 1
   await client1.playVideo('video-progress-001');
   
   // Monitor progress updates
   const progressUpdates = [];
   client1.on('video-progress', (data) => {
     progressUpdates.push({ client: 'client1', ...data });
   });
   client2.on('video-progress', (data) => {
     progressUpdates.push({ client: 'client2', ...data });
   });
   ```

3. **Verify Synchronization**
   ```typescript
   // Wait for progress updates
   await waitFor(() => progressUpdates.length >= 10, 30000);
   
   // Validate progress synchronization
   const client1Updates = progressUpdates.filter(u => u.client === 'client1');
   const client2Updates = progressUpdates.filter(u => u.client === 'client2');
   
   // Check that both clients receive updates
   expect(client1Updates.length).toBeGreaterThan(0);
   expect(client2Updates.length).toBeGreaterThan(0);
   
   // Verify progress values are consistent
   const latestProgress = Math.max(...client1Updates.map(u => u.progress));
   const syncedProgress = client2Updates.find(u => u.progress >= latestProgress);
   expect(syncedProgress).toBeDefined();
   ```

### Scenario 2: Upload Progress Updates

**Test Steps:**

1. **Initiate Video Upload**
   ```typescript
   // Start upload process
   const uploadId = await startVideoUpload(testVideoFile);
   
   // Subscribe to upload progress
   await client.subscribe('upload-progress', { uploadId });
   ```

2. **Monitor Upload Progress**
   ```typescript
   const uploadProgress = [];
   client.on('upload-progress', (data) => {
     uploadProgress.push(data);
   });
   
   // Wait for upload completion
   await waitFor(() => {
     const latest = uploadProgress[uploadProgress.length - 1];
     return latest && latest.progress >= 100;
   }, 120000); // 2 minutes timeout
   ```

3. **Validate Progress Updates**
   ```typescript
   // Verify progress increments
   for (let i = 1; i < uploadProgress.length; i++) {
     expect(uploadProgress[i].progress).toBeGreaterThanOrEqual(
       uploadProgress[i - 1].progress
     );
     expect(uploadProgress[i].timestamp).toBeGreaterThan(
       uploadProgress[i - 1].timestamp
     );
   }
   
   // Verify final status
   const finalUpdate = uploadProgress[uploadProgress.length - 1];
   expect(finalUpdate.progress).toBe(100);
   expect(finalUpdate.status).toBe('completed');
   ```

### Scenario 3: Processing Status Updates

**Test Steps:**

1. **Submit Video for Processing**
   ```typescript
   const processingId = await submitVideoForProcessing(videoId);
   
   // Subscribe to processing updates
   await client.subscribe('processing-status', { processingId });
   ```

2. **Track Processing Stages**
   ```typescript
   const processingStages = [];
   client.on('processing-status', (data) => {
     processingStages.push(data);
   });
   
   // Wait for processing completion
   await waitFor(() => {
     const latest = processingStages[processingStages.length - 1];
     return latest && ['completed', 'failed'].includes(latest.status);
   }, 300000); // 5 minutes timeout
   ```

3. **Validate Processing Flow**
   ```typescript
   // Verify expected processing stages
   const expectedStages = ['pending', 'processing', 'completed'];
   const actualStages = processingStages.map(s => s.status);
   
   expectedStages.forEach(stage => {
     expect(actualStages).toContain(stage);
   });
   
   // Verify stage transitions
   for (let i = 1; i < processingStages.length; i++) {
     expect(processingStages[i].timestamp).toBeGreaterThan(
       processingStages[i - 1].timestamp
     );
   }
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-002: Real-time Progress Updates', () => {
  let wsClient: WebSocketClient;
  let page: Page;
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    // Setup authentication
    const context = await browser.newContext();
    page = await context.newPage();
    
    // Login and get auth token
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.click('[data-testid="login-button"]');
    
    authToken = await page.evaluate(() => {
      return localStorage.getItem('authToken');
    });

    // Initialize WebSocket client
    wsClient = new WebSocketClient(authToken);
    await wsClient.connect();
  });

  test.afterAll(async () => {
    await wsClient.disconnect();
    await page.close();
  });

  test('should synchronize video watch progress across multiple clients', async ({ browser }) => {
    // Create second client
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    const wsClient2 = new WebSocketClient(authToken);
    await wsClient2.connect();

    try {
      // Subscribe both clients to progress updates
      await wsClient.subscribe('video-progress', { videoId: 'test-video-001' });
      await wsClient2.subscribe('video-progress', { videoId: 'test-video-001' });

      const progressUpdates: any[] = [];

      wsClient.on('video-progress', (data) => {
        progressUpdates.push({ client: 'client1', ...data });
      });

      wsClient2.on('video-progress', (data) => {
        progressUpdates.push({ client: 'client2', ...data });
      });

      // Start video playback on first client
      await page.goto('/en/videos/test-video-001');
      await page.waitForSelector('[data-testid="video-player"]');
      await page.click('[data-testid="play-button"]');

      // Wait for progress updates
      await page.waitForTimeout(5000);

      // Verify both clients received updates
      const client1Updates = progressUpdates.filter(u => u.client === 'client1');
      const client2Updates = progressUpdates.filter(u => u.client === 'client2');

      expect(client1Updates.length).toBeGreaterThan(0);
      expect(client2Updates.length).toBeGreaterThan(0);

      // Verify progress synchronization
      const latestProgress = Math.max(...client1Updates.map(u => u.progress));
      const syncedUpdate = client2Updates.find(u => u.progress >= latestProgress * 0.9);
      expect(syncedUpdate).toBeDefined();

    } finally {
      await wsClient2.disconnect();
      await context2.close();
    }
  });

  test('should provide real-time upload progress updates', async () => {
    // Create test video file
    const testFile = await TestDataFactory.createVideoFile('test-upload.mp4', 1024 * 1024 * 10); // 10MB

    // Subscribe to upload progress
    await wsClient.subscribe('upload-progress', { uploadId: 'test-upload-001' });

    const uploadProgress: any[] = [];
    wsClient.on('upload-progress', (data) => {
      uploadProgress.push(data);
    });

    // Start upload
    await page.goto('/en/upload');
    await page.setInputFiles('[data-testid="video-input"]', testFile);
    await page.fill('[data-testid="video-title"]', 'Test Upload Progress');
    await page.click('[data-testid="upload-button"]');

    // Wait for upload progress updates
    await page.waitForSelector('[data-testid="upload-progress"]', { timeout: 10000 });

    // Verify progress updates
    expect(uploadProgress.length).toBeGreaterThan(0);

    // Check progress increments
    for (let i = 1; i < uploadProgress.length; i++) {
      expect(uploadProgress[i].progress).toBeGreaterThanOrEqual(uploadProgress[i - 1].progress);
    }

    // Verify final progress
    const finalProgress = uploadProgress[uploadProgress.length - 1];
    expect(finalProgress.progress).toBe(100);
  });

  test('should track video processing status updates', async () => {
    // Submit video for processing
    const videoId = 'test-processing-001';
    await wsClient.subscribe('processing-status', { videoId });

    const processingUpdates: any[] = [];
    wsClient.on('processing-status', (data) => {
      processingUpdates.push(data);
    });

    // Trigger processing
    await page.goto(`/en/videos/${videoId}/process`);
    await page.click('[data-testid="start-processing"]');

    // Wait for processing updates
    await waitFor(() => {
      const latest = processingUpdates[processingUpdates.length - 1];
      return latest && ['completed', 'failed'].includes(latest.status);
    }, 60000); // 1 minute timeout

    // Verify processing stages
    const statuses = processingUpdates.map(u => u.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('processing');

    const finalStatus = processingUpdates[processingUpdates.length - 1].status;
    expect(['completed', 'failed']).toContain(finalStatus);
  });

  test('should handle progress update failures gracefully', async () => {
    // Simulate network issues
    await page.route('**/ws/**', route => route.abort());

    // Attempt to subscribe to progress updates
    const subscribePromise = wsClient.subscribe('video-progress', { videoId: 'test-video-002' });

    // Verify error handling
    await expect(subscribePromise).rejects.toThrow();

    // Restore connection and retry
    await page.unroute('**/ws/**');
    await wsClient.reconnect();

    // Verify successful reconnection
    await expect(wsClient.subscribe('video-progress', { videoId: 'test-video-002' }))
      .resolves.not.toThrow();
  });

  test('should maintain progress update accuracy under high frequency', async () => {
    // Subscribe to high-frequency updates
    await wsClient.subscribe('video-progress', { videoId: 'test-video-003' });

    const highFreqUpdates: any[] = [];
    wsClient.on('video-progress', (data) => {
      highFreqUpdates.push({ ...data, receivedAt: Date.now() });
    });

    // Simulate rapid progress changes
    await page.evaluate(() => {
      // Simulate rapid video progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 0.05;
        if (progress >= 1) {
          clearInterval(interval);
          return;
        }
        
        // Send progress update
        window.wsClient.send('video-progress', {
          videoId: 'test-video-003',
          progress,
          timestamp: Date.now()
        });
      }, 100); // Every 100ms
    });

    // Wait for updates
    await page.waitForTimeout(3000);

    // Verify update frequency and accuracy
    expect(highFreqUpdates.length).toBeGreaterThan(20);

    // Check for duplicate timestamps
    const timestamps = highFreqUpdates.map(u => u.timestamp);
    const uniqueTimestamps = new Set(timestamps);
    expect(uniqueTimestamps.size).toBe(timestamps.length);

    // Verify progress monotonicity
    for (let i = 1; i < highFreqUpdates.length; i++) {
      expect(highFreqUpdates[i].progress).toBeGreaterThanOrEqual(
        highFreqUpdates[i - 1].progress
      );
    }
  });
});

// Helper function for waiting with timeout
async function waitFor(condition: () => boolean, timeout: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
```

## Performance Metrics

### Latency Requirements
- **Progress Update Latency**: < 100ms
- **Cross-Client Sync**: < 500ms
- **Upload Progress**: < 200ms
- **Processing Status**: < 1s

### Throughput Requirements
- **Concurrent Updates**: 1000+ clients
- **Update Frequency**: 10 updates/second per client
- **Message Size**: < 1KB per update

## Error Handling

### Expected Error Scenarios
1. **Network Disconnection**
   - Automatic reconnection
   - Progress state recovery
   - Update buffering during offline

2. **Invalid Progress Data**
   - Data validation
   - Error notifications
   - Fallback to last known good state

3. **Subscription Failures**
   - Retry mechanisms
   - Alternative subscription methods
   - User notification

### Recovery Procedures
```typescript
// Connection recovery
wsClient.on('disconnect', async () => {
  await wsClient.reconnect();
  
  // Resubscribe to all channels
  await wsClient.resubscribeAll();
  
  // Request current progress state
  await wsClient.requestSyncState();
});
```

## Cross-Browser Testing Matrix

| Browser | Version | Progress Sync | Upload Updates | Processing Status |
|---------|---------|---------------|----------------|-------------------|
| Chrome | 120+ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ |

## Mobile Testing

### Device Support
- **iOS**: Safari 17+, Chrome 120+
- **Android**: Chrome 120+, Firefox 119+

### Network Conditions
- **4G**: Full functionality
- **3G**: Reduced update frequency
- **2G**: Essential updates only
- **Offline**: Queue updates, sync on reconnect

## Accessibility Testing

### Screen Reader Support
- Progress announcements
- Status change notifications
- Error message reading

### Keyboard Navigation
- Progress monitoring shortcuts
- Status checking commands
- Error acknowledgment

## RTL Testing

### Arabic Language Support
- RTL progress indicators
- Arabic error messages
- Right-aligned status displays

## Test Execution

### Prerequisites
```bash
# Install dependencies
pnpm install

# Setup test environment
pnpm test:setup

# Start WebSocket server
pnpm websocket:dev
```

### Running Tests
```bash
# Run all realtime progress tests
pnpm test:e2e --grep "TC-REAL-002"

# Run specific scenario
pnpm test:e2e --grep "should synchronize video watch progress"

# Run with performance monitoring
pnpm test:e2e --grep "TC-REAL-002" --reporter=html
```

### Cleanup
```bash
# Cleanup test data
pnpm test:cleanup

# Close WebSocket connections
pnpm test:teardown
```

## Validation Criteria

### Success Criteria
- ✅ Progress updates received within latency thresholds
- ✅ Cross-client synchronization working correctly
- ✅ Upload progress accurately tracked
- ✅ Processing status updates timely
- ✅ Error handling graceful
- ✅ Performance within acceptable limits

### Failure Criteria
- ❌ Progress updates delayed beyond thresholds
- ❌ Cross-client sync failures
- ❌ Upload progress inaccurate
- ❌ Processing status missing
- ❌ Connection recovery failures
- ❌ Performance degradation

## Test Reports

### Automated Reports
- Progress update latency metrics
- Synchronization accuracy
- Error rate statistics
- Performance benchmarks

### Manual Validation
- Visual progress verification
- User experience assessment
- Cross-device testing results

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-003](./TCREAL003_live-chat-functionality.md) - Live Chat Functionality
- [TC-VID-003](../video-platform/TCVID003_VideoProgressTracking.md) - Video Progress Tracking

## Document Information

- **Created**: 2025-11-18
- **Last Updated**: 2025-11-18
- **Version**: 1.0
- **Review Date**: 2025-11-25
- **Next Review**: 2025-12-25

---

**Test Team**: test-team@alummahnow.net  
**QA Lead**: qa-lead@alummahnow.net  
**DevOps**: devops@alummahnow.net