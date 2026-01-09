# TC-REAL-007: Connection Recovery Handling

## Test Case Information

- **Test ID**: TC-REAL-007
- **Title**: Connection Recovery Handling
- **Priority**: Critical
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that WebSocket connections can recover gracefully from network interruptions, server restarts, and other connectivity issues with proper state synchronization and message buffering.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Connection recovery mechanisms implemented
- Message buffering system
- State synchronization logic
- Test network simulation tools

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: Variable conditions (WiFi, 4G, 3G, offline)
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface ConnectionState {
  isConnected: boolean;
  lastConnected: number;
  reconnectAttempts: number;
  bufferedMessages: any[];
  missedEvents: any[];
}

interface RecoveryTest {
  scenario: string;
  disconnectionDuration: number;
  expectedBehavior: string;
  messageLossThreshold: number;
}

const recoveryTests: RecoveryTest[] = [
  {
    scenario: 'brief_network_interruption',
    disconnectionDuration: 5000, // 5 seconds
    expectedBehavior: 'automatic_reconnection',
    messageLossThreshold: 0
  },
  {
    scenario: 'extended_network_outage',
    disconnectionDuration: 30000, // 30 seconds
    expectedBehavior: 'reconnection_with_buffer',
    messageLossThreshold: 10
  },
  {
    scenario: 'server_restart',
    disconnectionDuration: 15000, // 15 seconds
    expectedBehavior: 'full_reconnection',
    messageLossThreshold: 5
  }
];
```

## Test Scenarios

### Scenario 1: Brief Network Interruption

**Test Steps:**

1. **Establish Stable Connection**
   ```typescript
   const client = await createWebSocketClient(authToken);
   await client.connect();
   
   // Verify connection
   expect(client.isConnected()).toBe(true);
   
   // Subscribe to test channel
   await client.subscribe('test-channel', { userId: 'test-user-001' });
   ```

2. **Simulate Brief Disconnection**
   ```typescript
   const messagesBefore: any[] = [];
   const messagesAfter: any[] = [];
   
   client.on('test-message', (message) => {
     if (client.isConnected()) {
       messagesAfter.push(message);
     } else {
       messagesBefore.push(message);
     }
   });
   
   // Simulate network interruption
   await client.simulateNetworkDisconnection(5000); // 5 seconds
   
   // Send messages during disconnection
   await sendTestMessages(10);
   
   // Wait for reconnection
   await waitFor(() => client.isConnected(), 10000);
   ```

3. **Verify Recovery**
   ```typescript
   // Verify automatic reconnection
   expect(client.isConnected()).toBe(true);
   expect(client.getReconnectAttempts()).toBeGreaterThan(0);
   
   // Verify message delivery
   expect(messagesAfter.length).toBeGreaterThanOrEqual(8); // Allow minimal loss
   expect(client.getBufferedMessages().length).toBe(0); // Should be delivered
   ```

### Scenario 2: Extended Network Outage

**Test Steps:**

1. **Setup Extended Outage Test**
   ```typescript
   const longRunningClient = await createWebSocketClient(authToken);
   await longRunningClient.connect();
   await longRunningClient.subscribe('long-running-test');
   
   const stateSnapshot = await longRunningClient.getStateSnapshot();
   const outageMessages: any[] = [];
   ```

2. **Simulate Extended Outage**
   ```typescript
   // Start message generation
   const messageGenerator = setInterval(() => {
     sendTestMessage('long-running-test', `Message ${Date.now()}`);
   }, 1000);
   
   // Simulate extended outage
   await longRunningClient.simulateNetworkDisconnection(30000); // 30 seconds
   
   // Stop message generation
   clearInterval(messageGenerator);
   ```

3. **Verify Extended Recovery**
   ```typescript
   // Wait for reconnection
   await waitFor(() => longRunningClient.isConnected(), 45000);
   
   // Verify state synchronization
   const currentState = await longRunningClient.getStateSnapshot();
   expect(currentState.version).toBeGreaterThanOrEqual(stateSnapshot.version);
   
   // Verify buffered message delivery
   const bufferedMessages = longRunningClient.getBufferedMessages();
   expect(bufferedMessages.length).toBeGreaterThan(0);
   expect(bufferedMessages.length).toBeLessThanOrEqual(50); // Reasonable buffer limit
   ```

### Scenario 3: Server Restart Recovery

**Test Steps:**

1. **Setup Server Restart Test**
   ```typescript
   const serverRestartClient = await createWebSocketClient(authToken);
   await serverRestartClient.connect();
   
   // Establish multiple subscriptions
   await Promise.all([
     serverRestartClient.subscribe('channel-1'),
     serverRestartClient.subscribe('channel-2'),
     serverRestartClient.subscribe('channel-3')
   ]);
   
   const subscriptions = serverRestartClient.getActiveSubscriptions();
   expect(subscriptions.length).toBe(3);
   ```

2. **Simulate Server Restart**
   ```typescript
   // Trigger server restart
   await triggerServerRestart();
   
   // Monitor connection state
   const connectionStates: ConnectionState[] = [];
   const stateMonitor = setInterval(() => {
     connectionStates.push({
       isConnected: serverRestartClient.isConnected(),
       lastConnected: Date.now(),
       reconnectAttempts: serverRestartClient.getReconnectAttempts(),
       bufferedMessages: serverRestartClient.getBufferedMessages(),
       missedEvents: serverRestartClient.getMissedEvents()
     });
   }, 1000);
   
   // Wait for server to come back online
   await waitFor(() => serverRestartClient.isConnected(), 60000);
   clearInterval(stateMonitor);
   ```

3. **Verify Full Recovery**
   ```typescript
   // Verify all subscriptions restored
   const restoredSubscriptions = serverRestartClient.getActiveSubscriptions();
   expect(restoredSubscriptions.length).toBe(3);
   
   // Verify reconnection attempts
   const maxReconnectAttempts = Math.max(...connectionStates.map(s => s.reconnectAttempts));
   expect(maxReconnectAttempts).toBeGreaterThan(0);
   
   // Verify state consistency
   const finalState = await serverRestartClient.getStateSnapshot();
   expect(finalState.isHealthy).toBe(true);
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-007: Connection Recovery Handling', () => {
  let client: WebSocketClient;
  let page: Page;
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    const context = await browser.newContext();
    page = await context.newPage();
    
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'recovery@test.com');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.click('[data-testid="login-button"]');
    
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    client = new WebSocketClient(authToken!);
    await client.connect();
  });

  test.afterAll(async () => {
    await client.disconnect();
    await page.close();
  });

  test('should recover from brief network interruptions automatically', async () => {
    await client.subscribe('recovery-test', { userId: 'recovery@test.com' });

    const messagesBefore: any[] = [];
    const messagesAfter: any[] = [];

    client.on('recovery-test-message', (message) => {
      if (client.isConnected()) {
        messagesAfter.push(message);
      } else {
        messagesBefore.push(message);
      }
    });

    // Simulate brief network interruption
    await page.evaluate(() => {
      window.simulateNetworkDisconnection(5000); // 5 seconds
    });

    // Send test messages during interruption
    for (let i = 0; i < 10; i++) {
      await page.evaluate((messageNum) => {
        window.sendTestMessage('recovery-test', `Test message ${messageNum}`);
      }, i);
      await page.waitForTimeout(100);
    }

    // Wait for reconnection
    await page.waitForTimeout(10000);

    // Verify automatic reconnection
    expect(client.isConnected()).toBe(true);
    expect(client.getReconnectAttempts()).toBeGreaterThan(0);

    // Verify message recovery
    expect(messagesAfter.length).toBeGreaterThanOrEqual(8); // Allow minimal loss
    expect(client.getBufferedMessages().length).toBe(0); // Should be delivered
  });

  test('should handle extended network outages with message buffering', async () => {
    await client.subscribe('extended-test', { userId: 'recovery@test.com' });

    const stateBefore = await client.getStateSnapshot();

    // Start message generation
    await page.evaluate(() => {
      window.messageGenerator = setInterval(() => {
        window.sendTestMessage('extended-test', `Extended test ${Date.now()}`);
      }, 1000);
    });

    // Simulate extended outage
    await page.evaluate(() => {
      window.simulateNetworkDisconnection(30000); // 30 seconds
    });

    // Stop message generation
    await page.evaluate(() => {
      clearInterval(window.messageGenerator);
    });

    // Wait for reconnection
    await page.waitForTimeout(45000);

    // Verify reconnection
    expect(client.isConnected()).toBe(true);

    // Verify state synchronization
    const stateAfter = await client.getStateSnapshot();
    expect(stateAfter.version).toBeGreaterThanOrEqual(stateBefore.version);

    // Verify buffered messages
    const bufferedMessages = client.getBufferedMessages();
    expect(bufferedMessages.length).toBeGreaterThan(0);
    expect(bufferedMessages.length).toBeLessThanOrEqual(50); // Reasonable buffer limit
  });

  test('should recover from server restarts with full state restoration', async () => {
    // Establish multiple subscriptions
    await Promise.all([
      client.subscribe('restart-test-1'),
      client.subscribe('restart-test-2'),
      client.subscribe('restart-test-3')
    ]);

    const subscriptionsBefore = client.getActiveSubscriptions();
    expect(subscriptionsBefore.length).toBe(3);

    // Trigger server restart
    await page.evaluate(() => {
      window.triggerServerRestart();
    });

    // Monitor connection state during restart
    const connectionStates: any[] = [];
    const stateMonitor = setInterval(() => {
      connectionStates.push({
        isConnected: client.isConnected(),
        reconnectAttempts: client.getReconnectAttempts(),
        timestamp: Date.now()
      });
    }, 1000);

    // Wait for server recovery
    await page.waitForTimeout(60000);
    clearInterval(stateMonitor);

    // Verify full recovery
    expect(client.isConnected()).toBe(true);

    // Verify subscription restoration
    const subscriptionsAfter = client.getActiveSubscriptions();
    expect(subscriptionsAfter.length).toBe(3);

    // Verify reconnection attempts occurred
    const maxReconnectAttempts = Math.max(...connectionStates.map(s => s.reconnectAttempts));
    expect(maxReconnectAttempts).toBeGreaterThan(0);

    // Verify state consistency
    const finalState = await client.getStateSnapshot();
    expect(finalState.isHealthy).toBe(true);
  });

  test('should handle connection recovery during active operations', async () => {
    // Start active operations
    await client.subscribe('active-ops-test');
    
    const operations: any[] = [];
    client.on('operation-complete', (op) => {
      operations.push(op);
    });

    // Start long-running operations
    await page.evaluate(() => {
      window.startLongRunningOperations();
    });

    // Wait for operations to start
    await page.waitForTimeout(2000);

    // Simulate disconnection during operations
    await page.evaluate(() => {
      window.simulateNetworkDisconnection(10000); // 10 seconds
    });

    // Wait for reconnection
    await page.waitForTimeout(15000);

    // Verify operation continuity
    expect(client.isConnected()).toBe(true);
    expect(operations.length).toBeGreaterThan(0);

    // Verify no operation corruption
    const corruptedOps = operations.filter(op => op.status === 'corrupted');
    expect(corruptedOps.length).toBe(0);
  });

  test('should maintain message ordering during recovery', async () => {
    await client.subscribe('ordering-test');

    const messages: any[] = [];
    client.on('ordering-test-message', (message) => {
      messages.push(message);
    });

    // Send sequential messages
    for (let i = 0; i < 20; i++) {
      await page.evaluate((seqNum) => {
        window.sendTestMessage('ordering-test', {
          sequence: seqNum,
          timestamp: Date.now()
        });
      }, i);
      
      // Simulate disconnection in the middle
      if (i === 10) {
        await page.evaluate(() => {
          window.simulateNetworkDisconnection(5000);
        });
      }
      
      await page.waitForTimeout(200);
    }

    // Wait for all messages to be delivered
    await page.waitForTimeout(10000);

    // Verify message ordering
    expect(messages.length).toBeGreaterThanOrEqual(18); // Allow minimal loss
    
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].sequence).toBeGreaterThan(messages[i - 1].sequence);
      expect(messages[i].timestamp).toBeGreaterThanOrEqual(messages[i - 1].timestamp);
    }
  });

  test('should handle multiple concurrent reconnection attempts', async () => {
    // Create multiple clients
    const clients: WebSocketClient[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext();
      const clientPage = await context.newPage();
      
      await clientPage.goto('/en/login');
      await clientPage.fill('[data-testid="email"]', `recovery${i}@test.com`);
      await clientPage.fill('[data-testid="password"]', 'testpass123');
      await clientPage.click('[data-testid="login-button"]');
      
      const authToken = await clientPage.evaluate(() => localStorage.getItem('authToken'));
      const wsClient = new WebSocketClient(authToken!);
      await wsClient.connect();
      
      clients.push(wsClient);
      pages.push(clientPage);
    }

    try {
      // Subscribe all clients
      await Promise.all(clients.map(client => 
        client.subscribe('concurrent-test')
      ));

      // Simulate network outage for all clients
      await Promise.all(pages.map(page => 
        page.evaluate(() => window.simulateNetworkDisconnection(8000))
      ));

      // Wait for reconnection
      await page.waitForTimeout(15000);

      // Verify all clients reconnected
      const reconnectedClients = clients.filter(client => client.isConnected());
      expect(reconnectedClients.length).toBe(clients.length);

      // Verify no connection conflicts
      const connectionErrors = clients.filter(client => client.hasConnectionErrors());
      expect(connectionErrors.length).toBe(0);

    } finally {
      // Cleanup
      for (const client of clients) {
        await client.disconnect();
      }
      for (const clientPage of pages) {
        await clientPage.close();
      }
    }
  });

  test('should provide recovery status and progress feedback', async () => {
    await client.subscribe('status-test');

    const recoveryEvents: any[] = [];
    client.on('recovery-status', (status) => {
      recoveryEvents.push(status);
    });

    // Simulate disconnection
    await page.evaluate(() => {
      window.simulateNetworkDisconnection(5000);
    });

    // Wait for recovery events
    await page.waitForTimeout(10000);

    // Verify recovery status events
    expect(recoveryEvents.length).toBeGreaterThan(0);

    const disconnectionEvent = recoveryEvents.find(e => e.status === 'disconnected');
    const reconnectingEvent = recoveryEvents.find(e => e.status === 'reconnecting');
    const reconnectedEvent = recoveryEvents.find(e => e.status === 'reconnected');

    expect(disconnectionEvent).toBeDefined();
    expect(reconnectingEvent).toBeDefined();
    expect(reconnectedEvent).toBeDefined();

    // Verify progress information
    expect(reconnectingEvent.attempt).toBeGreaterThan(0);
    expect(reconnectingEvent.maxAttempts).toBeGreaterThan(0);
    expect(reconnectedEvent.duration).toBeGreaterThan(0);
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
- **Reconnection Detection**: < 1s
- **Reconnection Time**: < 10s
- **State Sync**: < 5s
- **Buffer Delivery**: < 2s

### Throughput Requirements
- **Concurrent Recoveries**: 1000+
- **Buffer Size**: 1000 messages
- **Recovery Rate**: 100/second
- **State Sync Rate**: 500/second

## Error Handling

### Expected Error Scenarios
1. **Max Reconnect Attempts Exceeded**
   - Manual reconnection option
   - User notification
   - Fallback mechanisms

2. **State Corruption**
   - State reset
   - Full resynchronization
   - Error reporting

3. **Buffer Overflow**
   - Message prioritization
   - Buffer cleanup
   - Loss notification

## Cross-Browser Testing Matrix

| Browser | Version | Brief Recovery | Extended Recovery | Server Restart | Status Feedback |
|---------|---------|----------------|-------------------|----------------|-----------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Recovery
- Network switching
- App backgrounding
- Battery optimization
- Memory constraints

### Performance
- Battery usage
- Memory efficiency
- CPU usage
- Network optimization

## RTL Testing

### Arabic Recovery
- RTL error messages
- Arabic status indicators
- Right-aligned recovery UI
- Arabic notifications

## Test Execution

### Running Tests
```bash
# Run all recovery tests
pnpm test:e2e --grep "TC-REAL-007"

# Run specific scenarios
pnpm test:e2e --grep "should recover from brief network interruptions"
pnpm test:e2e --grep "should handle extended network outages"
```

## Validation Criteria

### Success Criteria
- ✅ Automatic reconnection working
- ✅ Message buffering functional
- ✅ State synchronization accurate
- ✅ Server recovery handled
- ✅ Progress feedback provided
- ✅ Performance within limits

### Failure Criteria
- ❌ Reconnection failures
- ❌ Message loss excessive
- ❌ State synchronization errors
- ❌ Server recovery failures
- ❌ No progress feedback
- ❌ Performance degradation

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-ERR-001](../error-handling/TCERR001_network-error-handling.md) - Network Error Handling
- [TC-PERF-007](../performance/tcperf007_network-performance-optimization.md) - Network Performance

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