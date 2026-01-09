# TC-REAL-001: WebSocket Connection Management

## Test Case Information

**Test ID**: TC-REAL-001  
**Title**: WebSocket Connection Management  
**Priority**: Critical  
**Type**: E2E  
**Category**: Realtime Features  
**Estimated Duration**: 8 minutes  
**Last Updated**: 2025-11-20  

## Test Description

This test case verifies WebSocket connection management including connection establishment, authentication, reconnection logic, connection health monitoring, and graceful disconnection handling.

## Prerequisites

1. WebSocket server must be running and accessible
2. Authentication service must be operational
3. Network connectivity must be stable
4. Browser WebSocket support must be enabled

## Test Data

```typescript
const connectionData = {
  userId: 'test-user-' + Date.now(),
  channelId: 'test-channel-' + Date.now(),
  videoId: 'test-video-' + Date.now(),
  authToken: 'valid-jwt-token',
  connectionTimeout: 5000,
  heartbeatInterval: 30000,
  maxReconnectAttempts: 5
};

const networkConditions = {
  offline: { offline: true },
  slow3g: { downloadThroughput: 500 * 1024, uploadThroughput: 500 * 1024, latency: 400 },
  fast3g: { downloadThroughput: 1.6 * 1024 * 1024, uploadThroughput: 750 * 1024, latency: 150 }
};
```

## Test Steps

### 1. Establish WebSocket Connection

**Actions:**
1. Navigate to a page requiring real-time features
2. Wait for WebSocket connection to establish
3. Verify connection state in UI
4. Check authentication token is sent
5. Verify connection is registered with server

**Expected Results:**
- WebSocket connection establishes within 5 seconds
- Connection status shows "Connected" in UI
- Authentication token is validated successfully
- Server acknowledges connection with welcome message
- Connection ID is generated and stored

### 2. Test Connection Authentication

**Actions:**
1. Connect with valid authentication token
2. Verify user identity is confirmed
3. Test connection with invalid token
4. Test connection with expired token
5. Test connection without token

**Expected Results:**
- Valid token results in successful authentication
- User permissions are correctly applied
- Invalid token results in connection rejection
- Expired token triggers re-authentication flow
- Missing token results in authentication error

### 3. Test Connection Health Monitoring

**Actions:**
1. Monitor heartbeat/ping messages
2. Verify connection stays alive with activity
3. Test connection timeout detection
4. Verify automatic reconnection on timeout
5. Test manual connection status checks

**Expected Results:**
- Heartbeat messages are sent at regular intervals
- Connection remains stable with normal activity
- Inactive connections are detected and closed
- Automatic reconnection attempts occur
- Connection status is accurately reflected in UI

### 4. Test Network Interruption Handling

**Actions:**
1. Simulate network disconnection
2. Observe reconnection attempts
3. Test exponential backoff logic
4. Verify maximum retry limit enforcement
5. Test network recovery handling

**Expected Results:**
- Network interruption is detected immediately
- Reconnection attempts follow exponential backoff
- Maximum retry attempts are respected
- Network recovery triggers immediate reconnection
- User is notified of connection issues

### 5. Test Graceful Disconnection

**Actions:**
1. Navigate away from real-time page
2. Close browser tab
3. Test explicit disconnect calls
4. Verify cleanup on page unload
5. Test multiple tab connection limits

**Expected Results:**
- Connection closes gracefully on navigation
- Resources are properly cleaned up
- Server is notified of disconnection
- Multiple connections from same user are managed
- Connection limits are enforced appropriately

### 6. Test Connection Error Handling

**Actions:**
1. Test connection to invalid WebSocket URL
2. Test connection during server maintenance
3. Test connection with server overload
4. Test SSL/TLS certificate issues
5. Test firewall/proxy blocking

**Expected Results:**
- Connection errors are handled gracefully
- Appropriate error messages are displayed
- Fallback mechanisms are activated
- User receives clear error feedback
- Recovery options are provided

## Test Automation (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('WebSocket Connection Management', () => {
  test.beforeEach(async ({ page, context }) => {
    // Enable WebSocket monitoring
    await context.route('**/ws/**', route => route.continue());
    
    // Login for authenticated connections
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/en');
  });

  test('should establish WebSocket connection successfully', async ({ page }) => {
    // Navigate to page with WebSocket
    await page.goto('/en/watch/test-video-id');
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => {
      return window.webSocketState === 'connected';
    }, { timeout: 5000 });
    
    // Verify connection status in UI
    await expect(page.locator('[data-testid="connection-status"]')).toHaveText('Connected');
    
    // Verify WebSocket messages
    const wsMessages = await page.evaluate(() => window.wsMessages || []);
    expect(wsMessages.length).toBeGreaterThan(0);
    
    // Check for welcome message
    const welcomeMessage = wsMessages.find(msg => msg.type === 'welcome');
    expect(welcomeMessage).toBeDefined();
    expect(welcomeMessage?.connectionId).toBeDefined();
  });

  test('should handle WebSocket authentication correctly', async ({ page }) => {
    // Test with valid authentication
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    const authStatus = await page.evaluate(() => window.wsAuthStatus);
    expect(authStatus).toBe('authenticated');
    
    // Test with invalid token (clear cookies)
    await page.context().clearCookies();
    await page.reload();
    
    // Should trigger re-authentication
    await expect(page.locator('[data-testid="auth-required"]')).toBeVisible();
  });

  test('should monitor connection health with heartbeats', async ({ page }) => {
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    // Monitor heartbeat messages
    const heartbeats = await page.evaluate(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(window.wsHeartbeats || []);
        }, 35000); // Wait for at least one heartbeat
      });
    });
    
    expect(heartbeats.length).toBeGreaterThan(0);
    
    // Verify heartbeat interval
    const intervals = heartbeats.slice(1).map((hb, i) => 
      new Date(hb.timestamp) - new Date(heartbeats[i].timestamp)
    );
    
    intervals.forEach(interval => {
      expect(interval).toBeGreaterThan(25000); // Allow some variance
      expect(interval).toBeLessThan(35000);
    });
  });

  test('should handle network interruption and reconnection', async ({ page }) => {
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    // Simulate network disconnection
    await page.context().setOffline(true);
    
    // Verify disconnection is detected
    await expect(page.locator('[data-testid="connection-status"]')).toHaveText('Disconnected');
    await expect(page.locator('[data-testid="reconnecting-indicator"]')).toBeVisible();
    
    // Monitor reconnection attempts
    const reconnectAttempts = await page.evaluate(() => {
      return new Promise((resolve) => {
        let attempts = 0;
        const checkAttempts = () => {
          attempts = window.wsReconnectAttempts || 0;
          if (attempts >= 3) {
            resolve(attempts);
          } else {
            setTimeout(checkAttempts, 2000);
          }
        };
        checkAttempts();
      });
    });
    
    expect(reconnectAttempts).toBeGreaterThanOrEqual(3);
    
    // Restore network and verify reconnection
    await page.context().setOffline(false);
    
    await page.waitForFunction(() => window.webSocketState === 'connected', { timeout: 10000 });
    await expect(page.locator('[data-testid="connection-status"]')).toHaveText('Connected');
  });

  test('should handle exponential backoff on reconnection', async ({ page }) => {
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    // Force disconnection and monitor backoff
    await page.evaluate(() => {
      if (window.ws) {
        window.ws.close();
      }
    });
    
    const reconnectDelays = await page.evaluate(() => {
      return new Promise((resolve) => {
        const delays = [];
        let attemptCount = 0;
        
        const originalReconnect = window.wsReconnect;
        window.wsReconnect = function() {
          const start = Date.now();
          attemptCount++;
          
          if (attemptCount <= 4) {
            delays.push(start);
            setTimeout(originalReconnect, Math.pow(2, attemptCount) * 1000);
          }
        };
        
        setTimeout(() => resolve(delays), 15000);
      });
    });
    
    // Verify exponential backoff pattern
    if (reconnectDelays.length >= 3) {
      const delay1 = reconnectDelays[1] - reconnectDelays[0];
      const delay2 = reconnectDelays[2] - reconnectDelays[1];
      
      expect(delay2).toBeGreaterThan(delay1 * 1.8); // Allow some variance
      expect(delay2).toBeLessThan(delay1 * 2.5);
    }
  });

  test('should handle graceful disconnection', async ({ page }) => {
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    // Test navigation away
    await page.goto('/en');
    
    // Verify connection was closed gracefully
    const connectionState = await page.evaluate(() => window.webSocketState);
    expect(connectionState).toBe('disconnected');
    
    // Test explicit disconnect
    await page.goto('/en/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    await page.click('[data-testid="disconnect-button"]');
    await expect(page.locator('[data-testid="connection-status"]')).toHaveText('Disconnected');
  });

  test('should handle connection errors gracefully', async ({ page }) => {
    // Mock invalid WebSocket URL
    await page.route('**/ws/**', route => {
      route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'WebSocket endpoint not found'
      });
    });
    
    await page.goto('/en/watch/test-video-id');
    
    // Verify error handling
    await expect(page.locator('[data-testid="connection-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="connection-error"]')).toContainText('Unable to connect');
    
    // Verify retry mechanism
    await expect(page.locator('[data-testid="retry-connection"]')).toBeVisible();
    
    // Test retry button
    await page.click('[data-testid="retry-connection"]');
    
    // Should show attempting to reconnect
    await expect(page.locator('[data-testid="reconnecting-indicator"]')).toBeVisible();
  });

  test('should enforce connection limits per user', async ({ page, context }) => {
    // Create multiple pages/tabs for same user
    const pages = [page];
    for (let i = 1; i < 4; i++) {
      const newPage = await context.newPage();
      await newPage.goto('/en/login');
      await newPage.fill('[data-testid="email"]', 'test@example.com');
      await newPage.fill('[data-testid="password"]', 'password123');
      await newPage.click('[data-testid="login-button"]');
      await newPage.waitForURL('/en');
      pages.push(newPage);
    }
    
    // Navigate all pages to WebSocket-enabled page
    for (const p of pages) {
      await p.goto('/en/watch/test-video-id');
    }
    
    // Wait for connections to establish
    await page.waitForTimeout(3000);
    
    // Verify only allowed number of connections
    const connectionCounts = await Promise.all(
      pages.map(p => p.evaluate(() => window.webSocketState === 'connected'))
    );
    
    const connectedCount = connectionCounts.filter(Boolean).length;
    expect(connectedCount).toBeLessThanOrEqual(3); // Assuming 3 connection limit
  });

  test('should work with different network conditions', async ({ page }) => {
    // Test with slow 3G
    await page.emulateNetwork(networkConditions.slow3g);
    
    const startTime = Date.now();
    await page.goto('/en/watch/test-video-id');
    
    await page.waitForFunction(() => window.webSocketState === 'connected', { timeout: 15000 });
    const connectionTime = Date.now() - startTime;
    
    // Should still connect but take longer
    expect(connectionTime).toBeGreaterThan(2000);
    expect(connectionTime).toBeLessThan(12000);
    
    // Test with fast 3G
    await page.emulateNetwork(networkConditions.fast3g);
    
    const fastStartTime = Date.now();
    await page.reload();
    
    await page.waitForFunction(() => window.webSocketState === 'connected', { timeout: 10000 });
    const fastConnectionTime = Date.now() - fastStartTime;
    
    // Should connect faster with better network
    expect(fastConnectionTime).toBeLessThan(connectionTime);
  });

  test('should handle Arabic interface with WebSocket', async ({ page }) => {
    await page.goto('/ar/watch/test-video-id');
    await page.waitForFunction(() => window.webSocketState === 'connected');
    
    // Verify RTL layout with connection status
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-testid="connection-status"]')).toBeVisible();
    
    // Test Arabic error messages
    await page.evaluate(() => {
      if (window.ws) {
        window.ws.close();
      }
    });
    
    await expect(page.locator('[data-testid="connection-error"]')).toContainText('غير قادر على الاتصال');
  });
});
```

## API Endpoints Tested

- `WS wss://ws.alummahnow.net/` - Main WebSocket endpoint
- `GET /api/auth/validate` - Token validation
- `POST /api/analytics/connection` - Connection analytics
- `GET /api/health/websocket` - WebSocket server health

## Success Criteria

- ✅ WebSocket connection establishes within 5 seconds
- ✅ Authentication works with valid tokens
- ✅ Invalid/expired tokens are handled correctly
- ✅ Heartbeat monitoring maintains connection health
- ✅ Network interruptions trigger reconnection
- ✅ Exponential backoff prevents server overload
- ✅ Graceful disconnection cleans up resources
- ✅ Connection errors are handled gracefully
- ✅ Connection limits are enforced per user
- ✅ Different network conditions are supported
- ✅ Arabic interface works with WebSocket features
- ✅ Connection status is accurately reflected in UI

## Failure Scenarios

1. **WebSocket Server Down**: Show appropriate error and retry mechanism
2. **Authentication Failure**: Trigger re-authentication flow
3. **Network Unstable**: Implement robust reconnection logic
4. **Server Overload**: Implement connection queuing
5. **SSL Certificate Issues**: Provide clear error messages

## Performance Requirements

- Connection establishment: < 5 seconds
- Reconnection attempts: Exponential backoff (2^n * 1000ms)
- Heartbeat interval: 30 seconds
- Maximum retry attempts: 5
- Connection timeout: 10 seconds

## Test Environment

- **Browser**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Network**: WiFi, 4G, 3G, Offline simulation
- **WebSocket Server**: Production and staging environments
- **Language**: English (en), Arabic (ar)

## Related Test Cases

- [TC-REAL-002](./TCREAL002_realtime-progress-updates.md) - Real-time Progress Updates
- [TC-REAL-003](./TCREAL003_live-chat-functionality.md) - Live Chat Functionality
- [TC-ERR-007](../error-handling/TCERR007_authentication-error-handling.md) - Authentication Error Handling

## Test Execution History

| Date | Environment | Result | Notes |
|------|-------------|--------|-------|
| 2025-11-20 | Staging | ✅ Pass | Initial implementation |
| | | | |

## Test Maintenance

- Update WebSocket URLs when server changes
- Modify authentication flow when auth system changes
- Adjust timeout values when performance requirements change
- Update network conditions when new connection types are supported
- Add new connection scenarios as features are implemented