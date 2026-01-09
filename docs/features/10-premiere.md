# Premiere Feature Implementation Plan

## Overview

The Premiere Feature allows creators to schedule video releases with a live countdown and community chat experience, similar to YouTube Premieres. This creates anticipation and brings viewers together for a shared watching experience.

## Feature Requirements

Based on the YouTube Feature Comparison document:
- **Scheduled video with live countdown** - Videos can be scheduled to premiere at a specific time
- **Live chat during premiere** - Real-time chat functionality during the premiere event
- **Countdown timer on video page** - Visual countdown showing time until premiere
- **Public watch page before premiere** - Shareable page accessible before the video goes live
- **Notification to subscribers when premiere starts** - Alert system for subscribed users
- **Shareable premiere link before launch** - Unique URL for promoting the premiere

## Architecture Design

### 1. Data Model

#### 1.1 Video Model Extensions

```typescript
// packages/shared-types/src/video.ts additions
export interface PremiereMetadata {
  isScheduled: boolean;           // Video is scheduled (not just premiere)
  scheduledPublishDate?: string;   // ISO 8601 datetime
  isPremiere: boolean;             // Is a premiere (vs regular scheduled)
  premiereStartedAt?: string;      // When premiere actually started
  premiereEndedAt?: string;        // When premiere ended
  premiereStatus?: PremiereStatus; // Current premiere state
  premiereCountdownStart?: string; // When countdown page becomes available
  premiereNotificationSent?: boolean; // Track if notifications were sent
}

export type PremiereStatus =
  | 'scheduled'      // Premiere scheduled, countdown not started
  | 'countdown'      // Countdown page is live
  | 'starting_soon'  // Last 5 minutes before premiere
  | 'live'          // Premiere is happening now
  | 'ended'         // Premiere has ended, normal video now
  | 'cancelled';    // Premiere was cancelled

export interface VideoObject extends Timestamps {
  // ... existing fields ...
  premiere?: PremiereMetadata;
}
```

#### 1.2 Chat Message Model

```typescript
// packages/shared-types/src/premiere.ts (new file)
export interface PremiereChatMessage {
  id: string;
  videoId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  message: string;
  timestamp: string;
  isCreator?: boolean;     // Creator's messages highlighted
  isModerator?: boolean;   // Moderator badge
  isSubscriber?: boolean;  // Subscriber badge
  isPinned?: boolean;      // Pinned message
  replyTo?: string;        // Reply to another message ID
}

export interface PremiereViewerMetrics {
  videoId: string;
  currentViewers: number;   // Currently watching
  peakViewers: number;      // Peak concurrent viewers
  totalViews: number;       // Total unique viewers
  chatMessages: number;     // Total chat messages
  timestamp: string;
}
```

### 2. Countdown Page Architecture

#### 2.1 Page Structure

```
apps/web/src/app/[locale]/premiere/[id]/page.tsx
```

**Components:**
- **CountdownTimer** - Main countdown display (days, hours, minutes, seconds)
- **PremiereHero** - Video thumbnail, title, channel info
- **NotifyButton** - "Set Reminder" / "Notification Set" toggle
- **ShareButtons** - Social media share options
- **PremiereChat** - Pre-premiere chat (optional)
- **VideoMetadata** - Description, tags, scheduled time
- **RelatedVideos** - Other videos from channel

#### 2.2 Countdown Logic

```typescript
// apps/web/src/lib/premiere/countdown.ts
export class PremiereCountdown {
  private premiereTime: Date;
  private updateCallback: (time: CountdownTime) => void;
  private intervalId?: NodeJS.Timeout;

  constructor(premiereTime: string, onUpdate: (time: CountdownTime) => void) {
    this.premiereTime = new Date(premiereTime);
    this.updateCallback = onUpdate;
  }

  start() {
    this.update();
    this.intervalId = setInterval(() => this.update(), 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private update() {
    const now = new Date();
    const diff = this.premiereTime.getTime() - now.getTime();

    if (diff <= 0) {
      this.updateCallback({ expired: true });
      this.stop();
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    this.updateCallback({ days, hours, minutes, seconds, expired: false });
  }
}

interface CountdownTime {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  expired: boolean;
}
```

### 3. WebSocket Integration for Live Chat

#### 3.1 WebSocket Channel Structure

```typescript
// Channel naming for premieres
const premiereChannels = {
  // Main premiere chat channel
  chat: `premiere:${videoId}:chat`,

  // Viewer count updates
  viewers: `premiere:${videoId}:viewers`,

  // System announcements (premiere starting, etc.)
  system: `premiere:${videoId}:system`,

  // Creator/moderator actions
  moderation: `premiere:${videoId}:mod`
};
```

#### 3.2 WebSocket Server Extensions

```typescript
// apps/websocket-server/src/premiere-handler.ts (new file)
export class PremiereHandler {
  private activePremiere: Map<string, PremiereSession> = new Map();

  async handlePremiereMessage(
    sessionId: string,
    videoId: string,
    message: PremiereChatMessage,
    channelManager: ChannelManager
  ) {
    // Validate user can send message
    const session = channelManager.getSession(sessionId);
    if (!session) return;

    // Rate limiting (more strict during premiere)
    if (!this.checkRateLimit(session.userId, 30)) { // 30 messages per minute
      throw new Error('Rate limit exceeded');
    }

    // Store message in R2 for replay
    await this.storeChatMessage(videoId, message);

    // Broadcast to all viewers
    const subscribers = channelManager.getChannelSubscribers(
      `premiere:${videoId}:chat`
    );

    for (const subscriberId of subscribers) {
      await this.sendToClient(subscriberId, {
        type: 'premiere_chat',
        videoId,
        message
      });
    }
  }

  async updateViewerCount(videoId: string, delta: number) {
    const premiere = this.activePremiere.get(videoId);
    if (!premiere) return;

    premiere.currentViewers += delta;
    premiere.peakViewers = Math.max(premiere.peakViewers, premiere.currentViewers);

    // Broadcast viewer count update
    await this.broadcast(`premiere:${videoId}:viewers`, {
      type: 'viewer_count',
      current: premiere.currentViewers,
      peak: premiere.peakViewers
    });
  }
}
```

### 4. Notification System

#### 4.1 Notification Triggers

```typescript
// apps/processor/src/premiere-notifications.ts (new file)
export class PremiereNotificationService {
  async scheduleNotifications(videoId: string, premiereTime: Date) {
    // Schedule notifications at different intervals
    const notifications = [
      { time: -24 * 60, message: 'Premiere tomorrow' },      // 24 hours before
      { time: -60, message: 'Premiere in 1 hour' },         // 1 hour before
      { time: -15, message: 'Premiere in 15 minutes' },     // 15 minutes before
      { time: -5, message: 'Premiere starting soon' },      // 5 minutes before
      { time: 0, message: 'Premiere starting now!' }        // At premiere time
    ];

    for (const notification of notifications) {
      const notifyTime = new Date(premiereTime.getTime() + notification.time * 60000);
      await this.scheduleNotification(videoId, notifyTime, notification.message);
    }
  }

  async sendPremiereNotification(videoId: string, message: string) {
    // Get all subscribers for the channel
    const video = await this.getVideo(videoId);
    const subscribers = await this.getChannelSubscribers(video.channelId);

    // Send WebSocket notifications
    for (const userId of subscribers) {
      await notifyUser(
        this.websocketUrl,
        userId,
        {
          id: generateId(),
          title: `Premiere: ${video.title}`,
          message,
          type: 'new_video',
          actionUrl: `/premiere/${videoId}`
        }
      );
    }

    // Queue email notifications (future feature)
    await this.queueEmailNotifications(subscribers, video, message);
  }
}
```

#### 4.2 Notification Preferences

```typescript
// packages/shared-types/src/user.ts additions
export interface NotificationPreferences {
  premieres: {
    enabled: boolean;
    webPush: boolean;      // Browser notifications
    email: boolean;         // Email notifications
    inApp: boolean;         // In-app notifications
    advanceNotice: number;  // Minutes before premiere
  };
  // ... other notification types
}
```

### 5. Video Player Modifications

#### 5.1 Premiere Mode Player

```typescript
// apps/web/src/components/VideoPlayer/PremierePlayer.tsx (new file)
export function PremierePlayer({
  video,
  premiereData,
  onPremiereStart
}: PremierePlayerProps) {
  const [status, setStatus] = useState<PremiereStatus>(premiereData.premiereStatus);
  const [countdown, setCountdown] = useState<CountdownTime>();

  useEffect(() => {
    if (status === 'countdown' || status === 'starting_soon') {
      // Show countdown overlay
      const countdown = new PremiereCountdown(
        premiereData.scheduledPublishDate!,
        (time) => {
          setCountdown(time);
          if (time.expired) {
            setStatus('live');
            onPremiereStart();
          }
        }
      );
      countdown.start();
      return () => countdown.stop();
    }
  }, [status]);

  if (status === 'countdown' || status === 'starting_soon') {
    return (
      <div className="premiere-player-container">
        <PremiereCountdownOverlay
          countdown={countdown}
          thumbnail={video.thumbnailUrl}
          title={video.title}
        />
        <PremiereChatPanel videoId={video.id} />
      </div>
    );
  }

  if (status === 'live') {
    return (
      <div className="premiere-live-container">
        <VideoPlayer
          video={video}
          premiereMode={true}
          disableSeeking={true} // No seeking during premiere
          showViewerCount={true}
        />
        <LiveChatPanel
          videoId={video.id}
          isCreator={isVideoCreator}
          isModerator={isChannelModerator}
        />
      </div>
    );
  }

  // Normal video player after premiere ends
  return <VideoPlayer video={video} />;
}
```

#### 5.2 Chat Integration

```typescript
// apps/web/src/components/Premiere/LiveChatPanel.tsx (new file)
export function LiveChatPanel({ videoId, isCreator, isModerator }: ChatPanelProps) {
  const [messages, setMessages] = useState<PremiereChatMessage[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const ws = useWebSocket();

  useEffect(() => {
    // Subscribe to premiere channels
    ws.subscribe(`premiere:${videoId}:chat`);
    ws.subscribe(`premiere:${videoId}:viewers`);

    // Handle incoming messages
    ws.on('premiere_chat', (data) => {
      setMessages(prev => [...prev, data.message].slice(-100)); // Keep last 100
    });

    ws.on('viewer_count', (data) => {
      setViewerCount(data.current);
    });

    return () => {
      ws.unsubscribe(`premiere:${videoId}:chat`);
      ws.unsubscribe(`premiere:${videoId}:viewers`);
    };
  }, [videoId]);

  const sendMessage = async (text: string) => {
    await ws.send('premiere_message', {
      videoId,
      message: text
    });
  };

  return (
    <div className="live-chat-panel">
      <ChatHeader viewerCount={viewerCount} />
      <ChatMessages
        messages={messages}
        currentUserId={getCurrentUserId()}
      />
      <ChatInput
        onSend={sendMessage}
        isCreator={isCreator}
        isModerator={isModerator}
      />
    </div>
  );
}
```

### 6. API Endpoints

#### 6.1 Premiere Management Endpoints

```typescript
// apps/api-videos/src/endpoints/video/premiereSchedule.ts (new file)
export class PremiereScheduleEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Premiere"],
    summary: "Schedule a video premiere",
    request: {
      params: z.object({
        videoId: z.string()
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              scheduledPublishDate: z.string().datetime(),
              enablePreChat: z.boolean().default(true),
              countdownDuration: z.number().default(24) // hours before countdown starts
            })
          }
        }
      }
    }
  }, 'required');

  async handle(c) {
    const { videoId } = c.req.param();
    const { scheduledPublishDate, enablePreChat, countdownDuration } = await c.req.json();

    // Validate user owns the video
    const auth = c.get('auth');
    const video = await getVideo(c.env, videoId);
    if (video.userId !== auth.userId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Update video with premiere data
    const premiereData: PremiereMetadata = {
      isScheduled: true,
      isPremiere: true,
      scheduledPublishDate,
      premiereStatus: 'scheduled',
      premiereCountdownStart: new Date(
        new Date(scheduledPublishDate).getTime() - countdownDuration * 3600000
      ).toISOString()
    };

    await updateVideo(c.env, videoId, {
      premiere: premiereData,
      isPublic: false // Keep private until premiere
    });

    // Schedule notifications
    const notificationService = new PremiereNotificationService(c.env);
    await notificationService.scheduleNotifications(videoId, new Date(scheduledPublishDate));

    return c.json({
      success: true,
      premiereUrl: `/premiere/${videoId}`,
      countdownStartsAt: premiereData.premiereCountdownStart
    });
  }
}
```

```typescript
// apps/api-videos/src/endpoints/video/premiereCancel.ts (new file)
export class PremiereCancelEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Premiere"],
    summary: "Cancel a scheduled premiere",
    request: {
      params: z.object({
        videoId: z.string()
      })
    }
  }, 'required');

  async handle(c) {
    const { videoId } = c.req.param();
    const auth = c.get('auth');

    // Validate ownership and premiere status
    const video = await getVideo(c.env, videoId);
    if (video.userId !== auth.userId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    if (!video.premiere?.isPremiere) {
      return c.json({ error: 'Not a premiere' }, 400);
    }

    // Cancel premiere
    await updateVideo(c.env, videoId, {
      premiere: {
        ...video.premiere,
        premiereStatus: 'cancelled'
      },
      isPublic: true // Make immediately public
    });

    // Cancel scheduled notifications
    await cancelPremiereNotifications(videoId);

    return c.json({ success: true });
  }
}
```

```typescript
// apps/api-videos/src/endpoints/video/premiereChat.ts (new file)
export class PremiereChatEndpoint extends OpenAPIRoute {
  schema = {
    tags: ["Premiere"],
    summary: "Get premiere chat messages",
    request: {
      params: z.object({
        videoId: z.string()
      }),
      query: z.object({
        limit: z.number().default(100),
        cursor: z.string().optional()
      })
    }
  };

  async handle(c) {
    const { videoId } = c.req.param();
    const { limit, cursor } = c.req.query();

    // Fetch chat messages from R2
    const messages = await getPremiereChatMessages(
      c.env,
      videoId,
      limit,
      cursor
    );

    return c.json({
      messages,
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null
    });
  }
}
```

### 7. Background Jobs & Processing

#### 7.1 Premiere Status Updater

```typescript
// apps/processor/src/jobs/premiere-status.ts (new file)
export class PremiereStatusJob {
  async run() {
    // Find all scheduled premieres
    const scheduledPremiere = await getScheduledPremiere();

    for (const video of scheduledPremiere) {
      const now = new Date();
      const premiereTime = new Date(video.premiere.scheduledPublishDate);
      const countdownStart = new Date(video.premiere.premiereCountdownStart);

      // Update status based on current time
      let newStatus: PremiereStatus = video.premiere.premiereStatus;

      if (now >= premiereTime) {
        if (video.premiere.premiereStatus !== 'live') {
          newStatus = 'live';
          await this.startPremiere(video);
        }
      } else if (now >= countdownStart) {
        if (video.premiere.premiereStatus === 'scheduled') {
          newStatus = 'countdown';
          await this.startCountdown(video);
        }

        // Check if starting soon (5 minutes before)
        const timeToPremiere = premiereTime.getTime() - now.getTime();
        if (timeToPremiere <= 5 * 60 * 1000) {
          newStatus = 'starting_soon';
        }
      }

      if (newStatus !== video.premiere.premiereStatus) {
        await updatePremiereStatus(video.id, newStatus);
      }
    }
  }

  private async startPremiere(video: VideoObject) {
    // Make video public
    await updateVideo(video.id, { isPublic: true });

    // Send "starting now" notifications
    await sendPremiereNotification(video.id, 'Premiere starting now!');

    // Initialize live metrics
    await initializePremiereMetrics(video.id);
  }

  private async startCountdown(video: VideoObject) {
    // Make countdown page accessible
    await updateVideo(video.id, {
      premiere: {
        ...video.premiere,
        premiereStatus: 'countdown'
      }
    });
  }
}
```

#### 7.2 Premiere End Handler

```typescript
// apps/processor/src/jobs/premiere-end.ts (new file)
export class PremiereEndJob {
  async checkAndEndPremiere() {
    const activePremiere = await getActivePremiere();

    for (const video of activePremiere) {
      // End premiere after video duration + 5 minutes
      const premiereStartTime = new Date(video.premiere.premiereStartedAt);
      const endTime = new Date(
        premiereStartTime.getTime() + (video.duration + 5 * 60) * 1000
      );

      if (new Date() >= endTime) {
        await this.endPremiere(video);
      }
    }
  }

  private async endPremiere(video: VideoObject) {
    // Update premiere status
    await updateVideo(video.id, {
      premiere: {
        ...video.premiere,
        premiereStatus: 'ended',
        premiereEndedAt: new Date().toISOString()
      }
    });

    // Save chat history
    await archivePremierChat(video.id);

    // Save metrics
    await savePremiereMetrics(video.id);

    // Notify WebSocket to close premiere channels
    await closePremiereChannels(video.id);
  }
}
```

### 8. Database/Storage Schema

#### 8.1 R2 Bucket Structure

```
premiere-data/
├── {videoId}/
│   ├── metadata.json           # Premiere configuration
│   ├── chat/
│   │   ├── {timestamp}.json   # Chat messages by time bucket
│   │   └── pinned.json       # Pinned messages
│   ├── metrics/
│   │   ├── viewers.json       # Viewer metrics over time
│   │   └── engagement.json   # Likes, shares during premiere
│   └── notifications/
│       └── scheduled.json     # Scheduled notification times
```

#### 8.2 KV Storage

```typescript
// Premiere state in KV for fast access
interface PremiereKVData {
  videoId: string;
  status: PremiereStatus;
  currentViewers: number;
  peakViewers: number;
  scheduledTime: string;
  actualStartTime?: string;
  chatEnabled: boolean;
}

// Key pattern: premiere:{videoId}
await kv.put(`premiere:${videoId}`, JSON.stringify(premiereData));
```

### 9. Testing Strategy

#### 9.1 Unit Tests

```typescript
// apps/web/src/lib/premiere/__tests__/countdown.test.ts
describe('PremiereCountdown', () => {
  it('should calculate time correctly', () => {
    const future = new Date(Date.now() + 3661000); // 1 hour, 1 minute, 1 second
    const countdown = new PremiereCountdown(future.toISOString(), (time) => {
      expect(time.hours).toBe(1);
      expect(time.minutes).toBe(1);
      expect(time.seconds).toBe(1);
    });
    countdown.start();
  });

  it('should handle expired premieres', () => {
    const past = new Date(Date.now() - 1000);
    const countdown = new PremiereCountdown(past.toISOString(), (time) => {
      expect(time.expired).toBe(true);
    });
    countdown.start();
  });
});
```

#### 9.2 Integration Tests

```typescript
// apps/api-videos/src/endpoints/video/__tests__/premiere.test.ts
describe('Premiere API', () => {
  it('should schedule a premiere', async () => {
    const response = await request(app)
      .post('/api/videos/123/premiere')
      .set('Authorization', 'Bearer valid-token')
      .send({
        scheduledPublishDate: '2025-02-01T15:00:00Z',
        enablePreChat: true
      });

    expect(response.status).toBe(200);
    expect(response.body.premiereUrl).toBe('/premiere/123');
  });

  it('should prevent non-owners from scheduling', async () => {
    const response = await request(app)
      .post('/api/videos/not-owned/premiere')
      .set('Authorization', 'Bearer valid-token')
      .send({
        scheduledPublishDate: '2025-02-01T15:00:00Z'
      });

    expect(response.status).toBe(403);
  });
});
```

#### 9.3 E2E Tests

```typescript
// apps/web/e2e/premiere.spec.ts
test('Premiere countdown flow', async ({ page }) => {
  // Navigate to premiere page
  await page.goto('/premiere/test-video-id');

  // Check countdown is visible
  await expect(page.locator('.countdown-timer')).toBeVisible();

  // Check notification button
  await page.click('button:has-text("Set Reminder")');
  await expect(page.locator('button:has-text("Reminder Set")')).toBeVisible();

  // Check share buttons
  await expect(page.locator('.share-buttons')).toBeVisible();
});
```

#### 9.4 WebSocket Tests

```typescript
// apps/websocket-server/src/__tests__/premiere.test.ts
describe('Premiere WebSocket', () => {
  it('should handle chat messages', async () => {
    const ws = new MockWebSocket();

    // Authenticate
    ws.send({ type: 'authenticate', token: 'valid-token' });

    // Subscribe to premiere chat
    ws.send({ type: 'subscribe', channel: 'premiere:video123:chat' });

    // Send chat message
    ws.send({
      type: 'premiere_message',
      videoId: 'video123',
      message: 'Hello premiere!'
    });

    // Should receive broadcast
    const message = await ws.receive();
    expect(message.type).toBe('premiere_chat');
    expect(message.message.message).toBe('Hello premiere!');
  });
});
```

### 10. Files to Create/Modify

#### 10.1 New Files to Create

**Shared Types:**
- `/packages/shared-types/src/premiere.ts` - Premiere-specific types

**API (api-videos):**
- `/apps/api-videos/src/endpoints/video/premiereSchedule.ts` - Schedule premiere
- `/apps/api-videos/src/endpoints/video/premiereCancel.ts` - Cancel premiere
- `/apps/api-videos/src/endpoints/video/premiereChat.ts` - Get chat messages
- `/apps/api-videos/src/endpoints/video/premiereMetrics.ts` - Get viewer metrics
- `/apps/api-videos/src/lib/premiere/storage.ts` - R2 storage helpers
- `/apps/api-videos/src/lib/premiere/notifications.ts` - Notification helpers

**WebSocket Server:**
- `/apps/websocket-server/src/premiere-handler.ts` - Premiere-specific handlers
- `/apps/websocket-server/src/premiere-channels.ts` - Channel management

**Processor:**
- `/apps/processor/src/jobs/premiere-status.ts` - Status updater job
- `/apps/processor/src/jobs/premiere-end.ts` - End premiere job
- `/apps/processor/src/premiere-notifications.ts` - Notification service

**Web App:**
- `/apps/web/src/app/[locale]/premiere/[id]/page.tsx` - Countdown page
- `/apps/web/src/app/ar/premiere/[id]/page.tsx` - Arabic version
- `/apps/web/src/components/Premiere/CountdownTimer.tsx` - Countdown component
- `/apps/web/src/components/Premiere/LiveChatPanel.tsx` - Chat UI
- `/apps/web/src/components/Premiere/NotifyButton.tsx` - Reminder button
- `/apps/web/src/components/VideoPlayer/PremierePlayer.tsx` - Premiere player
- `/apps/web/src/lib/premiere/countdown.ts` - Countdown logic
- `/apps/web/src/lib/premiere/chat.ts` - Chat utilities
- `/apps/web/src/hooks/usePremiere.ts` - Premiere React hook

#### 10.2 Files to Modify

**Shared Types:**
- `/packages/shared-types/src/video.ts` - Add PremiereMetadata to VideoObject

**API:**
- `/apps/api-videos/src/index.ts` - Register new premiere endpoints
- `/apps/api-videos/src/endpoints/video/uploadInitiate.ts` - Add premiere option
- `/apps/api-videos/src/endpoints/video/videoUpdate.ts` - Handle premiere updates

**WebSocket Server:**
- `/apps/websocket-server/src/messages.ts` - Add premiere message types
- `/apps/websocket-server/src/websocket.ts` - Handle premiere channels
- `/apps/websocket-server/src/index.ts` - Add premiere routes

**Web App:**
- `/apps/web/src/lib/api/videos.ts` - Add premiere API calls
- `/apps/web/src/components/VideoPlayer/index.tsx` - Integrate premiere mode
- `/apps/web/src/lib/websocket/WebSocketManager.ts` - Add premiere handlers

### 11. Implementation Phases

#### Phase 1: Foundation (Week 1)
1. Create data models and types
2. Add premiere fields to video schema
3. Create basic API endpoints for scheduling
4. Set up R2 storage structure

#### Phase 2: Countdown Page (Week 2)
1. Build countdown page UI
2. Implement countdown timer logic
3. Add share functionality
4. Create notification preference UI

#### Phase 3: WebSocket Integration (Week 3)
1. Extend WebSocket server for premiere channels
2. Implement chat message handling
3. Add viewer count tracking
4. Create chat UI components

#### Phase 4: Video Player Integration (Week 4)
1. Modify video player for premiere mode
2. Add countdown overlay
3. Integrate live chat panel
4. Implement seeking restrictions

#### Phase 5: Notifications (Week 5)
1. Build notification scheduling system
2. Implement WebSocket notifications
3. Add notification preferences
4. Create notification UI

#### Phase 6: Background Jobs (Week 6)
1. Create status updater job
2. Implement premiere end handler
3. Add metrics collection
4. Set up chat archival

#### Phase 7: Testing & Polish (Week 7)
1. Write comprehensive tests
2. Fix bugs and edge cases
3. Performance optimization
4. UI/UX refinements

#### Phase 8: Documentation & Launch (Week 8)
1. Write user documentation
2. Create admin guide
3. Prepare launch announcement
4. Deploy to production

### 12. Performance Considerations

#### 12.1 Caching Strategy
- Cache premiere metadata in KV for fast access
- Use CDN for countdown page assets
- Cache chat messages in batches (100 messages)

#### 12.2 Scalability
- Use Durable Objects for premiere session state
- Implement chat message pagination
- Rate limit chat messages (30/min regular, 60/min for creators)
- Use WebSocket broadcast for efficiency

#### 12.3 Resource Optimization
- Lazy load chat history
- Compress WebSocket messages
- Use efficient countdown update intervals (1 second)
- Batch notification sends

### 13. Security Considerations

#### 13.1 Authentication
- Require JWT for scheduling premieres
- Validate video ownership
- Authenticate WebSocket connections

#### 13.2 Authorization
- Only video owner can schedule/cancel premiere
- Moderators can delete chat messages
- Creators can pin messages

#### 13.3 Content Moderation
- Filter chat messages for spam/inappropriate content
- Rate limiting to prevent spam
- Report/block functionality
- Automated profanity filter

#### 13.4 Data Protection
- Encrypt chat messages in transit
- Archive chat data after premiere
- Respect user privacy preferences
- GDPR compliance for notifications

### 14. Monitoring & Analytics

#### 14.1 Metrics to Track
- Premiere conversion rate (scheduled vs completed)
- Average concurrent viewers
- Peak viewer count
- Chat engagement rate
- Notification effectiveness
- User retention during premiere

#### 14.2 Error Monitoring
- WebSocket connection failures
- Notification delivery failures
- Chat message delivery issues
- Status update job failures

#### 14.3 Performance Monitoring
- Countdown page load time
- WebSocket latency
- Chat message delivery time
- Notification delivery speed

### 15. Success Criteria

1. **Technical Success:**
   - Countdown accuracy within 1 second
   - Chat latency under 500ms
   - Support 1000+ concurrent viewers
   - 99.9% uptime for premiere pages

2. **User Experience:**
   - Intuitive scheduling interface
   - Smooth countdown to premiere transition
   - Responsive chat experience
   - Reliable notifications

3. **Business Metrics:**
   - 20% of scheduled videos use premiere
   - 50% higher engagement vs regular uploads
   - 30% increase in concurrent viewers
   - 25% higher retention during premiere

### 16. Future Enhancements

1. **Super Chat** - Paid highlighted messages
2. **Premiere Trailers** - Short preview videos
3. **Waiting Room Games** - Interactive activities before premiere
4. **Co-streaming** - Multiple creators premiere together
5. **Premiere Analytics Dashboard** - Detailed metrics for creators
6. **Scheduled Live Q&A** - Post-premiere discussion
7. **Premiere Badges** - Special badges for attendees
8. **Replay Mode** - Watch premiere with original chat replay

## Conclusion

The Premiere Feature implementation will create a powerful tool for content creators to build anticipation and community engagement around their video releases. By combining scheduled publishing with live chat and real-time notifications, this feature will transform video releases from passive uploads into interactive community events.

The phased implementation approach ensures that core functionality is delivered early while allowing for iterative improvements based on user feedback. The architecture leverages existing infrastructure (WebSocket server, R2 storage, notification system) while adding premiere-specific components that integrate seamlessly with the platform.

Success will be measured not just by technical metrics but by creator adoption and viewer engagement, ensuring that the feature delivers real value to the Al Ummah Now community.