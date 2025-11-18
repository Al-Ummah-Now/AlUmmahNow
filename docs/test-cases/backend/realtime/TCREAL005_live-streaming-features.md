# TC-REAL-005: Live Streaming Features

## Test Case Information

- **Test ID**: TC-REAL-005
- **Title**: Live Streaming Features
- **Priority**: High
- **Type**: Streaming
- **Category**: Realtime Features
- **Estimated Duration**: 25 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that live streaming features work correctly including real-time viewer counts, stream quality adaptation, chat integration, and stream status updates.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Live streaming service configured
- Test stream keys and broadcast software
- Multiple viewer accounts
- Stream moderation tools

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface LiveStream {
  id: string;
  title: string;
  description: string;
  streamerId: string;
  streamKey: string;
  status: 'starting' | 'live' | 'ending' | 'ended';
  viewerCount: number;
  startTime: number;
  quality: '240p' | '360p' | '480p' | '720p' | '1080p';
  category: string;
  tags: string[];
}

interface StreamViewer {
  userId: string;
  streamId: string;
  joinedAt: number;
  quality: string;
  isChatEnabled: boolean;
}

const testStreams: LiveStream[] = [
  {
    id: 'stream-001',
    title: 'Test Live Stream 1',
    description: 'Testing live streaming functionality',
    streamerId: 'streamer-001',
    streamKey: 'test-stream-key-001',
    status: 'live',
    viewerCount: 0,
    startTime: Date.now(),
    quality: '720p',
    category: 'Education',
    tags: ['test', 'streaming']
  }
];
```

## Test Scenarios

### Scenario 1: Stream Start and Viewer Join

**Test Steps:**

1. **Start Live Stream**
   ```typescript
   const streamerClient = await createWebSocketClient(streamerToken);
   await streamerClient.authenticateStream('test-stream-key-001');
   
   // Start stream
   const stream = await streamerClient.startStream({
     title: 'Test Live Stream',
     description: 'Testing live streaming',
     category: 'Education'
   });
   
   expect(stream.status).toBe('starting');
   ```

2. **Viewers Join Stream**
   ```typescript
   const viewers: WebSocketClient[] = [];
   
   for (let i = 0; i < 5; i++) {
     const viewerClient = await createWebSocketClient(viewerTokens[i]);
     await viewerClient.joinStream(stream.id);
     viewers.push(viewerClient);
   }
   
   // Wait for viewer count updates
   await waitFor(async () => {
     const streamStatus = await streamerClient.getStreamStatus(stream.id);
     return streamStatus.viewerCount === 5;
   }, 5000);
   ```

3. **Verify Real-time Updates**
   ```typescript
   const viewerUpdates: any[] = [];
   viewers.forEach(viewer => {
     viewer.on('viewer-count-update', (update) => {
       viewerUpdates.push(update);
     });
   });
   
   // Add another viewer
   const newViewer = await createWebSocketClient(viewerTokens[5]);
   await newViewer.joinStream(stream.id);
   
   // Verify count updates
   await waitFor(() => viewerUpdates.length >= 5, 3000);
   viewerUpdates.forEach(update => {
     expect(update.viewerCount).toBeGreaterThan(0);
   });
   ```

### Scenario 2: Stream Quality Adaptation

**Test Steps:**

1. **Monitor Quality Changes**
   ```typescript
   const qualityUpdates: any[] = [];
   
   viewers.forEach(viewer => {
     viewer.on('quality-change', (update) => {
       qualityUpdates.push(update);
     });
   });
   ```

2. **Simulate Network Conditions**
   ```typescript
   // Simulate poor network for one viewer
   await viewers[0].simulateNetworkCondition('3g');
   
   // Wait for quality adaptation
   await waitFor(() => {
     const viewerQuality = qualityUpdates.filter(u => u.viewerId === viewers[0].userId);
     return viewerQuality.length > 0;
   }, 10000);
   
   // Verify quality downgrade
   const qualityChange = qualityUpdates.find(u => u.viewerId === viewers[0].userId);
   expect(qualityChange.newQuality).toBeLessThan(qualityChange.oldQuality);
   ```

3. **Recovery to High Quality**
   ```typescript
   // Restore network conditions
   await viewers[0].simulateNetworkCondition('wifi');
   
   // Wait for quality upgrade
   await waitFor(() => {
     const viewerQuality = qualityUpdates.filter(u => 
       u.viewerId === viewers[0].userId && 
       u.newQuality > u.oldQuality
     );
     return viewerQuality.length > 0;
   }, 10000);
   ```

### Scenario 3: Live Chat Integration

**Test Steps:**

1. **Enable Stream Chat**
   ```typescript
   await streamerClient.enableStreamChat(stream.id, true);
   
   const chatMessages: any[] = [];
   viewers.forEach(viewer => {
     viewer.on('stream-chat-message', (message) => {
       chatMessages.push(message);
     });
   });
   ```

2. **Send Chat Messages**
   ```typescript
   await viewers[0].sendStreamChatMessage(stream.id, 'Hello from viewer 1!');
   await viewers[1].sendStreamChatMessage(stream.id, 'Great stream!');
   
   // Wait for message delivery
   await waitFor(() => chatMessages.length >= 8, 3000); // 2 messages × 4 viewers (excluding sender)
   
   // Verify message content
   const helloMessage = chatMessages.find(m => m.content === 'Hello from viewer 1!');
   const greatMessage = chatMessages.find(m => m.content === 'Great stream!');
   
   expect(helloMessage).toBeDefined();
   expect(greatMessage).toBeDefined();
   ```

### Scenario 4: Stream Status Updates

**Test Steps:**

1. **Monitor Status Changes**
   ```typescript
   const statusUpdates: any[] = [];
   viewers.forEach(viewer => {
     viewer.on('stream-status-update', (update) => {
       statusUpdates.push(update);
     });
   });
   ```

2. **End Stream**
   ```typescript
   await streamerClient.endStream(stream.id);
   
   // Wait for status updates
   await waitFor(() => {
     const endingUpdates = statusUpdates.filter(u => u.status === 'ending');
     return endingUpdates.length >= viewers.length;
   }, 5000);
   
   // Verify final status
   await waitFor(() => {
     const endedUpdates = statusUpdates.filter(u => u.status === 'ended');
     return endedUpdates.length >= viewers.length;
   }, 5000);
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-005: Live Streaming Features', () => {
  let streamerClient: WebSocketClient;
  let viewerClients: WebSocketClient[] = [];
  let pages: Page[] = [];
  let browser: Browser;
  let streamId: string;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    // Setup streamer
    const streamerContext = await browser.newContext();
    const streamerPage = await streamerContext.newPage();
    
    await streamerPage.goto('/en/login');
    await streamerPage.fill('[data-testid="email"]', 'streamer@test.com');
    await streamerPage.fill('[data-testid="password"]', 'testpass123');
    await streamerPage.click('[data-testid="login-button"]');
    
    const streamerToken = await streamerPage.evaluate(() => localStorage.getItem('authToken'));
    streamerClient = new WebSocketClient(streamerToken!);
    await streamerClient.connect();
    
    pages.push(streamerPage);
    
    // Setup viewers
    for (let i = 0; i < 5; i++) {
      const viewerContext = await browser.newContext();
      const viewerPage = await viewerContext.newPage();
      
      await viewerPage.goto('/en/login');
      await viewerPage.fill('[data-testid="email"]', `viewer${i + 1}@test.com`);
      await viewerPage.fill('[data-testid="password"]', 'testpass123');
      await viewerPage.click('[data-testid="login-button"]');
      
      const viewerToken = await viewerPage.evaluate(() => localStorage.getItem('authToken'));
      const viewerClient = new WebSocketClient(viewerToken!);
      await viewerClient.connect();
      
      viewerClients.push(viewerClient);
      pages.push(viewerPage);
    }
  });

  test.afterAll(async () => {
    await streamerClient.disconnect();
    for (const client of viewerClients) {
      await client.disconnect();
    }
    for (const page of pages) {
      await page.close();
    }
  });

  test('should start stream and update viewer count in real-time', async () => {
    const [streamerPage] = pages;
    
    // Start live stream
    await streamerPage.goto('/en/studio');
    await streamerPage.fill('[data-testid="stream-title"]', 'Test Live Stream');
    await streamerPage.fill('[data-testid="stream-description"]', 'Testing live streaming functionality');
    await streamerPage.selectOption('[data-testid="stream-category"]', 'Education');
    await streamerPage.click('[data-testid="start-stream"]');

    // Wait for stream to start
    await streamerPage.waitForSelector('[data-testid="stream-status-live"]', { timeout: 10000 });
    streamId = await streamerPage.getAttribute('[data-testid="stream-id"]', 'data-stream-id');

    // Viewers join stream
    const viewerUpdates: any[] = [];
    
    viewerClients.forEach((client, index) => {
      client.on('viewer-count-update', (update) => {
        viewerUpdates.push({ ...update, viewerIndex: index });
      });
    });

    // Join stream with viewers
    for (let i = 0; i < viewerClients.length; i++) {
      await pages[i + 1].goto(`/en/live/${streamId}`);
      await pages[i + 1].waitForSelector('[data-testid="live-player"]', { timeout: 10000 });
    }

    // Wait for viewer count updates
    await streamerPage.waitForTimeout(5000);

    // Verify viewer count
    const viewerCountElement = await streamerPage.textContent('[data-testid="viewer-count"]');
    expect(parseInt(viewerCountElement || '0')).toBe(viewerClients.length);

    // Verify real-time updates
    expect(viewerUpdates.length).toBeGreaterThan(0);
    viewerUpdates.forEach(update => {
      expect(update.viewerCount).toBeGreaterThan(0);
    });
  });

  test('should adapt stream quality based on network conditions', async () => {
    const [streamerPage, ...viewerPages] = pages;
    
    const qualityUpdates: any[] = [];
    
    viewerClients.forEach((client, index) => {
      client.on('quality-change', (update) => {
        qualityUpdates.push({ ...update, viewerIndex: index });
      });
    });

    // Simulate poor network for first viewer
    await viewerPages[0].evaluate(() => {
      // Simulate network throttling
      (window as any).networkThrottle = '3g';
    });

    // Wait for quality adaptation
    await viewerPages[0].waitForTimeout(10000);

    // Verify quality change for throttled viewer
    const throttledViewerUpdates = qualityUpdates.filter(u => u.viewerIndex === 0);
    expect(throttledViewerUpdates.length).toBeGreaterThan(0);
    
    const qualityChange = throttledViewerUpdates[0];
    expect(parseInt(qualityChange.newQuality)).toBeLessThanOrEqual(parseInt(qualityChange.oldQuality));

    // Restore network and verify quality recovery
    await viewerPages[0].evaluate(() => {
      (window as any).networkThrottle = 'wifi';
    });

    await viewerPages[0].waitForTimeout(10000);

    const recoveryUpdates = qualityUpdates.filter(u => 
      u.viewerIndex === 0 && 
      parseInt(u.newQuality) > parseInt(u.oldQuality)
    );
    expect(recoveryUpdates.length).toBeGreaterThan(0);
  });

  test('should integrate live chat with streaming', async () => {
    const [streamerPage, ...viewerPages] = pages;
    
    // Enable stream chat
    await streamerPage.click('[data-testid="enable-chat"]');

    const chatMessages: any[] = [];
    
    viewerClients.forEach((client, index) => {
      client.on('stream-chat-message', (message) => {
        chatMessages.push({ ...message, viewerIndex: index });
      });
    });

    // Send chat messages from viewers
    await viewerPages[0].fill('[data-testid="chat-input"]', 'Hello from viewer 1!');
    await viewerPages[0].click('[data-testid="send-chat"]');

    await viewerPages[1].fill('[data-testid="chat-input"]', 'Great stream!');
    await viewerPages[1].click('[data-testid="send-chat"]');

    // Wait for message delivery
    await streamerPage.waitForTimeout(3000);

    // Verify messages received
    const helloMessages = chatMessages.filter(m => m.content === 'Hello from viewer 1!');
    const greatMessages = chatMessages.filter(m => m.content === 'Great stream!');

    expect(helloMessages.length).toBeGreaterThan(0);
    expect(greatMessages.length).toBeGreaterThan(0);

    // Verify messages appear in streamer chat
    await streamerPage.waitForSelector('[data-testid="chat-message"]');
    const chatContent = await streamerPage.textContent('[data-testid="chat-messages"]');
    expect(chatContent).toContain('Hello from viewer 1!');
    expect(chatContent).toContain('Great stream!');
  });

  test('should handle stream status updates in real-time', async () => {
    const [streamerPage, ...viewerPages] = pages;
    
    const statusUpdates: any[] = [];
    
    viewerClients.forEach((client, index) => {
      client.on('stream-status-update', (update) => {
        statusUpdates.push({ ...update, viewerIndex: index });
      });
    });

    // End stream
    await streamerPage.click('[data-testid="end-stream"]');
    await streamerPage.click('[data-testid="confirm-end-stream"]');

    // Wait for status updates
    await streamerPage.waitForTimeout(5000);

    // Verify ending status
    const endingUpdates = statusUpdates.filter(u => u.status === 'ending');
    expect(endingUpdates.length).toBe(viewerClients.length);

    // Wait for ended status
    await streamerPage.waitForTimeout(5000);

    // Verify ended status
    const endedUpdates = statusUpdates.filter(u => u.status === 'ended');
    expect(endedUpdates.length).toBe(viewerClients.length);

    // Verify viewers are redirected
    for (const viewerPage of viewerPages) {
      const currentUrl = viewerPage.url();
      expect(currentUrl).toContain('/ended');
    }
  });

  test('should handle high viewer count without performance degradation', async () => {
    const [streamerPage] = pages;
    
    // Start new stream for load testing
    await streamerPage.goto('/en/studio');
    await streamerPage.fill('[data-testid="stream-title"]', 'Load Test Stream');
    await streamerPage.click('[data-testid="start-stream"]');
    
    await streamerPage.waitForSelector('[data-testid="stream-status-live"]');
    const loadTestStreamId = await streamerPage.getAttribute('[data-testid="stream-id"]', 'data-stream-id');

    // Simulate high viewer count
    const startTime = Date.now();
    const simulatedViewers = 100;

    for (let i = 0; i < simulatedViewers; i++) {
      await streamerPage.evaluate((streamId, viewerNum) => {
        // Simulate viewer joining
        window.simulateViewerJoin(streamId, viewerNum);
      }, loadTestStreamId, i);
    }

    // Wait for all viewers to be processed
    await streamerPage.waitForTimeout(10000);

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    // Verify performance
    expect(processingTime).toBeLessThan(15000); // Should process within 15 seconds

    // Verify viewer count accuracy
    const viewerCount = await streamerPage.textContent('[data-testid="viewer-count"]');
    expect(parseInt(viewerCount || '0')).toBeGreaterThanOrEqual(simulatedViewers * 0.95);
  });

  test('should provide stream analytics in real-time', async () => {
    const [streamerPage] = pages;
    
    // Start stream with analytics
    await streamerPage.goto('/en/studio');
    await streamerPage.fill('[data-testid="stream-title"]', 'Analytics Test Stream');
    await streamerPage.click('[data-testid="start-stream"]');
    
    await streamerPage.waitForSelector('[data-testid="stream-status-live"]');
    const analyticsStreamId = await streamerPage.getAttribute('[data-testid="stream-id"]', 'data-stream-id');

    // Monitor analytics updates
    const analyticsUpdates: any[] = [];
    streamerClient.on('stream-analytics', (update) => {
      analyticsUpdates.push(update);
    });

    // Simulate viewer interactions
    await streamerPage.evaluate((streamId) => {
      // Simulate various viewer actions
      window.simulateViewerActions(streamId, {
        joins: 10,
        leaves: 2,
        chatMessages: 15,
        reactions: 25
      });
    }, analyticsStreamId);

    // Wait for analytics updates
    await streamerPage.waitForTimeout(5000);

    // Verify analytics data
    expect(analyticsUpdates.length).toBeGreaterThan(0);
    
    const latestAnalytics = analyticsUpdates[analyticsUpdates.length - 1];
    expect(latestAnalytics.totalViewers).toBeGreaterThan(0);
    expect(latestAnalytics.currentViewers).toBeGreaterThanOrEqual(0);
    expect(latestAnalytics.chatMessages).toBeGreaterThan(0);
    expect(latestAnalytics.reactions).toBeGreaterThan(0);

    // Verify analytics display
    await streamerPage.click('[data-testid="show-analytics"]');
    await streamerPage.waitForSelector('[data-testid="analytics-panel"]');

    const displayedViewers = await streamerPage.textContent('[data-testid="analytics-viewers"]');
    const displayedMessages = await streamerPage.textContent('[data-testid="analytics-messages"]');
    
    expect(displayedViewers).toContain(latestAnalytics.currentViewers.toString());
    expect(displayedMessages).toContain(latestAnalytics.chatMessages.toString());
  });
});

async function waitFor(condition: () => boolean | Promise<boolean>, timeout: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
```

## Performance Metrics

### Latency Requirements
- **Stream Start**: < 3s
- **Viewer Join**: < 1s
- **Quality Switch**: < 2s
- **Chat Message**: < 100ms
- **Status Updates**: < 500ms

### Throughput Requirements
- **Concurrent Viewers**: 10,000+ per stream
- **Chat Messages**: 1,000/minute
- **Quality Switches**: 100/second
- **Simultaneous Streams**: 100+

## Error Handling

### Expected Error Scenarios
1. **Stream Key Invalid**
   - Authentication failure
   - Error notification
   - Retry mechanism

2. **Network Interruption**
   - Automatic reconnection
   - Quality adaptation
   - Buffer management

3. **Server Overload**
   - Queue management
   - Load balancing
   - User notifications

## Cross-Browser Testing Matrix

| Browser | Version | Stream Start | Quality Adaptation | Chat Integration | Analytics |
|---------|---------|--------------|-------------------|------------------|-----------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Streaming
- Adaptive bitrate
- Touch controls
- Orientation handling
- Battery optimization

### Performance
- Memory usage
- CPU utilization
- Network efficiency
- Heat management

## RTL Testing

### Arabic Streaming
- RTL chat interface
- Arabic stream titles
- Right-aligned controls
- Arabic analytics

## Test Execution

### Running Tests
```bash
# Run all live streaming tests
pnpm test:e2e --grep "TC-REAL-005"

# Run specific scenarios
pnpm test:e2e --grep "should start stream and update viewer count"
pnpm test:e2e --grep "should adapt stream quality"
```

## Validation Criteria

### Success Criteria
- ✅ Stream starts successfully
- ✅ Viewer counts accurate
- ✅ Quality adaptation working
- ✅ Chat integration functional
- ✅ Status updates real-time
- ✅ Performance within limits

### Failure Criteria
- ❌ Stream start failures
- ❌ Viewer count inaccuracies
- ❌ Quality adaptation failures
- ❌ Chat integration issues
- ❌ Status update delays
- ❌ Performance degradation

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-003](./TCREAL003_live-chat-functionality.md) - Live Chat Functionality
- [TC-VID-002](../video-platform/TCVID002_VideoQualitySelection.md) - Video Quality Selection

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