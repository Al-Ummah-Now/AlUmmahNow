# TC-REAL-010: Real-time Error Handling

## Test Case Information

- **Test ID**: TC-REAL-010
- **Title**: Real-time Error Handling
- **Priority**: High
- **Type**: Error
- **Category**: Realtime Features
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that real-time features handle errors gracefully including connection failures, message delivery failures, data corruption, and system overload with proper user notification and recovery mechanisms.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Error handling and recovery systems
- Monitoring and alerting mechanisms
- Test error simulation tools
- Error reporting and logging

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: Variable conditions (WiFi, 4G, 3G, offline)
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface RealtimeError {
  id: string;
  type: 'connection' | 'message' | 'data' | 'system' | 'timeout';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  code: string;
  timestamp: number;
  userId?: string;
  sessionId?: string;
  context: any;
  recovery: {
    attempted: boolean;
    successful: boolean;
    strategy: string;
    duration: number;
  };
}

interface ErrorScenario {
  name: string;
  description: string;
  errorType: string;
  expectedBehavior: string;
  userNotification: boolean;
  autoRecovery: boolean;
}

const errorScenarios: ErrorScenario[] = [
  {
    name: 'websocket_connection_timeout',
    description: 'WebSocket connection times out',
    errorType: 'connection',
    expectedBehavior: 'automatic_reconnection',
    userNotification: true,
    autoRecovery: true
  },
  {
    name: 'message_delivery_failure',
    description: 'Message fails to deliver',
    errorType: 'message',
    expectedBehavior: 'retry_with_backoff',
    userNotification: false,
    autoRecovery: true
  },
  {
    name: 'data_corruption_detected',
    description: 'Corrupted data received',
    errorType: 'data',
    expectedBehavior: 'data_validation_and_recovery',
    userNotification: true,
    autoRecovery: true
  }
];
```

## Test Scenarios

### Scenario 1: Connection Error Handling

**Test Steps:**

1. **Setup Connection Monitoring**
   ```typescript
   const client = await createWebSocketClient(authToken);
   await client.connect();
   
   const connectionErrors: RealtimeError[] = [];
   const recoveryEvents: any[] = [];
   
   client.on('connection-error', (error) => {
     connectionErrors.push(error);
   });
   
   client.on('recovery-attempt', (event) => {
     recoveryEvents.push(event);
   });
   ```

2. **Simulate Connection Failures**
   ```typescript
   // Simulate various connection failures
   const connectionFailures = [
     { type: 'timeout', duration: 5000 },
     { type: 'server_unavailable', duration: 10000 },
     { type: 'network_partition', duration: 15000 }
   ];
   
   for (const failure of connectionFailures) {
     await client.simulateConnectionFailure(failure);
     
     // Wait for error handling
     await waitFor(() => connectionErrors.length > 0, 3000);
     
     // Verify error handling
     const latestError = connectionErrors[connectionErrors.length - 1];
     expect(latestError.type).toBe('connection');
     expect(latestError.severity).toBeDefined();
     expect(latestError.code).toBeDefined();
     
     // Wait for recovery attempt
     await waitFor(() => recoveryEvents.length > 0, 10000);
     
     // Verify recovery
     const recovery = recoveryEvents[recoveryEvents.length - 1];
     expect(recovery.strategy).toBeDefined();
     expect(recovery.attempted).toBe(true);
   }
   ```

3. **Verify Recovery Success**
   ```typescript
   // Verify final connection state
   await waitFor(() => client.isConnected(), 30000);
   expect(client.isConnected()).toBe(true);
   
   // Verify error metrics
   const errorMetrics = client.getErrorMetrics();
   expect(errorMetrics.totalErrors).toBeGreaterThan(0);
   expect(errorMetrics.recoveredErrors).toBeGreaterThan(0);
   expect(errorMetrics.recoveryRate).toBeGreaterThan(0.8); // 80% recovery rate
   ```

### Scenario 2: Message Delivery Error Handling

**Test Steps:**

1. **Setup Message Error Monitoring**
   ```typescript
   const messageClient = await createWebSocketClient(authToken);
   await messageClient.connect();
   await messageClient.subscribe('error-test-channel');
   
   const messageErrors: RealtimeError[] = [];
   const deliveryFailures: any[] = [];
   
   messageClient.on('message-error', (error) => {
     messageErrors.push(error);
   });
   
   messageClient.on('delivery-failure', (failure) => {
     deliveryFailures.push(failure);
   });
   ```

2. **Simulate Message Failures**
   ```typescript
   // Simulate various message failures
   const messageFailures = [
     { type: 'oversized_message', size: 1024 * 1024 * 2 }, // 2MB
     { type: 'invalid_format', data: { invalid: 'structure' } },
     { type: 'rate_limited', count: 100 },
     { type: 'target_unavailable', target: 'nonexistent-channel' }
   ];
   
   for (const failure of messageFailures) {
     try {
       await messageClient.sendMessage('error-test-channel', {
         type: failure.type,
         data: failure.data || 'test message',
         timestamp: Date.now()
       });
     } catch (error) {
       // Expected to fail
     }
     
     // Wait for error handling
     await waitFor(() => messageErrors.length > 0, 2000);
   }
   ```

3. **Verify Error Handling**
   ```typescript
   // Verify all errors were captured
   expect(messageErrors.length).toBe(messageFailures.length);
   
   // Verify error details
   messageErrors.forEach((error, index) => {
     expect(error.type).toBe('message');
     expect(error.severity).toBeDefined();
     expect(error.code).toBeDefined();
     expect(error.context).toBeDefined();
   });
   
   // Verify retry mechanisms
   const retryEvents = deliveryFailures.filter(f => f.retryAttempted);
   expect(retryEvents.length).toBeGreaterThan(0);
   
   // Verify backoff strategy
   const backoffEvents = retryEvents.filter(f => f.backoffApplied);
   expect(backoffEvents.length).toBeGreaterThan(0);
   ```

### Scenario 3: Data Corruption Handling

**Test Steps:**

1. **Setup Data Validation**
   ```typescript
   const dataClient = await createWebSocketClient(authToken);
   await dataClient.connect();
   await dataClient.subscribe('data-validation-test');
   
   const corruptionErrors: RealtimeError[] = [];
   const validationEvents: any[] = [];
   
   dataClient.on('data-corruption', (error) => {
     corruptionErrors.push(error);
   });
   
   dataClient.on('validation-event', (event) => {
     validationEvents.push(event);
   });
   ```

2. **Simulate Data Corruption**
   ```typescript
   // Simulate various data corruption scenarios
   const corruptionScenarios = [
     { type: 'malformed_json', data: '{"invalid": json}' },
     { type: 'missing_required_fields', data: { partial: 'data' } },
     { type: 'invalid_data_types', data: { number: 'not_a_number' } },
     { type: 'checksum_mismatch', data: { corrupted: true, checksum: 'invalid' } }
   ];
   
   for (const scenario of corruptionScenarios) {
     await dataClient.sendRawData('data-validation-test', scenario.data);
     
     // Wait for corruption detection
     await waitFor(() => corruptionErrors.length > 0, 2000);
   }
   ```

3. **Verify Data Recovery**
   ```typescript
   // Verify corruption detection
   expect(corruptionErrors.length).toBe(corruptionScenarios.length);
   
   corruptionErrors.forEach((error, index) => {
     expect(error.type).toBe('data');
     expect(error.severity).toBeOneOf(['medium', 'high']);
     expect(error.context.corruptionType).toBeDefined();
   });
   
   // Verify validation events
   expect(validationEvents.length).toBeGreaterThan(0);
   
   const validationResults = validationEvents.map(v => v.result);
   expect(validationResults.every(r => r === 'rejected' || r === 'corrected')).toBe(true);
   
   // Verify data integrity after recovery
   const finalDataState = await dataClient.getDataState();
   expect(finalDataState.isCorrupted).toBe(false);
   expect(finalDataState.lastValidated).toBeGreaterThan(0);
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-010: Real-time Error Handling', () => {
  let client: WebSocketClient;
  let page: Page;
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    const context = await browser.newContext();
    page = await context.newPage();
    
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'errorhandling@test.com');
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

  test('should handle WebSocket connection errors gracefully', async () => {
    await client.subscribe('connection-error-test');

    const connectionErrors: any[] = [];
    const recoveryEvents: any[] = [];

    client.on('connection-error', (error) => {
      connectionErrors.push(error);
    });

    client.on('recovery-attempt', (event) => {
      recoveryEvents.push(event);
    });

    // Simulate connection timeout
    await page.evaluate(() => {
      window.simulateConnectionFailure({
        type: 'timeout',
        duration: 5000
      });
    });

    // Wait for error handling
    await page.waitForTimeout(3000);

    // Verify error captured
    expect(connectionErrors.length).toBeGreaterThan(0);
    
    const timeoutError = connectionErrors.find(e => e.type === 'connection');
    expect(timeoutError).toBeDefined();
    expect(timeoutError.severity).toBeDefined();
    expect(timeoutError.code).toBeDefined();

    // Wait for recovery attempt
    await page.waitForTimeout(10000);

    // Verify recovery attempt
    expect(recoveryEvents.length).toBeGreaterThan(0);
    
    const recovery = recoveryEvents[recoveryEvents.length - 1];
    expect(recovery.strategy).toBeDefined();
    expect(recovery.attempted).toBe(true);

    // Verify final connection state
    const isConnected = await page.evaluate(() => window.wsClient?.isConnected());
    expect(isConnected).toBe(true);
  });

  test('should handle message delivery failures with retry logic', async () => {
    await client.subscribe('message-error-test');

    const messageErrors: any[] = [];
    const deliveryFailures: any[] = [];

    client.on('message-error', (error) => {
      messageErrors.push(error);
    });

    client.on('delivery-failure', (failure) => {
      deliveryFailures.push(failure);
    });

    // Simulate various message failures
    const messageFailures = [
      { type: 'oversized_message', data: 'x'.repeat(1024 * 1024 * 2) },
      { type: 'invalid_format', data: { invalid: 'structure' } },
      { type: 'rate_limited', data: 'spam message' }
    ];

    for (const failure of messageFailures) {
      try {
        await page.evaluate((failureData) => {
          window.wsClient.sendMessage('message-error-test', {
            type: failureData.type,
            data: failureData.data,
            timestamp: Date.now()
          });
        }, failure);
      } catch (error) {
        // Expected to fail
      }

      await page.waitForTimeout(1000);
    }

    // Verify error handling
    expect(messageErrors.length).toBe(messageFailures.length);

    messageErrors.forEach((error, index) => {
      expect(error.type).toBe('message');
      expect(error.severity).toBeDefined();
      expect(error.code).toBeDefined();
      expect(error.context).toBeDefined();
    });

    // Verify retry mechanisms
    const retryEvents = deliveryFailures.filter(f => f.retryAttempted);
    expect(retryEvents.length).toBeGreaterThan(0);

    // Verify backoff strategy
    const backoffEvents = retryEvents.filter(f => f.backoffApplied);
    expect(backoffEvents.length).toBeGreaterThan(0);
  });

  test('should detect and handle data corruption', async () => {
    await client.subscribe('data-corruption-test');

    const corruptionErrors: any[] = [];
    const validationEvents: any[] = [];

    client.on('data-corruption', (error) => {
      corruptionErrors.push(error);
    });

    client.on('validation-event', (event) => {
      validationEvents.push(event);
    });

    // Simulate data corruption scenarios
    const corruptionScenarios = [
      { type: 'malformed_json', data: '{"invalid": json}' },
      { type: 'missing_required_fields', data: { partial: 'data' } },
      { type: 'invalid_data_types', data: { number: 'not_a_number' } }
    ];

    for (const scenario of corruptionScenarios) {
      await page.evaluate((scenarioData) => {
        window.wsClient.sendRawData('data-corruption-test', scenarioData.data);
      }, scenario);

      await page.waitForTimeout(1000);
    }

    // Verify corruption detection
    expect(corruptionErrors.length).toBe(corruptionScenarios.length);

    corruptionErrors.forEach((error, index) => {
      expect(error.type).toBe('data');
      expect(error.severity).toBeOneOf(['medium', 'high']);
      expect(error.context.corruptionType).toBeDefined();
    });

    // Verify validation events
    expect(validationEvents.length).toBeGreaterThan(0);

    const validationResults = validationEvents.map(v => v.result);
    expect(validationResults.every(r => r === 'rejected' || r === 'corrected')).toBe(true);

    // Verify data integrity after recovery
    const dataState = await page.evaluate(() => window.wsClient.getDataState());
    expect(dataState.isCorrupted).toBe(false);
    expect(dataState.lastValidated).toBeGreaterThan(0);
  });

  test('should provide user-friendly error notifications', async () => {
    await client.subscribe('user-notification-test');

    const userNotifications: any[] = [];

    client.on('user-notification', (notification) => {
      userNotifications.push(notification);
    });

    // Trigger various errors that should notify users
    await page.evaluate(() => {
      // Trigger connection error
      window.simulateConnectionFailure({ type: 'server_unavailable', duration: 3000 });
      
      // Trigger message error
      window.wsClient.sendMessage('user-notification-test', { invalid: 'data' });
      
      // Trigger data error
      window.wsClient.sendRawData('user-notification-test', '{invalid json}');
    });

    // Wait for notifications
    await page.waitForTimeout(5000);

    // Verify user notifications
    expect(userNotifications.length).toBeGreaterThan(0);

    const notifications = userNotifications.filter(n => n.showToUser);
    expect(notifications.length).toBeGreaterThan(0);

    // Verify notification content
    notifications.forEach(notification => {
      expect(notification.message).toBeDefined();
      expect(notification.severity).toBeDefined();
      expect(notification.actions).toBeDefined();
    });

    // Verify notification display
    await page.waitForSelector('[data-testid="error-notification"]', { timeout: 10000 });
    
    const notificationElement = await page.$('[data-testid="error-notification"]');
    expect(notificationElement).toBeDefined();

    const notificationText = await notificationElement?.textContent();
    expect(notificationText).toBeDefined();
    expect(notificationText?.length).toBeGreaterThan(0);
  });

  test('should handle system overload gracefully', async () => {
    await client.subscribe('overload-test');

    const overloadEvents: any[] = [];
    const throttlingEvents: any[] = [];

    client.on('system-overload', (event) => {
      overloadEvents.push(event);
    });

    client.on('throttling-applied', (event) => {
      throttlingEvents.push(event);
    });

    // Simulate system overload
    await page.evaluate(() => {
      // Generate high load
      for (let i = 0; i < 1000; i++) {
        window.wsClient.sendMessage('overload-test', {
          id: i,
          data: `load test message ${i}`,
          timestamp: Date.now()
        });
      }
    });

    // Wait for overload detection
    await page.waitForTimeout(3000);

    // Verify overload detection
    expect(overloadEvents.length).toBeGreaterThan(0);

    const overloadEvent = overloadEvents[0];
    expect(overloadEvent.severity).toBeOneOf(['high', 'critical']);
    expect(overloadEvent.metrics).toBeDefined();
    expect(overloadEvent.mitigation).toBeDefined();

    // Verify throttling applied
    expect(throttlingEvents.length).toBeGreaterThan(0);

    const throttlingEvent = throttlingEvents[0];
    expect(throttlingEvent.strategy).toBeDefined();
    expect(throttlingEvent.limit).toBeDefined();
    expect(throttlingEvent.duration).toBeDefined();

    // Verify system recovery
    await page.waitForTimeout(10000);

    const systemStatus = await page.evaluate(() => window.wsClient.getSystemStatus());
    expect(systemStatus.isOverloaded).toBe(false);
    expect(systemStatus.performance).toBeGreaterThan(0.8); // 80% performance
  });

  test('should maintain error logs and metrics', async () => {
    await client.subscribe('logging-test');

    // Generate various errors
    await page.evaluate(() => {
      window.simulateConnectionFailure({ type: 'timeout', duration: 2000 });
      window.wsClient.sendMessage('logging-test', { invalid: 'data' });
      window.wsClient.sendRawData('logging-test', '{invalid json}');
    });

    // Wait for error processing
    await page.waitForTimeout(5000);

    // Verify error metrics
    const errorMetrics = await page.evaluate(() => window.wsClient.getErrorMetrics());
    
    expect(errorMetrics.totalErrors).toBeGreaterThan(0);
    expect(errorMetrics.errorsByType).toBeDefined();
    expect(errorMetrics.errorsBySeverity).toBeDefined();
    expect(errorMetrics.recoveryRate).toBeGreaterThan(0);
    expect(errorMetrics.averageRecoveryTime).toBeGreaterThan(0);

    // Verify error logs
    const errorLogs = await page.evaluate(() => window.wsClient.getErrorLogs());
    
    expect(errorLogs.length).toBeGreaterThan(0);
    
    errorLogs.forEach((log: any) => {
      expect(log.id).toBeDefined();
      expect(log.timestamp).toBeDefined();
      expect(log.type).toBeDefined();
      expect(log.severity).toBeDefined();
      expect(log.message).toBeDefined();
      expect(log.context).toBeDefined();
    });

    // Verify log persistence
    const persistedLogs = await page.evaluate(() => window.wsClient.getPersistedLogs());
    expect(persistedLogs.length).toBeGreaterThan(0);

    // Verify log export functionality
    const exportData = await page.evaluate(() => window.wsClient.exportErrorLogs());
    expect(exportData).toBeDefined();
    expect(exportData.format).toBeOneOf(['json', 'csv']);
    expect(exportData.data).toBeDefined();
  });

  test('should handle error recovery across multiple clients', async () => {
    // Create multiple clients
    const clients: WebSocketClient[] = [];
    const clientPages: Page[] = [];

    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext();
      const clientPage = await context.newPage();
      
      await clientPage.goto('/en/login');
      await clientPage.fill('[data-testid="email"]', `multiclient${i}@test.com`);
      await clientPage.fill('[data-testid="password"]', 'testpass123');
      await clientPage.click('[data-testid="login-button"]');
      
      const authToken = await clientPage.evaluate(() => localStorage.getItem('authToken'));
      const wsClient = new WebSocketClient(authToken!);
      await wsClient.connect();
      
      clients.push(wsClient);
      clientPages.push(clientPage);
    }

    try {
      // Subscribe all clients
      await Promise.all(clients.map(client => 
        client.subscribe('multi-client-error-test')
      ));

      const multiClientErrors: any[] = [];
      
      clients.forEach((client, index) => {
        client.on('connection-error', (error) => {
          multiClientErrors.push({ ...error, clientIndex: index });
        });
      });

      // Simulate server-wide issue
      await Promise.all(clientPages.map(page => 
        page.evaluate(() => {
          window.simulateServerIssue({
            type: 'overload',
            duration: 5000
          });
        })
      ));

      // Wait for error handling
      await page.waitForTimeout(8000);

      // Verify all clients detected errors
      expect(multiClientErrors.length).toBeGreaterThan(0);

      const affectedClients = new Set(multiClientErrors.map(e => e.clientIndex));
      expect(affectedClients.size).toBeGreaterThan(0);

      // Verify coordinated recovery
      const recoveryEvents = await Promise.all(
        clientPages.map(page => 
          page.evaluate(() => window.wsClient.getRecoveryEvents())
        )
      );

      recoveryEvents.forEach((events, index) => {
        if (events.length > 0) {
          expect(events[0].coordinated).toBe(true);
          expect(events[0].strategy).toBeDefined();
        }
      });

      // Verify final state consistency
      const finalStates = await Promise.all(
        clients.map(client => client.isConnected())
      );

      expect(finalStates.every(connected => connected)).toBe(true);

    } finally {
      // Cleanup
      for (const client of clients) {
        await client.disconnect();
      }
      for (const clientPage of clientPages) {
        await clientPage.close();
      }
    }
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
- **Error Detection**: < 100ms
- **Error Notification**: < 500ms
- **Recovery Initiation**: < 1s
- **Full Recovery**: < 10s

### Throughput Requirements
- **Error Events**: 1,000/second
- **Recovery Attempts**: 100/second
- **Notification Delivery**: 500/second
- **Log Processing**: 10,000/second

## Error Handling

### Expected Error Scenarios
1. **Connection Failures**
   - Automatic reconnection
   - Exponential backoff
   - User notification

2. **Message Failures**
   - Retry with backoff
   - Message queuing
   - Dead letter queue

3. **Data Corruption**
   - Data validation
   - Automatic correction
   - Fallback to last known good

## Cross-Browser Testing Matrix

| Browser | Version | Connection Errors | Message Errors | Data Corruption | User Notifications |
|---------|---------|------------------|---------------|-----------------|-------------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Error Handling
- Network error handling
- Background error recovery
- Mobile-specific notifications
- Touch-friendly error UI

### Performance
- Battery efficiency
- Memory usage
- Error processing overhead
- Network optimization

## RTL Testing

### Arabic Error Handling
- RTL error messages
- Arabic error notifications
- Right-aligned error UI
- Arabic error codes

## Test Execution

### Running Tests
```bash
# Run all error handling tests
pnpm test:e2e --grep "TC-REAL-010"

# Run specific scenarios
pnpm test:e2e --grep "should handle WebSocket connection errors"
pnpm test:e2e --grep "should detect and handle data corruption"
```

## Validation Criteria

### Success Criteria
- ✅ Connection errors handled
- ✅ Message failures recovered
- ✅ Data corruption detected
- ✅ User notifications working
- ✅ System overload managed
- ✅ Error logging functional

### Failure Criteria
- ❌ Connection handling failures
- ❌ Message recovery errors
- ❌ Data corruption missed
- ❌ No user notifications
- ❌ System overload crashes
- ❌ Error logging failures

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-007](./TCREAL007_connection-recovery-handling.md) - Connection Recovery Handling
- [TC-ERR-001](../error-handling/TCERR001_network-error-handling.md) - Network Error Handling

## Document Information

- **Created**: 2025-11-18
- **Last Updated**: 2025-11-18
**Version**: 1.0
- **Review Date**: 2025-11-25
- **Next Review**: 2025-12-25

---

**Test Team**: test-team@alummahnow.net  
**QA Lead**: qa-lead@alummahnow.net  
**DevOps**: devops@alummahnow.net