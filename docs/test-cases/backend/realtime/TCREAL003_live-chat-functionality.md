# TC-REAL-003: Live Chat Functionality

## Test Case Information

- **Test ID**: TC-REAL-003
- **Title**: Live Chat Functionality
- **Priority**: High
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that live chat functionality works correctly across multiple users with real-time message delivery, typing indicators, user presence, and message persistence.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Multiple test user accounts with authentication tokens
- Live streaming or video content with chat enabled
- Chat moderation tools configured
- Message filtering and profanity detection setup

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
// Test chat data
interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  type: 'message' | 'system' | 'moderator';
  channelId: string;
  videoId?: string;
  isEdited?: boolean;
  editedAt?: number;
  replyTo?: string;
  reactions?: MessageReaction[];
}

interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

interface TypingIndicator {
  userId: string;
  username: string;
  isTyping: boolean;
  lastSeen: number;
}

const testChatMessages: ChatMessage[] = [
  {
    id: 'msg-001',
    userId: 'user-001',
    username: 'TestUser1',
    content: 'Hello everyone! 👋',
    timestamp: Date.now(),
    type: 'message',
    channelId: 'channel-live-001',
    videoId: 'video-live-001'
  },
  {
    id: 'msg-002',
    userId: 'user-002',
    username: 'TestUser2',
    content: 'Great stream!',
    timestamp: Date.now() + 1000,
    type: 'message',
    channelId: 'channel-live-001',
    videoId: 'video-live-001',
    replyTo: 'msg-001'
  }
];
```

## Test Scenarios

### Scenario 1: Real-time Message Delivery

**Test Steps:**

1. **Setup Multiple Chat Clients**
   ```typescript
   // Create multiple authenticated clients
   const client1 = await createWebSocketClient(user1Token);
   const client2 = await createWebSocketClient(user2Token);
   const client3 = await createWebSocketClient(user3Token);
   
   // Join chat room
   await client1.joinChat('channel-live-001');
   await client2.joinChat('channel-live-001');
   await client3.joinChat('channel-live-001');
   ```

2. **Send and Receive Messages**
   ```typescript
   const receivedMessages: ChatMessage[] = [];
   
   // Listen for messages on all clients
   [client1, client2, client3].forEach((client, index) => {
     client.on('chat-message', (message) => {
       receivedMessages.push({ ...message, receivedBy: `client${index + 1}` });
     });
   });
   
   // Send message from client 1
   const testMessage = {
     content: 'This is a test message',
     channelId: 'channel-live-001'
   };
   
   await client1.sendChatMessage(testMessage);
   ```

3. **Verify Message Delivery**
   ```typescript
   // Wait for message delivery
   await waitFor(() => receivedMessages.length >= 2, 5000); // Should be received by client2 and client3
   
   // Verify message content
   const deliveredMessages = receivedMessages.filter(m => m.content === testMessage.content);
   expect(deliveredMessages.length).toBe(2); // Received by client2 and client3
   
   // Verify message metadata
   deliveredMessages.forEach(msg => {
     expect(msg.userId).toBe('user-001');
     expect(msg.username).toBe('TestUser1');
     expect(msg.timestamp).toBeGreaterThan(0);
     expect(msg.type).toBe('message');
   });
   ```

### Scenario 2: Typing Indicators

**Test Steps:**

1. **Setup Typing Detection**
   ```typescript
   const typingIndicators: TypingIndicator[] = [];
   
   client2.on('user-typing', (indicator) => {
     typingIndicators.push(indicator);
   });
   
   client3.on('user-typing', (indicator) => {
     typingIndicators.push(indicator);
   });
   ```

2. **Simulate Typing**
   ```typescript
   // Start typing on client 1
   await client1.startTyping('channel-live-001');
   
   // Wait for typing indicators
   await waitFor(() => typingIndicators.length >= 2, 2000);
   
   // Verify typing indicators received
   expect(typingIndicators.length).toBe(2);
   typingIndicators.forEach(indicator => {
     expect(indicator.userId).toBe('user-001');
     expect(indicator.username).toBe('TestUser1');
     expect(indicator.isTyping).toBe(true);
   });
   
   // Stop typing
   await client1.stopTyping('channel-live-001');
   
   // Verify typing stopped
   await waitFor(() => {
     const latest = typingIndicators[typingIndicators.length - 1];
     return latest && !latest.isTyping;
   }, 2000);
   ```

### Scenario 3: Message Reactions

**Test Steps:**

1. **Send Message and Add Reactions**
   ```typescript
   // Send a message
   const messageId = await client1.sendChatMessage({
     content: 'React to this message!',
     channelId: 'channel-live-001'
   });
   
   // Add reactions from different users
   await client2.addReaction(messageId, '👍');
   await client3.addReaction(messageId, '❤️');
   await client1.addReaction(messageId, '👍');
   ```

2. **Verify Reaction Synchronization**
   ```typescript
   const reactionUpdates: any[] = [];
   
   [client1, client2, client3].forEach(client => {
     client.on('reaction-update', (update) => {
       reactionUpdates.push(update);
     });
   });
   
   // Wait for reaction updates
   await waitFor(() => reactionUpdates.length >= 6, 5000); // 2 reactions × 3 clients
   
   // Verify reaction counts
   const latestUpdate = reactionUpdates[reactionUpdates.length - 1];
   const thumbsUpReaction = latestUpdate.reactions.find((r: any) => r.emoji === '👍');
   const heartReaction = latestUpdate.reactions.find((r: any) => r.emoji === '❤️');
   
   expect(thumbsUpReaction.count).toBe(2);
   expect(heartReaction.count).toBe(1);
   expect(thumbsUpReaction.users).toContain('user-001');
   expect(thumbsUpReaction.users).toContain('user-002');
   expect(heartReaction.users).toContain('user-003');
   ```

### Scenario 4: Message Editing and Deletion

**Test Steps:**

1. **Edit Message**
   ```typescript
   // Send original message
   const messageId = await client1.sendChatMessage({
     content: 'Original message',
     channelId: 'channel-live-001'
   });
   
   // Edit the message
   await client1.editMessage(messageId, 'Edited message content');
   
   // Verify edit propagation
   const editUpdates: any[] = [];
   [client2, client3].forEach(client => {
     client.on('message-edited', (update) => {
       editUpdates.push(update);
     });
   });
   
   await waitFor(() => editUpdates.length >= 2, 3000);
   
   editUpdates.forEach(update => {
     expect(update.messageId).toBe(messageId);
     expect(update.newContent).toBe('Edited message content');
     expect(update.isEdited).toBe(true);
     expect(update.editedAt).toBeGreaterThan(0);
   });
   ```

2. **Delete Message**
   ```typescript
   // Delete the message
   await client1.deleteMessage(messageId);
   
   // Verify deletion propagation
   const deleteUpdates: any[] = [];
   [client2, client3].forEach(client => {
     client.on('message-deleted', (update) => {
       deleteUpdates.push(update);
     });
   });
   
   await waitFor(() => deleteUpdates.length >= 2, 3000);
   
   deleteUpdates.forEach(update => {
     expect(update.messageId).toBe(messageId);
     expect(update.deletedBy).toBe('user-001');
   });
   ```

### Scenario 5: Chat Moderation

**Test Steps:**

1. **Setup Moderator Client**
   ```typescript
   const moderatorClient = await createWebSocketClient(moderatorToken);
   await moderatorClient.joinChat('channel-live-001');
   ```

2. **Test Message Filtering**
   ```typescript
   // Send message with profanity
   const profanityMessageId = await client2.sendChatMessage({
     content: 'This message contains bad words',
     channelId: 'channel-live-001'
   });
   
   // Verify message is filtered or flagged
   const moderationEvents: any[] = [];
   moderatorClient.on('moderation-event', (event) => {
     moderationEvents.push(event);
   });
   
   await waitFor(() => moderationEvents.length > 0, 3000);
   
   const filterEvent = moderationEvents.find(e => e.type === 'message-filtered');
   expect(filterEvent).toBeDefined();
   expect(filterEvent.messageId).toBe(profanityMessageId);
   expect(filterEvent.reason).toContain('profanity');
   ```

3. **Test User Timeout/Ban**
   ```typescript
   // Timeout user
   await moderatorClient.timeoutUser('user-002', 300, 'Spamming'); // 5 minutes
   
   // Verify user is muted
   const timeoutResponse = await client2.sendChatMessage({
     content: 'This should be blocked',
     channelId: 'channel-live-001'
   });
   
   expect(timeoutResponse.error).toContain('timed out');
   
   // Verify timeout notification
   const timeoutNotifications: any[] = [];
   client2.on('user-timed-out', (notification) => {
     timeoutNotifications.push(notification);
   });
   
   await waitFor(() => timeoutNotifications.length > 0, 3000);
   expect(timeoutNotifications[0].duration).toBe(300);
   expect(timeoutNotifications[0].reason).toBe('Spamming');
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-003: Live Chat Functionality', () => {
  let clients: WebSocketClient[] = [];
  let pages: Page[] = [];
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    // Create test users and authenticate
    const testUsers = [
      { email: 'chatuser1@test.com', password: 'testpass123', username: 'ChatUser1' },
      { email: 'chatuser2@test.com', password: 'testpass123', username: 'ChatUser2' },
      { email: 'chatuser3@test.com', password: 'testpass123', username: 'ChatUser3' },
      { email: 'moderator@test.com', password: 'testpass123', username: 'Moderator' }
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
    // Disconnect all WebSocket clients
    for (const client of clients) {
      await client.disconnect();
    }
    
    // Close all pages
    for (const page of pages) {
      await page.close();
    }
  });

  test('should deliver messages in real-time to all chat participants', async () => {
    const [client1, client2, client3] = clients;
    const [page1, page2, page3] = pages;

    // Join chat room
    await Promise.all([
      client1.joinChat('channel-live-001'),
      client2.joinChat('channel-live-001'),
      client3.joinChat('channel-live-001')
    ]);

    const receivedMessages: any[] = [];

    // Listen for messages
    [client1, client2, client3].forEach((client, index) => {
      client.on('chat-message', (message) => {
        receivedMessages.push({ ...message, receivedBy: `client${index + 1}` });
      });
    });

    // Send message from client 1
    await page1.goto('/en/live/channel-live-001');
    await page1.waitForSelector('[data-testid="chat-input"]');
    await page1.fill('[data-testid="chat-input"]', 'Hello from client 1!');
    await page1.click('[data-testid="send-message"]');

    // Wait for message delivery
    await page3.waitForTimeout(2000);

    // Verify message received by other clients
    const messagesForClient2 = receivedMessages.filter(m => m.receivedBy === 'client2');
    const messagesForClient3 = receivedMessages.filter(m => m.receivedBy === 'client3');

    expect(messagesForClient2.length).toBeGreaterThan(0);
    expect(messagesForClient3.length).toBeGreaterThan(0);

    // Verify message content
    const deliveredMessage = messagesForClient2.find(m => m.content === 'Hello from client 1!');
    expect(deliveredMessage).toBeDefined();
    expect(deliveredMessage.username).toBe('ChatUser1');
  });

  test('should show and hide typing indicators in real-time', async () => {
    const [client1, client2, client3] = clients;
    const [page1, page2] = pages;

    const typingIndicators: any[] = [];

    // Listen for typing indicators
    [client2, client3].forEach(client => {
      client.on('user-typing', (indicator) => {
        typingIndicators.push(indicator);
      });
    });

    // Start typing on client 1
    await page1.goto('/en/live/channel-live-001');
    await page1.waitForSelector('[data-testid="chat-input"]');
    await page1.fill('[data-testid="chat-input"]', 'Typing...');

    // Wait for typing indicators
    await page2.waitForTimeout(1500);

    // Verify typing indicators received
    expect(typingIndicators.length).toBeGreaterThan(0);
    
    const typingIndicator = typingIndicators.find(t => t.userId === 'chatuser1@test.com');
    expect(typingIndicator).toBeDefined();
    expect(typingIndicator.isTyping).toBe(true);

    // Clear input to stop typing
    await page1.fill('[data-testid="chat-input"]', '');
    await page1.waitForTimeout(1500);

    // Verify typing stopped
    const stoppedTyping = typingIndicators.find(t => 
      t.userId === 'chatuser1@test.com' && !t.isTyping
    );
    expect(stoppedTyping).toBeDefined();
  });

  test('should synchronize message reactions across all clients', async () => {
    const [client1, client2, client3] = clients;
    const [page1, page2, page3] = pages;

    // Send a message to react to
    await page1.goto('/en/live/channel-live-001');
    await page1.waitForSelector('[data-testid="chat-input"]');
    await page1.fill('[data-testid="chat-input"]', 'React to this message!');
    await page1.click('[data-testid="send-message"]');

    // Wait for message to appear
    await page1.waitForSelector('[data-testid="chat-message"]', { timeout: 5000 });

    // Get message ID
    const messageId = await page1.getAttribute('[data-testid="chat-message"]', 'data-message-id');

    const reactionUpdates: any[] = [];

    // Listen for reaction updates
    [client1, client2, client3].forEach(client => {
      client.on('reaction-update', (update) => {
        reactionUpdates.push(update);
      });
    });

    // Add reactions from different clients
    await page2.click(`[data-message-id="${messageId}"] [data-testid="react-thumbs-up"]`);
    await page3.click(`[data-message-id="${messageId}"] [data-testid="react-heart"]`);
    await page1.click(`[data-message-id="${messageId}"] [data-testid="react-thumbs-up"]`);

    // Wait for reaction synchronization
    await page3.waitForTimeout(3000);

    // Verify reaction counts
    const latestUpdate = reactionUpdates[reactionUpdates.length - 1];
    const thumbsUpReaction = latestUpdate.reactions.find((r: any) => r.emoji === '👍');
    const heartReaction = latestUpdate.reactions.find((r: any) => r.emoji === '❤️');

    expect(thumbsUpReaction.count).toBe(2);
    expect(heartReaction.count).toBe(1);
  });

  test('should handle message editing and deletion', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    // Send original message
    await page1.goto('/en/live/channel-live-001');
    await page1.waitForSelector('[data-testid="chat-input"]');
    await page1.fill('[data-testid="chat-input"]', 'Original message');
    await page1.click('[data-testid="send-message"]');

    // Wait for message to appear
    await page1.waitForSelector('[data-testid="chat-message"]', { timeout: 5000 });
    const messageId = await page1.getAttribute('[data-testid="chat-message"]', 'data-message-id');

    // Edit message
    await page1.click(`[data-message-id="${messageId}"] [data-testid="edit-message"]`);
    await page1.fill('[data-testid="edit-input"]', 'Edited message content');
    await page1.click('[data-testid="save-edit"]');

    // Verify edit on other client
    await page2.waitForSelector(`[data-message-id="${messageId}"]`, { timeout: 5000 });
    const editedContent = await page2.textContent(`[data-message-id="${messageId}"] [data-testid="message-content"]`);
    expect(editedContent).toBe('Edited message content');

    // Delete message
    await page1.click(`[data-message-id="${messageId}"] [data-testid="delete-message"]`);
    await page1.click('[data-testid="confirm-delete"]');

    // Verify deletion on other client
    await page2.waitForSelector(`[data-message-id="${messageId}"]`, { state: 'detached', timeout: 5000 });
  });

  test('should enforce chat moderation rules', async () => {
    const [client2, moderatorClient] = [clients[1], clients[3]];
    const [page2, moderatorPage] = [pages[1], pages[3]];

    // Send message with profanity
    await page2.goto('/en/live/channel-live-001');
    await page2.waitForSelector('[data-testid="chat-input"]');
    await page2.fill('[data-testid="chat-input"]', 'This message contains bad words');
    await page2.click('[data-testid="send-message"]');

    // Check if message was filtered
    const messageExists = await page2.$('[data-testid="chat-message"]').then(el => !!el);
    
    // Message should either not exist or be marked as filtered
    if (messageExists) {
      const filteredClass = await page2.getAttribute('[data-testid="chat-message"]', 'class');
      expect(filteredClass).toContain('filtered');
    }

    // Moderator timeouts user
    await moderatorPage.goto('/en/live/channel-live-001');
    await moderatorPage.waitForSelector('[data-testid="moderation-panel"]');
    await moderatorPage.click('[data-testid="user-chatuser2@test.com"]');
    await moderatorPage.fill('[data-testid="timeout-duration"]', '5');
    await moderatorPage.fill('[data-testid="timeout-reason"]', 'Testing moderation');
    await moderatorPage.click('[data-testid="apply-timeout"]');

    // Try to send another message
    await page2.fill('[data-testid="chat-input"]', 'This should be blocked');
    await page2.click('[data-testid="send-message"]');

    // Verify error message
    const errorMessage = await page2.textContent('[data-testid="chat-error"]');
    expect(errorMessage).toContain('timed out');
  });

  test('should handle high message volume without performance degradation', async () => {
    const [client1, client2] = clients;
    const [page1, page2] = pages;

    const messageCount = 100;
    const receivedMessages: any[] = [];
    const startTime = Date.now();

    // Listen for messages
    client2.on('chat-message', (message) => {
      receivedMessages.push(message);
    });

    // Send multiple messages rapidly
    for (let i = 0; i < messageCount; i++) {
      await page1.fill('[data-testid="chat-input"]', `Message ${i + 1}`);
      await page1.click('[data-testid="send-message"]');
      await page1.waitForTimeout(10); // Small delay between messages
    }

    // Wait for all messages to be delivered
    await page2.waitForTimeout(5000);

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Verify performance
    expect(receivedMessages.length).toBeGreaterThanOrEqual(messageCount * 0.95); // Allow 5% message loss
    expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds

    // Verify message order
    for (let i = 1; i < receivedMessages.length; i++) {
      expect(receivedMessages[i].timestamp).toBeGreaterThanOrEqual(
        receivedMessages[i - 1].timestamp
      );
    }
  });
});
```

## Performance Metrics

### Latency Requirements
- **Message Delivery**: < 50ms
- **Typing Indicators**: < 100ms
- **Reaction Updates**: < 100ms
- **Edit/Delete Operations**: < 200ms

### Throughput Requirements
- **Concurrent Users**: 10,000+ per channel
- **Messages/Second**: 1,000+ per channel
- **Reactions/Second**: 5,000+ per channel

## Error Handling

### Expected Error Scenarios
1. **Message Too Long**
   - Character limit enforcement
   - Error notification to user
   - Message truncation options

2. **Rate Limiting**
   - Message frequency limits
   - Temporary bans for spam
   - User notifications

3. **Network Disconnection**
   - Message queuing
   - Automatic reconnection
   - Message history sync

## Cross-Browser Testing Matrix

| Browser | Version | Message Delivery | Typing Indicators | Reactions | Moderation |
|---------|---------|------------------|-------------------|-----------|------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Touch Interactions
- Message sending
- Reaction adding
- Typing indicator triggers
- Moderation actions

### Performance
- Message list scrolling
- Reaction rendering
- Typing indicator updates

## RTL Testing

### Arabic Chat Support
- RTL message layout
- Arabic typing indicators
- Right-aligned moderation tools
- Arabic error messages

## Test Execution

### Running Tests
```bash
# Run all live chat tests
pnpm test:e2e --grep "TC-REAL-003"

# Run specific scenarios
pnpm test:e2e --grep "should deliver messages in real-time"
pnpm test:e2e --grep "should handle message editing and deletion"
```

### Performance Testing
```bash
# Run with performance monitoring
pnpm test:e2e --grep "TC-REAL-003" --reporter=html
```

## Validation Criteria

### Success Criteria
- ✅ Real-time message delivery working
- ✅ Typing indicators synchronized
- ✅ Message reactions functional
- ✅ Edit/delete operations working
- ✅ Moderation tools effective
- ✅ Performance within acceptable limits

### Failure Criteria
- ❌ Message delivery delays
- ❌ Typing indicators not syncing
- ❌ Reaction synchronization failures
- ❌ Edit/delete not propagating
- ❌ Moderation bypasses
- ❌ Performance degradation

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-002](./TCREAL002_realtime-progress-updates.md) - Real-time Progress Updates
- [TC-AUTH-008](../auth/TCAUTH008_TwoFactorAuthentication.md) - Two-Factor Authentication

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