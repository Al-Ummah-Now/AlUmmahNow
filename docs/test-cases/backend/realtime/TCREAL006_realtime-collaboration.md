# TC-REAL-006: Real-time Collaboration

## Test Case Information

- **Test ID**: TC-REAL-006
- **Title**: Real-time Collaboration
- **Priority**: Medium
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that real-time collaboration features work correctly including shared document editing, collaborative playlists, and multi-user content creation with conflict resolution.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Collaboration service configured
- Operational transformation (OT) or CRDT implementation
- Test collaboration documents and playlists
- Multiple user accounts with edit permissions

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface CollaborationDocument {
  id: string;
  title: string;
  content: string;
  collaborators: string[];
  version: number;
  lastModified: number;
  type: 'playlist' | 'document' | 'description';
}

interface EditOperation {
  type: 'insert' | 'delete' | 'retain';
  position: number;
  content?: string;
  length?: number;
  userId: string;
  timestamp: number;
}

const testDocuments: CollaborationDocument[] = [
  {
    id: 'doc-001',
    title: 'Collaborative Playlist',
    content: 'Initial playlist description',
    collaborators: ['user-001', 'user-002', 'user-003'],
    version: 1,
    lastModified: Date.now(),
    type: 'playlist'
  }
];
```

## Test Scenarios

### Scenario 1: Shared Document Editing

**Test Steps:**

1. **Setup Collaboration Session**
   ```typescript
   const clients = await Promise.all([
     createWebSocketClient(user1Token),
     createWebSocketClient(user2Token),
     createWebSocketClient(user3Token)
   ]);
   
   // Join collaboration session
   await Promise.all(clients.map(client => 
     client.joinCollaboration('doc-001')
   ));
   
   const edits: EditOperation[] = [];
   clients.forEach((client, index) => {
     client.on('document-edit', (edit) => {
       edits.push({ ...edit, clientId: index });
     });
   });
   ```

2. **Simultaneous Editing**
   ```typescript
   // Client 1 inserts text at position 0
   await clients[0].applyEdit({
     type: 'insert',
     position: 0,
     content: 'Hello ',
     userId: 'user-001'
   });
   
   // Client 2 inserts text at position 6 (after client 1's edit)
   await clients[1].applyEdit({
     type: 'insert',
     position: 6,
     content: 'World',
     userId: 'user-002'
   });
   
   // Wait for synchronization
   await waitFor(() => edits.length >= 6, 3000); // 2 edits × 3 clients
   ```

3. **Verify Conflict Resolution**
   ```typescript
   // Get final document state
   const finalStates = await Promise.all(
     clients.map(client => client.getDocumentState('doc-001'))
   );
   
   // Verify all clients have same state
   const firstState = finalStates[0];
   finalStates.forEach(state => {
     expect(state.content).toBe(firstState.content);
     expect(state.version).toBe(firstState.version);
   });
   
   // Verify expected content
   expect(firstState.content).toBe('Hello World');
   ```

### Scenario 2: Collaborative Playlist Creation

**Test Steps:**

1. **Create Shared Playlist**
   ```typescript
   const playlistClient = await createWebSocketClient(creatorToken);
   const playlist = await playlistClient.createPlaylist({
     title: 'Collaborative Playlist',
     isCollaborative: true,
     collaborators: ['user-002', 'user-003']
   });
   
   expect(playlist.isCollaborative).toBe(true);
   expect(playlist.collaborators.length).toBe(2);
   ```

2. **Add Videos from Multiple Users**
   ```typescript
   const collaboratorClients = await Promise.all([
     createWebSocketClient(user2Token),
     createWebSocketClient(user3Token)
   ]);
   
   // Join playlist collaboration
   await Promise.all(collaboratorClients.map(client =>
     client.joinPlaylistCollaboration(playlist.id)
   ));
   
   const playlistUpdates: any[] = [];
   collaboratorClients.forEach(client => {
     client.on('playlist-update', (update) => {
       playlistUpdates.push(update);
     });
   });
   
   // Add videos from different users
   await collaboratorClients[0].addVideoToPlaylist(playlist.id, 'video-001');
   await collaboratorClients[1].addVideoToPlaylist(playlist.id, 'video-002');
   
   // Wait for updates
   await waitFor(() => playlistUpdates.length >= 4, 3000); // 2 updates × 2 clients
   ```

3. **Verify Playlist Synchronization**
   ```typescript
   const playlistStates = await Promise.all([
     playlistClient.getPlaylist(playlist.id),
     ...collaboratorClients.map(client => client.getPlaylist(playlist.id))
   ]);
   
   // Verify all have same playlist state
   const firstState = playlistStates[0];
   playlistStates.forEach(state => {
     expect(state.videos.length).toBe(firstState.videos.length);
     expect(state.version).toBe(firstState.version);
   });
   
   // Verify videos are present
   expect(firstState.videos).toContain('video-001');
   expect(firstState.videos).toContain('video-002');
   ```

### Scenario 3: Real-time Cursor Tracking

**Test Steps:**

1. **Enable Cursor Tracking**
   ```typescript
   await Promise.all(clients.map(client =>
     client.enableCursorTracking('doc-001')
   ));
   
   const cursorUpdates: any[] = [];
   clients.forEach((client, index) => {
     client.on('cursor-update', (update) => {
       cursorUpdates.push({ ...update, clientId: index });
     });
   });
   ```

2. **Move Cursors**
   ```typescript
   // Move cursor on client 1
   await clients[0].moveCursor('doc-001', { line: 1, column: 5 });
   
   // Move cursor on client 2
   await clients[1].moveCursor('doc-001', { line: 2, column: 10 });
   
   // Wait for cursor updates
   await waitFor(() => cursorUpdates.length >= 4, 2000); // 2 updates × 2 other clients
   ```

3. **Verify Cursor Visibility**
   ```typescript
   // Verify cursor positions are visible to other users
   const client1Cursors = cursorUpdates.filter(u => u.userId === 'user-001');
   const client2Cursors = cursorUpdates.filter(u => u.userId === 'user-002');
   
   expect(client1Cursors.length).toBe(2); // Visible to clients 2 and 3
   expect(client2Cursors.length).toBe(2); // Visible to clients 1 and 3
   
   // Verify cursor positions
   const cursor1 = client1Cursors[0];
   expect(cursor1.position.line).toBe(1);
   expect(cursor1.position.column).toBe(5);
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-006: Real-time Collaboration', () => {
  let clients: WebSocketClient[] = [];
  let pages: Page[] = [];
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    // Create test users and authenticate
    const testUsers = [
      { email: 'collab1@test.com', password: 'testpass123', username: 'CollabUser1' },
      { email: 'collab2@test.com', password: 'testpass123', username: 'CollabUser2' },
      { email: 'collab3@test.com', password: 'testpass123', username: 'CollabUser3' }
    ];

    for (const user of testUsers) {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('/en/login');
      await page.fill('[data-testid="email"]', user.email);
      await page.fill('[data-testid="password"]', user.password);
      await page.click('[data-testid="login-button"]');
      
      const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
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

  test('should handle simultaneous document editing with conflict resolution', async () => {
    const [page1, page2, page3] = pages;
    
    // Create collaborative document
    await page1.goto('/en/collaboration/create');
    await page1.fill('[data-testid="document-title"]', 'Test Document');
    await page1.fill('[data-testid="document-content"]', 'Initial content');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-document"]');

    await page1.waitForSelector('[data-testid="document-editor"]', { timeout: 10000 });
    const documentId = await page1.getAttribute('[data-testid="document-id"]', 'data-document-id');

    // Other users join collaboration
    await page2.goto(`/en/collaboration/${documentId}`);
    await page3.goto(`/en/collaboration/${documentId}`);

    await page2.waitForSelector('[data-testid="document-editor"]');
    await page3.waitForSelector('[data-testid="document-editor"]');

    // Simultaneous editing
    await page1.fill('[data-testid="document-editor"]', 'Hello from user 1');
    await page2.fill('[data-testid="document-editor"]', 'Hello from user 2');
    await page3.fill('[data-testid="document-editor"]', 'Hello from user 3');

    // Wait for synchronization
    await page1.waitForTimeout(3000);

    // Verify conflict resolution
    const content1 = await page1.textContent('[data-testid="document-content"]');
    const content2 = await page2.textContent('[data-testid="document-content"]');
    const content3 = await page3.textContent('[data-testid="document-content"]');

    // All users should see the same final content
    expect(content1).toBe(content2);
    expect(content2).toBe(content3);

    // Verify version consistency
    const version1 = await page1.getAttribute('[data-testid="document-version"]', 'data-version');
    const version2 = await page2.getAttribute('[data-testid="document-version"]', 'data-version');
    const version3 = await page3.getAttribute('[data-testid="document-version"]', 'data-version');

    expect(version1).toBe(version2);
    expect(version2).toBe(version3);
  });

  test('should synchronize collaborative playlist creation', async () => {
    const [page1, page2, page3] = pages;
    
    // Create collaborative playlist
    await page1.goto('/en/playlists/create');
    await page1.fill('[data-testid="playlist-title"]', 'Collaborative Playlist');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-playlist"]');

    await page1.waitForSelector('[data-testid="playlist-editor"]', { timeout: 10000 });
    const playlistId = await page1.getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

    // Other users join collaboration
    await page2.goto(`/en/playlists/${playlistId}/collaborate`);
    await page3.goto(`/en/playlists/${playlistId}/collaborate`);

    await page2.waitForSelector('[data-testid="playlist-editor"]');
    await page3.waitForSelector('[data-testid="playlist-editor"]');

    // Add videos from different users
    await page1.click('[data-testid="add-video-btn"]');
    await page1.fill('[data-testid="video-search"]', 'test video 1');
    await page1.click('[data-testid="video-result-0"]');
    await page1.click('[data-testid="add-to-playlist"]');

    await page2.click('[data-testid="add-video-btn"]');
    await page2.fill('[data-testid="video-search"]', 'test video 2');
    await page2.click('[data-testid="video-result-0"]');
    await page2.click('[data-testid="add-to-playlist"]');

    // Wait for synchronization
    await page3.waitForTimeout(3000);

    // Verify playlist synchronization
    const videos1 = await page1.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos2 = await page2.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos3 = await page3.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );

    expect(videos1.length).toBe(videos2.length);
    expect(videos2.length).toBe(videos3.length);
    expect(videos1.length).toBeGreaterThan(0);
  });

  test('should display real-time cursor positions', async () => {
    const [page1, page2, page3] = pages;
    
    // Create document for cursor testing
    await page1.goto('/en/collaboration/create');
    await page1.fill('[data-testid="document-title"]', 'Cursor Test Document');
    await page1.fill('[data-testid="document-content"]', 'Test content for cursor tracking');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-document"]');

    await page1.waitForSelector('[data-testid="document-editor"]');
    const documentId = await page1.getAttribute('[data-testid="document-id"]', 'data-document-id');

    // Other users join
    await page2.goto(`/en/collaboration/${documentId}`);
    await page3.goto(`/en/collaboration/${documentId}`);

    await page2.waitForSelector('[data-testid="document-editor"]');
    await page3.waitForSelector('[data-testid="document-editor"]');

    // Move cursors to different positions
    await page1.click('[data-testid="document-editor"]', { position: { x: 100, y: 50 } });
    await page2.click('[data-testid="document-editor"]', { position: { x: 200, y: 100 } });
    await page3.click('[data-testid="document-editor"]', { position: { x: 300, y: 150 } });

    // Wait for cursor updates
    await page1.waitForTimeout(2000);

    // Verify cursor visibility
    const cursors1 = await page1.$$eval('[data-testid="user-cursor"]', els => 
      els.map(el => ({
        userId: el.getAttribute('data-user-id'),
        position: el.getAttribute('data-position')
      }))
    );

    // Should see cursors from other 2 users
    expect(cursors1.length).toBe(2);

    // Verify cursor positions are different
    const positions = cursors1.map(c => c.position);
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(2);
  });

  test('should handle user presence and online status', async () => {
    const [page1, page2, page3] = pages;
    
    // Create collaboration session
    await page1.goto('/en/collaboration/create');
    await page1.fill('[data-testid="document-title"]', 'Presence Test Document');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-document"]');

    await page1.waitForSelector('[data-testid="document-editor"]');
    const documentId = await page1.getAttribute('[data-testid="document-id"]', 'data-document-id');

    // Other users join
    await page2.goto(`/en/collaboration/${documentId}`);
    await page3.goto(`/en/collaboration/${documentId}`);

    // Wait for presence updates
    await page1.waitForTimeout(2000);

    // Verify online users display
    const onlineUsers1 = await page1.$$eval('[data-testid="online-user"]', els => 
      els.map(el => el.getAttribute('data-username'))
    );

    expect(onlineUsers1.length).toBe(2); // Should show 2 other users
    expect(onlineUsers1).toContain('CollabUser2');
    expect(onlineUsers1).toContain('CollabUser3');

    // User 3 leaves
    await page3.close();

    // Wait for presence update
    await page1.waitForTimeout(2000);

    // Verify user removal
    const onlineUsersAfterLeave = await page1.$$eval('[data-testid="online-user"]', els => 
      els.map(el => el.getAttribute('data-username'))
    );

    expect(onlineUsersAfterLeave.length).toBe(1);
    expect(onlineUsersAfterLeave).toContain('CollabUser2');
    expect(onlineUsersAfterLeave).not.toContain('CollabUser3');
  });

  test('should maintain collaboration under network interruptions', async () => {
    const [page1, page2] = pages;
    
    // Create collaboration session
    await page1.goto('/en/collaboration/create');
    await page1.fill('[data-testid="document-title"]', 'Network Test Document');
    await page1.fill('[data-testid="document-content"]', 'Initial content');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-document"]');

    await page1.waitForSelector('[data-testid="document-editor"]');
    const documentId = await page1.getAttribute('[data-testid="document-id"]', 'data-document-id');

    // User 2 joins
    await page2.goto(`/en/collaboration/${documentId}`);
    await page2.waitForSelector('[data-testid="document-editor"]');

    // Simulate network interruption for user 2
    await page2.evaluate(() => {
      window.navigator.onLine = false;
      window.dispatchEvent(new Event('offline'));
    });

    // User 1 makes edits while user 2 is offline
    await page1.fill('[data-testid="document-editor"]', 'Edit during offline period');
    await page1.waitForTimeout(1000);

    // Restore network for user 2
    await page2.evaluate(() => {
      window.navigator.onLine = true;
      window.dispatchEvent(new Event('online'));
    });

    // Wait for reconnection and sync
    await page2.waitForTimeout(3000);

    // Verify synchronization after reconnection
    const content1 = await page1.textContent('[data-testid="document-content"]');
    const content2 = await page2.textContent('[data-testid="document-content"]');

    expect(content1).toBe(content2);
    expect(content1).toContain('Edit during offline period');
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
- **Edit Propagation**: < 100ms
- **Cursor Updates**: < 50ms
- **Presence Updates**: < 200ms
- **Conflict Resolution**: < 500ms

### Throughput Requirements
- **Concurrent Editors**: 100+ per document
- **Edits/Second**: 50+ per document
- **Cursor Updates**: 1000+/second
- **Active Documents**: 10,000+

## Error Handling

### Expected Error Scenarios
1. **Edit Conflicts**
   - Operational transformation
   - Conflict resolution
   - User notification

2. **Network Partition**
   - Edit buffering
   - Reconciliation on reconnect
   - State synchronization

3. **Permission Issues**
   - Access denied handling
   - Role-based permissions
   - Audit logging

## Cross-Browser Testing Matrix

| Browser | Version | Document Editing | Playlist Sync | Cursor Tracking | Presence |
|---------|---------|------------------|---------------|-----------------|----------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Touch Collaboration
- Touch editing
- Mobile cursor tracking
- Gesture-based interactions
- Responsive UI

### Performance
- Battery efficiency
- Memory usage
- Network optimization
- Touch latency

## RTL Testing

### Arabic Collaboration
- RTL text editing
- Arabic cursor positions
- Right-aligned collaboration UI
- Arabic conflict messages

## Test Execution

### Running Tests
```bash
# Run all collaboration tests
pnpm test:e2e --grep "TC-REAL-006"

# Run specific scenarios
pnpm test:e2e --grep "should handle simultaneous document editing"
pnpm test:e2e --grep "should synchronize collaborative playlist"
```

## Validation Criteria

### Success Criteria
- ✅ Real-time editing working
- ✅ Conflict resolution functional
- ✅ Playlist synchronization accurate
- ✅ Cursor tracking visible
- ✅ Presence management working
- ✅ Network recovery handled

### Failure Criteria
- ❌ Edit propagation failures
- ❌ Conflict resolution errors
- ❌ Synchronization inconsistencies
- ❌ Cursor tracking failures
- ❌ Presence management issues
- ❌ Network recovery failures

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-002](./TCREAL002_realtime-progress-updates.md) - Real-time Progress Updates
- [TC-CHAN-003](../channel-management/TCCHAN003_channel-content-management.md) - Channel Content Management

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