# TC-REAL-009: Multi-user Synchronization

## Test Case Information

- **Test ID**: TC-REAL-009
- **Title**: Multi-user Synchronization
- **Priority**: High
- **Type**: Realtime
- **Category**: Realtime Features
- **Estimated Duration**: 25 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that multi-user synchronization works correctly across concurrent operations, ensuring data consistency, conflict resolution, and proper state management for collaborative features.

## Test Prerequisites

- WebSocket server running at `wss://ws.alummahnow.net`
- Multi-user synchronization service
- Conflict resolution algorithms
- State management system
- Test user accounts with collaboration permissions

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface SyncOperation {
  id: string;
  userId: string;
  type: 'create' | 'update' | 'delete' | 'move';
  entityType: 'video' | 'playlist' | 'comment' | 'channel';
  entityId: string;
  data: any;
  timestamp: number;
  version: number;
}

interface ConflictResolution {
  strategy: 'last-write-wins' | 'operational-transform' | 'crdt' | 'manual';
  resolvedBy: string;
  resolution: any;
  conflicts: SyncOperation[];
}

const testSyncOperations: SyncOperation[] = [
  {
    id: 'sync-001',
    userId: 'user-001',
    type: 'update',
    entityType: 'playlist',
    entityId: 'playlist-001',
    data: { title: 'Updated Playlist Title' },
    timestamp: Date.now(),
    version: 2
  }
];
```

## Test Scenarios

### Scenario 1: Concurrent Playlist Editing

**Test Steps:**

1. **Setup Multi-user Session**
   ```typescript
   const users = await Promise.all([
     createWebSocketClient(user1Token),
     createWebSocketClient(user2Token),
     createWebSocketClient(user3Token)
   ]);
   
   // Join shared playlist
   const playlistId = 'shared-playlist-001';
   await Promise.all(users.map(user => 
     user.joinPlaylistSync(playlistId)
   ));
   
   const syncEvents: SyncOperation[] = [];
   users.forEach((user, index) => {
     user.on('sync-event', (event) => {
       syncEvents.push({ ...event, userId: user.userId });
     });
   });
   ```

2. **Simultaneous Edits**
   ```typescript
   // User 1 updates title
   await users[0].syncOperation({
     type: 'update',
     entityType: 'playlist',
     entityId: playlistId,
     data: { title: 'Title by User 1' }
   });
   
   // User 2 updates description (simultaneous)
   await users[1].syncOperation({
     type: 'update',
     entityType: 'playlist',
     entityId: playlistId,
     data: { description: 'Description by User 2' }
   });
   
   // User 3 adds video (simultaneous)
   await users[2].syncOperation({
     type: 'update',
     entityType: 'playlist',
     entityId: playlistId,
     data: { addVideo: 'video-001' }
   });
   
   // Wait for synchronization
   await waitFor(() => syncEvents.length >= 9, 5000); // 3 ops × 3 users
   ```

3. **Verify Synchronization**
   ```typescript
   // Get final state from all users
   const finalStates = await Promise.all(
     users.map(user => user.getPlaylistState(playlistId))
   );
   
   // Verify all users have consistent state
   const firstState = finalStates[0];
   finalStates.forEach(state => {
     expect(state.title).toBe(firstState.title);
     expect(state.description).toBe(firstState.description);
     expect(state.videos).toEqual(firstState.videos);
     expect(state.version).toBe(firstState.version);
   });
   
   // Verify all operations applied
   expect(firstState.title).toBe('Title by User 1');
   expect(firstState.description).toBe('Description by User 2');
   expect(firstState.videos).toContain('video-001');
   ```

### Scenario 2: Conflict Resolution

**Test Steps:**

1. **Create Conflict Scenario**
   ```typescript
   const conflictUsers = await Promise.all([
     createWebSocketClient(user4Token),
     createWebSocketClient(user5Token)
   ]);
   
   await Promise.all(conflictUsers.map(user => 
     user.joinPlaylistSync('conflict-playlist-001')
   ));
   
   const conflicts: ConflictResolution[] = [];
   conflictUsers.forEach(user => {
     user.on('conflict-detected', (conflict) => {
       conflicts.push(conflict);
     });
   });
   ```

2. **Generate Conflicting Operations**
   ```typescript
   // Both users try to update same field simultaneously
   await Promise.all([
     conflictUsers[0].syncOperation({
       type: 'update',
       entityType: 'playlist',
       entityId: 'conflict-playlist-001',
       data: { title: 'Title from User 4' }
     }),
     conflictUsers[1].syncOperation({
       type: 'update',
       entityType: 'playlist',
       entityId: 'conflict-playlist-001',
       data: { title: 'Title from User 5' }
     })
   ]);
   
   // Wait for conflict detection
   await waitFor(() => conflicts.length > 0, 3000);
   ```

3. **Verify Conflict Resolution**
   ```typescript
   const conflict = conflicts[0];
   expect(conflict.strategy).toBeDefined();
   expect(conflict.conflicts.length).toBe(2);
   
   // Verify resolution applied
   const resolvedStates = await Promise.all(
     conflictUsers.map(user => user.getPlaylistState('conflict-playlist-001'))
   );
   
   // All users should have same resolved state
   const resolvedState = resolvedStates[0];
   resolvedStates.forEach(state => {
     expect(state.title).toBe(resolvedState.title);
     expect(state.version).toBe(resolvedState.version);
   });
   
   // Verify conflict was resolved (not both titles)
   expect(resolvedState.title).not.toBe('Title from User 4');
   expect(resolvedState.title).not.toBe('Title from User 5');
   ```

### Scenario 3: Large-scale Synchronization

**Test Steps:**

1. **Setup Large User Group**
   ```typescript
   const largeGroup = [];
   for (let i = 0; i < 50; i++) {
     const user = await createWebSocketClient(`user-${i}-token`);
     await user.connect();
     await user.joinPlaylistSync('large-sync-playlist');
     largeGroup.push(user);
   }
   
   const largeSyncEvents: SyncOperation[] = [];
   largeGroup.forEach(user => {
     user.on('sync-event', (event) => {
       largeSyncEvents.push(event);
     });
   });
   ```

2. **Generate High Volume Operations**
   ```typescript
   const startTime = Date.now();
   
   // Each user performs multiple operations
   const operations = largeGroup.map(async (user, index) => {
     for (let i = 0; i < 5; i++) {
       await user.syncOperation({
         type: 'update',
         entityType: 'playlist',
         entityId: 'large-sync-playlist',
         data: { 
           [`user_${index}_op_${i}`]: `Operation ${i} by user ${index}`,
           timestamp: Date.now()
         }
       });
       await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
     }
   });
   
   await Promise.all(operations);
   const endTime = Date.now();
   ```

3. **Verify Large-scale Sync**
   ```typescript
   // Wait for all operations to propagate
   await new Promise(resolve => setTimeout(resolve, 10000));
   
   // Verify performance
   expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30s
   
   // Verify final consistency
   const finalStates = await Promise.all(
     largeGroup.slice(0, 10).map(user => // Sample 10 users
       user.getPlaylistState('large-sync-playlist')
     )
   );
   
   const referenceState = finalStates[0];
   finalStates.forEach(state => {
     expect(state.version).toBe(referenceState.version);
     expect(Object.keys(state.data).length).toBeGreaterThan(200); // 50 users × 5 ops
   });
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page, Browser } from '@playwright/test';
import { WebSocketClient } from '../helpers/websocket-client';
import { TestDataFactory } from '../helpers/test-data-factory';

test.describe('TC-REAL-009: Multi-user Synchronization', () => {
  let users: WebSocketClient[] = [];
  let pages: Page[] = [];
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    
    // Create test users
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('/en/login');
      await page.fill('[data-testid="email"]', `syncuser${i + 1}@test.com`);
      await page.fill('[data-testid="password"]', 'testpass123');
      await page.click('[data-testid="login-button"]');
      
      const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
      const wsClient = new WebSocketClient(authToken!);
      await wsClient.connect();
      
      users.push(wsClient);
      pages.push(page);
    }
  });

  test.afterAll(async () => {
    for (const user of users) {
      await user.disconnect();
    }
    for (const page of pages) {
      await page.close();
    }
  });

  test('should synchronize concurrent playlist edits across multiple users', async () => {
    const [page1, page2, page3] = pages;
    
    // Create shared playlist
    await page1.goto('/en/playlists/create');
    await page1.fill('[data-testid="playlist-title"]', 'Shared Sync Playlist');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-playlist"]');

    await page1.waitForSelector('[data-testid="playlist-editor"]', { timeout: 10000 });
    const playlistId = await page1.getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

    // Other users join collaboration
    await page2.goto(`/en/playlists/${playlistId}/collaborate`);
    await page3.goto(`/en/playlists/${playlistId}/collaborate`);

    await page2.waitForSelector('[data-testid="playlist-editor"]');
    await page3.waitForSelector('[data-testid="playlist-editor"]');

    // Simultaneous edits
    await Promise.all([
      page1.fill('[data-testid="playlist-title"]', 'Title by User 1'),
      page2.fill('[data-testid="playlist-description"]', 'Description by User 2'),
      page3.click('[data-testid="add-video-btn"]')
    ]);

    await page3.fill('[data-testid="video-search"]', 'test video');
    await page3.click('[data-testid="video-result-0"]');
    await page3.click('[data-testid="add-to-playlist"]');

    // Wait for synchronization
    await page1.waitForTimeout(5000);

    // Verify synchronization
    const title1 = await page1.textContent('[data-testid="playlist-title"]');
    const title2 = await page2.textContent('[data-testid="playlist-title"]');
    const title3 = await page3.textContent('[data-testid="playlist-title"]');

    const desc1 = await page1.textContent('[data-testid="playlist-description"]');
    const desc2 = await page2.textContent('[data-testid="playlist-description"]');
    const desc3 = await page3.textContent('[data-testid="playlist-description"]');

    const videos1 = await page1.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos2 = await page2.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos3 = await page3.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );

    // Verify all users see same state
    expect(title1).toBe(title2);
    expect(title2).toBe(title3);
    expect(desc1).toBe(desc2);
    expect(desc2).toBe(desc3);
    expect(videos1).toEqual(videos2);
    expect(videos2).toEqual(videos3);

    // Verify edits applied
    expect(title1).toBe('Title by User 1');
    expect(desc1).toBe('Description by User 2');
    expect(videos1.length).toBeGreaterThan(0);
  });

  test('should resolve conflicts when multiple users edit same content', async () => {
    const [page1, page2] = pages;
    
    // Create playlist for conflict testing
    await page1.goto('/en/playlists/create');
    await page1.fill('[data-testid="playlist-title"]', 'Conflict Test Playlist');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-playlist"]');

    await page1.waitForSelector('[data-testid="playlist-editor"]');
    const conflictPlaylistId = await page1.getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

    // Second user joins
    await page2.goto(`/en/playlists/${conflictPlaylistId}/collaborate`);
    await page2.waitForSelector('[data-testid="playlist-editor"]');

    // Generate conflicting edits (same field)
    await Promise.all([
      page1.fill('[data-testid="playlist-title"]', 'Title from User 1'),
      page2.fill('[data-testid="playlist-title"]', 'Title from User 2')
    ]);

    // Wait for conflict resolution
    await page1.waitForTimeout(3000);

    // Verify conflict resolution
    const resolvedTitle1 = await page1.textContent('[data-testid="playlist-title"]');
    const resolvedTitle2 = await page2.textContent('[data-testid="playlist-title"]');

    // Both users should see same resolved title
    expect(resolvedTitle1).toBe(resolvedTitle2);

    // Title should be resolved (not both original titles)
    expect(resolvedTitle1).not.toBe('Title from User 1');
    expect(resolvedTitle1).not.toBe('Title from User 2');

    // Check for conflict notification
    const conflictNotice1 = await page1.isVisible('[data-testid="conflict-resolved-notice"]');
    const conflictNotice2 = await page2.isVisible('[data-testid="conflict-resolved-notice"]');

    expect(conflictNotice1 || conflictNotice2).toBe(true);
  });

  test('should handle large-scale synchronization with many users', async () => {
    // Create additional users for large-scale test
    const largeGroupUsers: WebSocketClient[] = [];
    const largeGroupPages: Page[] = [];

    for (let i = 0; i < 10; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('/en/login');
      await page.fill('[data-testid="email"]', `largeuser${i + 1}@test.com`);
      await page.fill('[data-testid="password"]', 'testpass123');
      await page.click('[data-testid="login-button"]');
      
      const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
      const wsClient = new WebSocketClient(authToken!);
      await wsClient.connect();
      
      largeGroupUsers.push(wsClient);
      largeGroupPages.push(page);
    }

    try {
      // Create large sync playlist
      await pages[0].goto('/en/playlists/create');
      await pages[0].fill('[data-testid="playlist-title"]', 'Large Scale Sync Playlist');
      await pages[0].check('[data-testid="enable-collaboration"]');
      await pages[0].click('[data-testid="create-playlist"]');

      await pages[0].waitForSelector('[data-testid="playlist-editor"]');
      const largePlaylistId = await pages[0].getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

      // All users join
      const joinPromises = largeGroupPages.map(page => 
        page.goto(`/en/playlists/${largePlaylistId}/collaborate`)
      );
      await Promise.all(joinPromises);

      // Wait for all to join
      await pages[0].waitForTimeout(2000);

      const startTime = Date.now();

      // Each user performs operations
      const operations = largeGroupPages.map(async (page, index) => {
        await page.waitForSelector('[data-testid="playlist-editor"]');
        
        for (let i = 0; i < 3; i++) {
          await page.fill(`[data-testid="custom-field-${index}-${i}"]`, `User ${index} Operation ${i}`);
          await page.click('[data-testid="add-custom-field"]');
          await page.waitForTimeout(Math.random() * 200);
        }
      });

      await Promise.all(operations);
      const endTime = Date.now();

      // Wait for synchronization
      await pages[0].waitForTimeout(5000);

      // Verify performance
      expect(endTime - startTime).toBeLessThan(20000); // Should complete within 20s

      // Verify consistency (sample a few users)
      const sampleStates = await Promise.all([
        pages[0].evaluate(() => window.getPlaylistState()),
        largeGroupPages[0].evaluate(() => window.getPlaylistState()),
        largeGroupPages[5].evaluate(() => window.getPlaylistState())
      ]);

      const referenceState = sampleStates[0];
      sampleStates.forEach(state => {
        expect(state.version).toBe(referenceState.version);
        expect(state.customFields.length).toBeGreaterThan(20); // 10 users × 3 ops
      });

    } finally {
      // Cleanup large group
      for (const user of largeGroupUsers) {
        await user.disconnect();
      }
      for (const page of largeGroupPages) {
        await page.close();
      }
    }
  });

  test('should maintain synchronization during network interruptions', async () => {
    const [page1, page2, page3] = pages;
    
    // Create playlist
    await page1.goto('/en/playlists/create');
    await page1.fill('[data-testid="playlist-title"]', 'Network Sync Test');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-playlist"]');

    await page1.waitForSelector('[data-testid="playlist-editor"]');
    const networkPlaylistId = await page1.getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

    // Other users join
    await page2.goto(`/en/playlists/${networkPlaylistId}/collaborate`);
    await page3.goto(`/en/playlists/${networkPlaylistId}/collaborate`);

    await page2.waitForSelector('[data-testid="playlist-editor"]');
    await page3.waitForSelector('[data-testid="playlist-editor"]');

    // User 1 makes changes while others are offline
    await page2.evaluate(() => {
      window.navigator.onLine = false;
      window.dispatchEvent(new Event('offline'));
    });
    await page3.evaluate(() => {
      window.navigator.onLine = false;
      window.dispatchEvent(new Event('offline'));
    });

    // User 1 makes changes
    await page1.fill('[data-testid="playlist-description"]', 'Changes during offline period');
    await page1.click('[data-testid="add-video-btn"]');
    await page1.fill('[data-testid="video-search"]', 'offline test video');
    await page1.click('[data-testid="video-result-0"]');
    await page1.click('[data-testid="add-to-playlist"]');

    await page1.waitForTimeout(2000);

    // Restore network for other users
    await page2.evaluate(() => {
      window.navigator.onLine = true;
      window.dispatchEvent(new Event('online'));
    });
    await page3.evaluate(() => {
      window.navigator.onLine = true;
      window.dispatchEvent(new Event('online'));
    });

    // Wait for reconnection and sync
    await page2.waitForTimeout(5000);

    // Verify synchronization after reconnection
    const desc1 = await page1.textContent('[data-testid="playlist-description"]');
    const desc2 = await page2.textContent('[data-testid="playlist-description"]');
    const desc3 = await page3.textContent('[data-testid="playlist-description"]');

    const videos1 = await page1.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos2 = await page2.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );
    const videos3 = await page3.$$eval('[data-testid="playlist-video"]', els => 
      els.map(el => el.getAttribute('data-video-id'))
    );

    expect(desc1).toBe(desc2);
    expect(desc2).toBe(desc3);
    expect(videos1).toEqual(videos2);
    expect(videos2).toEqual(videos3);
    expect(desc1).toBe('Changes during offline period');
    expect(videos1.length).toBeGreaterThan(0);
  });

  test('should provide synchronization status and progress feedback', async () => {
    const [page1, page2] = pages;
    
    // Create playlist
    await page1.goto('/en/playlists/create');
    await page1.fill('[data-testid="playlist-title"]', 'Status Test Playlist');
    await page1.check('[data-testid="enable-collaboration"]');
    await page1.click('[data-testid="create-playlist"]');

    await page1.waitForSelector('[data-testid="playlist-editor"]');
    const statusPlaylistId = await page1.getAttribute('[data-testid="playlist-id"]', 'data-playlist-id');

    // User 2 joins
    await page2.goto(`/en/playlists/${statusPlaylistId}/collaborate`);
    await page2.waitForSelector('[data-testid="playlist-editor"]');

    // Monitor sync status
    const syncStatus1 = await page1.isVisible('[data-testid="sync-status"]');
    const syncStatus2 = await page2.isVisible('[data-testid="sync-status"]');

    expect(syncStatus1 || syncStatus2).toBe(true);

    // Make changes and monitor progress
    await page1.fill('[data-testid="playlist-description"]', 'Testing sync status');

    // Wait for sync completion
    await page1.waitForSelector('[data-testid="sync-complete"]', { timeout: 5000 });

    // Verify sync status indicators
    const syncComplete1 = await page1.isVisible('[data-testid="sync-complete"]');
    const syncComplete2 = await page2.isVisible('[data-testid="sync-complete"]');

    expect(syncComplete1 || syncComplete2).toBe(true);

    // Check sync details
    const syncDetails = await page1.$$eval('[data-testid="sync-detail"]', els => 
      els.map(el => el.textContent)
    );

    expect(syncDetails.some(detail => detail?.includes('synchronized'))).toBe(true);
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
- **Sync Propagation**: < 200ms
- **Conflict Detection**: < 500ms
- **Conflict Resolution**: < 1s
- **Large-scale Sync**: < 5s

### Throughput Requirements
- **Concurrent Users**: 1,000+ per session
- **Operations/Second**: 500+
- **Conflict Resolution**: 100/second
- **Sync Sessions**: 10,000+

## Error Handling

### Expected Error Scenarios
1. **Sync Conflicts**
   - Automatic resolution
   - Manual intervention
   - User notification

2. **Network Partition**
   - Operation buffering
   - Reconciliation
   - State recovery

3. **Version Conflicts**
   - Version merging
   - Conflict resolution
   - State validation

## Cross-Browser Testing Matrix

| Browser | Version | Concurrent Edits | Conflict Resolution | Large Scale | Network Recovery |
|---------|---------|------------------|-------------------|-------------|------------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Sync
- Touch-based editing
- Mobile conflict resolution
- Responsive sync UI
- Battery optimization

### Performance
- Memory efficiency
- Network optimization
- Background sync
- Touch latency

## RTL Testing

### Arabic Synchronization
- RTL conflict resolution
- Arabic text merging
- Right-aligned sync UI
- Arabic notifications

## Test Execution

### Running Tests
```bash
# Run all synchronization tests
pnpm test:e2e --grep "TC-REAL-009"

# Run specific scenarios
pnpm test:e2e --grep "should synchronize concurrent playlist edits"
pnpm test:e2e --grep "should resolve conflicts"
```

## Validation Criteria

### Success Criteria
- ✅ Concurrent edits synchronized
- ✅ Conflicts resolved properly
- ✅ Large-scale sync working
- ✅ Network recovery handled
- ✅ Status feedback provided
- ✅ Performance within limits

### Failure Criteria
- ❌ Synchronization failures
- ❌ Conflict resolution errors
- ❌ Large-scale performance issues
- ❌ Network recovery failures
- ❌ No status feedback
- ❌ Performance degradation

## Related Test Cases

- [TC-REAL-001](./TCREAL001_websocket-connection-management.md) - WebSocket Connection Management
- [TC-REAL-006](./TCREAL006_realtime-collaboration.md) - Real-time Collaboration
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