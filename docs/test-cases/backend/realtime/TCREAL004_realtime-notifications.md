# TC-REAL-004: Real-time Notifications

## Test Case Information

- **Test ID**: TC-REAL-004
- **Title**: Real-time Notifications
- **Priority**: High
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 15 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that real-time notifications are delivered instantly to users across multiple devices for various platform events including new followers, video uploads, comments, likes, and system announcements.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Multiple test user accounts with notification preferences
- Push notification permissions granted
- Notification service configured
- Test data for various notification types

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface NotificationData {
  id: string;
  userId: string;
  type: 'follow' | 'like' | 'comment' | 'upload' | 'mention' | 'system';
  title: string;
  message: string;
  data: any;
  timestamp: number;
  read: boolean;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

const testNotifications: NotificationData[] = [
  {
    id: 'notif-001',
    userId: 'user-001',
    type: 'follow',
    title: 'New Follower',
    message: 'TestUser2 started following you',
    data: { followerId: 'user-002', followerName: 'TestUser2' },
    timestamp: Date.now(),
    read: false,
    priority: 'normal'
  },
  {
    id: 'notif-002',
    userId: 'user-001',
    type: 'like',
    title: 'Video Liked',
    message: 'Someone liked your video "Test Video"',
    data: { videoId: 'video-001', likerId: 'user-003' },
    timestamp: Date.now(),
    read: false,
    priority: 'low'
  }
];
```

## Test Scenarios

### Scenario 1: New Follower Notifications

**Test Steps:**

1. **Setup Notification Client**
   ```typescript
   const client = await createWebSocketClient(userToken);
   await client.subscribe('notifications', { userId: 'user-001' });
   
   const notifications: NotificationData[] = [];
   client.on('notification', (notification) => {
     notifications.push(notification);
   });
   ```

2. **Trigger Follow Event**
   ```typescript
   // User 2 follows user 1
   await triggerFollowEvent('user-002', 'user-001');
   
   // Wait for notification
   await waitFor(() => notifications.length > 0, 3000);
   ```

3. **Verify Notification Content**
   ```typescript
   const followNotification = notifications.find(n => n.type === 'follow');
   expect(followNotification).toBeDefined();
   expect(followNotification.title).toBe('New Follower');
   expect(followNotification.message).toContain('TestUser2');
   expect(followNotification.data.followerId).toBe('user-002');
   expect(followNotification.priority).toBe('normal');
   ```

### Scenario 2: Video Like Notifications

**Test Steps:**

1. **Setup Video Like Monitoring**
   ```typescript
   await client.subscribe('notifications', { userId: 'user-001', types: ['like'] });
   
   const likeNotifications: NotificationData[] = [];
   client.on('notification', (notification) => {
     if (notification.type === 'like') {
       likeNotifications.push(notification);
     }
   });
   ```

2. **Trigger Like Event**
   ```typescript
   // User 3 likes user 1's video
   await triggerLikeEvent('user-003', 'video-001');
   
   // Wait for notification
   await waitFor(() => likeNotifications.length > 0, 3000);
   ```

3. **Verify Like Notification**
   ```typescript
   const likeNotification = likeNotifications[0];
   expect(likeNotification.type).toBe('like');
   expect(likeNotification.title).toBe('Video Liked');
   expect(likeNotification.data.videoId).toBe('video-001');
   expect(likeNotification.data.likerId).toBe('user-003');
   expect(likeNotification.priority).toBe('low');
   ```

### Scenario 3: Comment Notifications

**Test Steps:**

1. **Monitor Comment Notifications**
   ```typescript
   await client.subscribe('notifications', { userId: 'user-001', types: ['comment'] });
   
   const commentNotifications: NotificationData[] = [];
   client.on('notification', (notification) => {
     if (notification.type === 'comment') {
       commentNotifications.push(notification);
     }
   });
   ```

2. **Add Comment to Video**
   ```typescript
   await addComment('user-002', 'video-001', 'Great video!');
   
   // Wait for notification
   await waitFor(() => commentNotifications.length > 0, 3000);
   ```

3. **Verify Comment Notification**
   ```typescript
   const commentNotification = commentNotifications[0];
   expect(commentNotification.type).toBe('comment');
   expect(commentNotification.title).toBe('New Comment');
   expect(commentNotification.message).toContain('Great video!');
   expect(commentNotification.data.videoId).toBe('video-001');
   expect(commentNotification.data.commenterId).toBe('user-002');
   ```

### Scenario 4: Mention Notifications

**Test Steps:**

1. **Setup Mention Monitoring**
   ```typescript
   await client.subscribe('notifications', { userId: 'user-001', types: ['mention'] });
   
   const mentionNotifications: NotificationData[] = [];
   client.on('notification', (notification) => {
     if (notification.type === 'mention') {
       mentionNotifications.push(notification);
     }
   });
   ```

2. **Create Mention**
   ```typescript
   await createCommentWithMention('user-002', 'video-001', '@TestUser1 check this out!');
   
   // Wait for notification
   await waitFor(() => mentionNotifications.length > 0, 3000);
   ```

3. **Verify Mention Notification**
   ```typescript
   const mentionNotification = mentionNotifications[0];
   expect(mentionNotification.type).toBe('mention');
   expect(mentionNotification.title).toBe('You Were Mentioned');
   expect(mentionNotification.message).toContain('@TestUser1');
   expect(mentionNotification.data.mentionedBy).toBe('user-002');
   ```

### Scenario 5: System Notifications

**Test Steps:**

1. **Monitor System Notifications**
   ```typescript
   await client.subscribe('notifications', { userId: 'user-001', types: ['system'] });
   
   const systemNotifications: NotificationData[] = [];
   client.on('notification', (notification) => {
     if (notification.type === 'system') {
       systemNotifications.push(notification);
     }
   });
   ```

2. **Send System Announcement**
   ```typescript
   await sendSystemNotification({
     title: 'Platform Maintenance',
     message: 'Scheduled maintenance in 2 hours',
     priority: 'high',
     targetUsers: ['user-001']
   });
   
   // Wait for notification
   await waitFor(() => systemNotifications.length > 0, 3000);
   ```

3. **Verify System Notification**
   ```typescript
   const systemNotification = systemNotifications[0];
   expect(systemNotification.type).toBe('system');
   expect(systemNotification.title).toBe('Platform Maintenance');
   expect(systemNotification.priority).toBe('high');
   expect(systemNotification.message).toContain('maintenance');
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-004: Real-time Notifications', () => {
  let clients: WebSocketClient[] = [];
  let pages: Page[] = [];
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    // Create test users and authenticate
    const testUsers = [
      { email: 'notifuser1@test.com', password: 'testpass123', username: 'NotifUser1' },
      { email: 'notifuser2@test.com', password: 'testpass123', username: 'NotifUser2' },
      { email: 'notifuser3@test.com', password: 'testpass123', username: 'NotifUser3' }
    ];

    for (const user of testUsers) {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Login user
      await page.goto('/en/login');
      await page.fill('[data-testid="email"]', user.email);
      await page.fill('[data-testid="password"]', user.password);
      await page.click('[data-testid="login-button"]');
      
      // Get auth token
      const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
      
      // Create WebSocket client
      const wsClient = new WebSocketClient(authToken!);
      await wsClient.connect();
      
      clients.push(wsClient);
      pages.push(page);
    }
  });

  test.afterAll(async () => {
    for (const client of clients) {
      await client.disconnect();
    }
    
    for (const page of pages) {
      await page.close();
    }
  });

  test('should deliver new follower notifications in real-time', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    // Subscribe to notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com' });

    const notifications: any[] = [];
    client1.on('notification', (notification) => {
      notifications.push(notification);
    });

    // User 2 follows user 1
    await page2.goto('/en/users/notifuser1@test.com');
    await page2.click('[data-testid="follow-button"]');

    // Wait for notification
    await page1.waitForTimeout(3000);

    // Verify notification received
    const followNotification = notifications.find(n => n.type === 'follow');
    expect(followNotification).toBeDefined();
    expect(followNotification.title).toBe('New Follower');
    expect(followNotification.message).toContain('NotifUser2');
    expect(followNotification.data.followerId).toBe('notifuser2@test.com');
  });

  test('should deliver video like notifications instantly', async () => {
    const [client1, client3] = clients;
    const [page1, page3] = pages;

    // Subscribe to like notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com', types: ['like'] });

    const likeNotifications: any[] = [];
    client1.on('notification', (notification) => {
      if (notification.type === 'like') {
        likeNotifications.push(notification);
      }
    });

    // User 3 likes user 1's video
    await page3.goto('/en/videos/test-video-001');
    await page3.click('[data-testid="like-button"]');

    // Wait for notification
    await page1.waitForTimeout(2000);

    // Verify like notification
    const likeNotification = likeNotifications[0];
    expect(likeNotification.type).toBe('like');
    expect(likeNotification.title).toBe('Video Liked');
    expect(likeNotification.data.videoId).toBe('test-video-001');
    expect(likeNotification.data.likerId).toBe('notifuser3@test.com');
    expect(likeNotification.priority).toBe('low');
  });

  test('should deliver comment notifications for user videos', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    // Subscribe to comment notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com', types: ['comment'] });

    const commentNotifications: any[] = [];
    client1.on('notification', (notification) => {
      if (notification.type === 'comment') {
        commentNotifications.push(notification);
      }
    });

    // User 2 comments on user 1's video
    await page2.goto('/en/videos/test-video-001');
    await page2.fill('[data-testid="comment-input"]', 'Great video! 👍');
    await page2.click('[data-testid="post-comment"]');

    // Wait for notification
    await page1.waitForTimeout(3000);

    // Verify comment notification
    const commentNotification = commentNotifications[0];
    expect(commentNotification.type).toBe('comment');
    expect(commentNotification.title).toBe('New Comment');
    expect(commentNotification.message).toContain('Great video!');
    expect(commentNotification.data.videoId).toBe('test-video-001');
    expect(commentNotification.data.commenterId).toBe('notifuser2@test.com');
  });

  test('should deliver mention notifications when user is tagged', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    // Subscribe to mention notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com', types: ['mention'] });

    const mentionNotifications: any[] = [];
    client1.on('notification', (notification) => {
      if (notification.type === 'mention') {
        mentionNotifications.push(notification);
      }
    });

    // User 2 mentions user 1 in a comment
    await page2.goto('/en/videos/test-video-001');
    await page2.fill('[data-testid="comment-input"]', '@NotifUser1 check this out!');
    await page2.click('[data-testid="post-comment"]');

    // Wait for notification
    await page1.waitForTimeout(3000);

    // Verify mention notification
    const mentionNotification = mentionNotifications[0];
    expect(mentionNotification.type).toBe('mention');
    expect(mentionNotification.title).toBe('You Were Mentioned');
    expect(mentionNotification.message).toContain('@NotifUser1');
    expect(mentionNotification.data.mentionedBy).toBe('notifuser2@test.com');
  });

  test('should deliver system notifications with high priority', async () => {
    const [client1] = clients;
    const [page1] = pages;

    // Subscribe to system notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com', types: ['system'] });

    const systemNotifications: any[] = [];
    client1.on('notification', (notification) => {
      if (notification.type === 'system') {
        systemNotifications.push(notification);
      }
    });

    // Trigger system notification (via admin panel or API)
    await page1.goto('/en/admin/notifications');
    await page1.fill('[data-testid="notification-title"]', 'Platform Maintenance');
    await page1.fill('[data-testid="notification-message"]', 'Scheduled maintenance in 2 hours');
    await page1.selectOption('[data-testid="notification-priority"]', 'high');
    await page1.click('[data-testid="send-notification"]');

    // Wait for notification
    await page1.waitForTimeout(2000);

    // Verify system notification
    const systemNotification = systemNotifications[0];
    expect(systemNotification.type).toBe('system');
    expect(systemNotification.title).toBe('Platform Maintenance');
    expect(systemNotification.priority).toBe('high');
    expect(systemNotification.message).toContain('maintenance');
  });

  test('should handle notification preferences and filtering', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    // Set notification preferences (disable like notifications)
    await page1.goto('/en/settings/notifications');
    await page1.uncheck('[data-testid="like-notifications"]');
    await page1.click('[data-testid="save-preferences"]');

    // Subscribe to notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com' });

    const notifications: any[] = [];
    client1.on('notification', (notification) => {
      notifications.push(notification);
    });

    // User 2 likes user 1's video (should not trigger notification)
    await page2.goto('/en/videos/test-video-001');
    await page2.click('[data-testid="like-button"]');

    // User 2 follows user 1 (should trigger notification)
    await page2.goto('/en/users/notifuser1@test.com');
    await page2.click('[data-testid="follow-button"]');

    // Wait for potential notifications
    await page1.waitForTimeout(3000);

    // Verify only follow notification received
    const likeNotifications = notifications.filter(n => n.type === 'like');
    const followNotifications = notifications.filter(n => n.type === 'follow');

    expect(likeNotifications.length).toBe(0);
    expect(followNotifications.length).toBe(1);
  });

  test('should maintain notification delivery under high load', async () => {
    const [client1] = clients;
    const [page2] = pages; // Use page2 for triggering events

    // Subscribe to notifications
    await client1.subscribe('notifications', { userId: 'notifuser1@test.com' });

    const notifications: any[] = [];
    client1.on('notification', (notification) => {
      notifications.push(notification);
    });

    const startTime = Date.now();

    // Trigger multiple notification events rapidly
    for (let i = 0; i < 50; i++) {
      await page2.goto('/en/videos/test-video-001');
      await page2.click('[data-testid="like-button"]');
      await page2.waitForTimeout(10);
    }

    // Wait for all notifications to be delivered
    await page2.waitForTimeout(5000);

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Verify performance and completeness
    expect(notifications.length).toBeGreaterThanOrEqual(45); // Allow some loss
    expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds

    // Verify notification order
    for (let i = 1; i < notifications.length; i++) {
      expect(notifications[i].timestamp).toBeGreaterThanOrEqual(
        notifications[i - 1].timestamp
      );
    }
  });
});

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
- **Notification Delivery**: < 100ms
- **Push Notification**: < 500ms
- **Batch Notifications**: < 1s
- **System Announcements**: < 200ms

### Throughput Requirements
- **Concurrent Users**: 50,000+
- **Notifications/Second**: 10,000+
- **Push Notifications**: 5,000+/second

## Error Handling

### Expected Error Scenarios
1. **Invalid User ID**
   - Error response
   - Connection cleanup
   - Logging

2. **Permission Denied**
   - Access denied response
   - User notification
   - Audit logging

3. **Rate Limiting**
   - Throttling response
   - Retry after header
   - User notification

## Cross-Browser Testing Matrix

| Browser | Version | Notifications | Push | Filtering | Performance |
|---------|---------|---------------|------|-----------|-------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Push Notifications
- Permission handling
- Background delivery
- Notification tray
- Deep linking

### Performance
- Battery usage
- Memory consumption
- Network efficiency

## RTL Testing

### Arabic Notifications
- RTL notification layout
- Arabic message formatting
- Right-aligned notification center
- Arabic system announcements

## Test Execution

### Running Tests
```bash
# Run all notification tests
pnpm test:e2e --grep "TC-REAL-004"

# Run specific scenarios
pnpm test:e2e --grep "should deliver new follower notifications"
pnpm test:e2e --grep "should handle notification preferences"
```

## Validation Criteria

### Success Criteria
- ✅ Real-time notification delivery
- ✅ All notification types working
- ✅ Preference filtering functional
- ✅ Performance within limits
- ✅ Push notifications working
- ✅ System announcements delivered

### Failure Criteria
- ❌ Notification delivery delays
- ❌ Missing notification types
- ❌ Preference filtering failures
- ❌ Performance degradation
- ❌ Push notification failures

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-002](./TCREAL002_realtime-progress-updates.md) - Real-time Progress Updates
- [TC-AUTH-005](../auth/TCAUTH005_SessionTimeout.md) - Session Timeout

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