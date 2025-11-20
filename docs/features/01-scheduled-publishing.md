# Scheduled Publishing Feature - Implementation Plan

**Document Version**: 1.0
**Created Date**: 2025-01-20
**Priority**: CRITICAL ⭐⭐⭐⭐⭐
**Estimated Effort**: 2 weeks (2 developers)
**Architecture Pattern**: Cloudflare Workers Cron Triggers + R2 Storage

---

## Executive Summary

The Scheduled Publishing feature enables content creators to schedule videos for automatic publication at a specified date and time. This critical feature allows creators to plan content calendars, optimize release timing, and automate publishing workflows without being online at the exact publish time.

## Key Requirements

### Functional Requirements
1. **Schedule exact date and time** for auto-publish (minimum 5 minutes in future)
2. **Timezone-aware scheduling** with user's preferred timezone
3. **Edit/reschedule** before publish time
4. **Premiere option** with countdown timer (future enhancement)
5. **Cancel scheduled publication** and revert to draft/private
6. **Notification on successful publish** (email/in-app)
7. **Bulk scheduling** for multiple videos (future enhancement)

### Non-Functional Requirements
1. **Reliability**: 99.9% success rate for scheduled publishes
2. **Timing Accuracy**: Publish within 60 seconds of scheduled time
3. **Scalability**: Handle 10,000+ scheduled videos concurrently
4. **Performance**: No impact on regular video operations
5. **Monitoring**: Real-time alerts for failed publishes

## Technical Architecture

### Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Upload Form with Date/Time Picker & Timezone Selector   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API (Hono - api-videos)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   /api/videos/schedule - Schedule/Update/Cancel APIs      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Storage Layer (R2)                           │
│  ┌────────────────────┐    ┌──────────────────────────────┐    │
│  │   videos bucket    │    │  scheduled-videos bucket      │    │
│  │  (main storage)    │    │  (scheduling metadata)        │    │
│  └────────────────────┘    └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│              Scheduler Worker (New Cloudflare Worker)            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Cron Trigger: */1 * * * * (runs every minute)           │   │
│  │  - Query scheduled videos due for publishing              │   │
│  │  - Update video status to public                          │   │
│  │  - Send notifications                                     │   │
│  │  - Log events to queue                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **User schedules video** → Frontend sends request with scheduled timestamp
2. **API validates** and stores scheduling metadata in R2
3. **Cron worker runs every minute** → Checks for videos due for publishing
4. **Auto-publish process** → Updates video status, sends notifications
5. **Event tracking** → Logs to queue for analytics

## Database Schema Changes

### 1. Video Model Extensions (`packages/shared-types/src/video.ts`)

```typescript
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Scheduling fields
  scheduledPublishDate?: string;        // ISO 8601 datetime in UTC
  scheduledPublishTimezone?: string;    // IANA timezone (e.g., 'America/New_York')
  scheduledPublishStatus?: ScheduledPublishStatus;
  scheduledBy?: string;                 // User ID who scheduled
  scheduledAt?: string;                 // When it was scheduled
  publishedViaSchedule?: boolean;       // True if published via scheduler

  // Premiere fields (future enhancement)
  isPremiered?: boolean;
  premiereDate?: string;
  premiereCountdownStarted?: boolean;
}

export type ScheduledPublishStatus =
  | 'scheduled'      // Waiting to be published
  | 'publishing'     // Currently being published
  | 'published'      // Successfully published
  | 'failed'         // Failed to publish
  | 'cancelled';     // User cancelled the schedule

export interface VideoScheduleRequest {
  videoId: string;
  scheduledPublishDate: string;     // ISO 8601 datetime
  timezone: string;                  // IANA timezone
  notifyOnPublish?: boolean;         // Send notification
  premiereMode?: boolean;            // Enable premiere (future)
}

export interface VideoScheduleUpdateRequest {
  scheduledPublishDate?: string;
  timezone?: string;
  notifyOnPublish?: boolean;
}

export interface ScheduledVideoMetadata {
  videoId: string;
  title: string;
  channelId: string;
  userId: string;
  scheduledPublishDate: string;      // UTC datetime
  timezone: string;
  localScheduledDate: string;        // User's local time
  notifyOnPublish: boolean;
  retryCount: number;
  lastAttempt?: string;
  error?: string;
}
```

### 2. New R2 Bucket for Scheduling

**Bucket Name**: `scheduled-videos` (preview: `scheduled-videos-preview`)

**Key Format**: `{year}-{month}-{day}/{hour}/{videoId}.json`
- Example: `2025-01-20/14/abc123.json`
- Organized by date/hour for efficient querying

**Benefits**:
- Efficient range queries by date/time
- Easy cleanup of old schedules
- Isolated from main video data

## API Endpoint Specifications

### 1. Schedule Video Publication
```typescript
POST /api/videos/{videoId}/schedule
Authorization: Bearer {token}

Request Body:
{
  "scheduledPublishDate": "2025-01-25T10:00:00Z",
  "timezone": "America/New_York",
  "notifyOnPublish": true
}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "scheduledPublishDate": "2025-01-25T10:00:00Z",
    "localScheduledDate": "2025-01-25T05:00:00-05:00",
    "timezone": "America/New_York",
    "status": "scheduled"
  }
}

Validations:
- Must be at least 5 minutes in the future
- Maximum 1 year in the future
- User must own the video
- Video must be in draft/private status
```

### 2. Update Scheduled Publication
```typescript
PATCH /api/videos/{videoId}/schedule
Authorization: Bearer {token}

Request Body:
{
  "scheduledPublishDate": "2025-01-26T15:00:00Z"
}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "previousSchedule": "2025-01-25T10:00:00Z",
    "newSchedule": "2025-01-26T15:00:00Z",
    "status": "rescheduled"
  }
}

Validations:
- Cannot update if already publishing/published
- New time must be at least 5 minutes in future
```

### 3. Cancel Scheduled Publication
```typescript
DELETE /api/videos/{videoId}/schedule
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "videoId": "abc123",
    "status": "cancelled",
    "message": "Scheduled publication cancelled"
  }
}

Validations:
- Cannot cancel if already published
- User must own the video
```

### 4. Get Scheduled Videos (List)
```typescript
GET /api/videos/scheduled
Authorization: Bearer {token}

Query Parameters:
- channelId?: string
- startDate?: string (ISO 8601)
- endDate?: string (ISO 8601)
- status?: ScheduledPublishStatus
- limit?: number (default: 20, max: 100)
- cursor?: string

Response:
{
  "success": true,
  "result": {
    "videos": [
      {
        "videoId": "abc123",
        "title": "Friday Sermon",
        "thumbnailUrl": "...",
        "scheduledPublishDate": "2025-01-25T10:00:00Z",
        "localScheduledDate": "2025-01-25T05:00:00-05:00",
        "timezone": "America/New_York",
        "status": "scheduled"
      }
    ],
    "cursor": "next_page_cursor",
    "hasMore": true
  }
}
```

### 5. Get Schedule Status
```typescript
GET /api/videos/{videoId}/schedule
Authorization: Bearer {token}

Response:
{
  "success": true,
  "result": {
    "isScheduled": true,
    "scheduledPublishDate": "2025-01-25T10:00:00Z",
    "localScheduledDate": "2025-01-25T05:00:00-05:00",
    "timezone": "America/New_York",
    "status": "scheduled",
    "timeRemaining": "5 days 3 hours",
    "canEdit": true,
    "canCancel": true
  }
}
```

## Frontend UI Components

### 1. Upload Form Enhancements

**File**: `apps/web/src/components/videoUpload/ScheduleSection.tsx`

```typescript
interface ScheduleSectionProps {
  value?: ScheduleConfig;
  onChange: (config: ScheduleConfig | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
}

interface ScheduleConfig {
  enabled: boolean;
  date: Date;
  time: string; // HH:MM format
  timezone: string;
  notifyOnPublish: boolean;
}

// Component features:
// - Toggle to enable/disable scheduling
// - Date picker (calendar widget)
// - Time picker (with 5-minute increments)
// - Timezone selector (auto-detect user timezone)
// - "Notify me when published" checkbox
// - Validation messages (too soon, too far, etc.)
// - Preview of scheduled time in user's timezone
```

### 2. Video Management Dashboard

**File**: `apps/web/src/components/dashboard/ScheduledVideos.tsx`

```typescript
// Features:
// - List of all scheduled videos
// - Timeline/calendar view
// - Status badges (scheduled, publishing, failed)
// - Quick actions (edit, cancel, view)
// - Countdown timers for upcoming publishes
// - Filter by date range, channel, status
// - Bulk actions (cancel multiple)
```

### 3. Video Edit Page

**File**: `apps/web/src/app/[locale]/video/[id]/edit/page.tsx`

```typescript
// Enhancements:
// - Show current schedule status
// - Allow rescheduling
// - Cancel schedule button
// - History of schedule changes
// - Warning before cancellation
```

### 4. Notification Components

**File**: `apps/web/src/components/notifications/ScheduleNotifications.tsx`

```typescript
// Notification types:
// - "Video scheduled successfully"
// - "Video will be published in 5 minutes"
// - "Video published successfully via schedule"
// - "Scheduled publication failed - action required"
// - "Schedule cancelled"
```

## Scheduler Worker Architecture

### New Worker: `apps/scheduler/`

**File Structure**:
```
apps/scheduler/
├── src/
│   ├── index.ts              # Main worker with cron trigger
│   ├── publisher.ts          # Publishing logic
│   ├── notifier.ts          # Notification service
│   ├── retry.ts             # Retry mechanism
│   └── monitoring.ts        # Health checks & metrics
├── wrangler.toml            # Worker configuration
├── package.json
└── tsconfig.json
```

### Cron Configuration (`wrangler.toml`)

```toml
name = "al-ummah-scheduler"
main = "src/index.ts"
compatibility_date = "2025-01-20"
compatibility_flags = ["nodejs_compat"]

# Run every minute
[[triggers.crons]]
cron = "* * * * *"

# R2 Buckets
[[r2_buckets]]
binding = "VIDEOS"
bucket_name = "videos"

[[r2_buckets]]
binding = "SCHEDULED_VIDEOS"
bucket_name = "scheduled-videos"

# Queue for events
[[queues.producers]]
queue = "al-ummah-now-videos"
binding = "QUEUE"

# KV for distributed locks
[[kv_namespaces]]
binding = "SCHEDULER_LOCKS"
id = "scheduler-locks-kv"

# Environment variables
[vars]
MAX_RETRIES = "3"
BATCH_SIZE = "50"
LOCK_TTL = "120"  # seconds
```

### Core Scheduler Logic

**File**: `apps/scheduler/src/index.ts`

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const startTime = Date.now();

    try {
      // 1. Get current time window (current minute)
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setSeconds(0, 0);
      const windowEnd = new Date(windowStart);
      windowEnd.setMinutes(windowEnd.getMinutes() + 1);

      // 2. Query scheduled videos for this time window
      const scheduledVideos = await queryScheduledVideos(
        env.SCHEDULED_VIDEOS,
        windowStart,
        windowEnd
      );

      // 3. Process in batches with distributed locking
      const results = await processBatch(
        scheduledVideos,
        env,
        ctx
      );

      // 4. Report metrics
      await reportMetrics(env.QUEUE, {
        processed: results.successful.length,
        failed: results.failed.length,
        duration: Date.now() - startTime,
      });

      // 5. Handle failures with retry
      if (results.failed.length > 0) {
        await scheduleRetries(results.failed, env);
      }

    } catch (error) {
      console.error('Scheduler error:', error);
      // Send alert to monitoring
      await sendAlert(env, error);
    }
  }
};

async function processBatch(
  videos: ScheduledVideoMetadata[],
  env: Env,
  ctx: ExecutionContext
): Promise<BatchResult> {
  const results = {
    successful: [],
    failed: []
  };

  // Process videos in parallel with concurrency limit
  const CONCURRENCY = 10;

  for (let i = 0; i < videos.length; i += CONCURRENCY) {
    const batch = videos.slice(i, i + CONCURRENCY);

    const promises = batch.map(async (video) => {
      // Acquire distributed lock to prevent duplicate processing
      const lockKey = `lock:${video.videoId}`;
      const locked = await acquireLock(env.SCHEDULER_LOCKS, lockKey);

      if (!locked) {
        console.log(`Video ${video.videoId} already being processed`);
        return;
      }

      try {
        // Publish the video
        await publishVideo(env.VIDEOS, video);

        // Send notification
        if (video.notifyOnPublish) {
          ctx.waitUntil(sendNotification(env, video));
        }

        // Log success event
        await logEvent(env.QUEUE, {
          type: 'SCHEDULED_PUBLISH_SUCCESS',
          videoId: video.videoId,
          scheduledTime: video.scheduledPublishDate,
          publishedAt: new Date().toISOString(),
        });

        // Remove from scheduled bucket
        await removeSchedule(env.SCHEDULED_VIDEOS, video);

        results.successful.push(video);

      } catch (error) {
        console.error(`Failed to publish ${video.videoId}:`, error);
        results.failed.push({ video, error });
      } finally {
        // Release lock
        await releaseLock(env.SCHEDULER_LOCKS, lockKey);
      }
    });

    await Promise.all(promises);
  }

  return results;
}

async function publishVideo(
  videoBucket: R2Bucket,
  metadata: ScheduledVideoMetadata
): Promise<void> {
  // 1. Fetch current video data
  const video = await videoBucket.get(metadata.videoId);
  if (!video) {
    throw new Error(`Video ${metadata.videoId} not found`);
  }

  const videoData = JSON.parse(await video.text());

  // 2. Update video status
  videoData.isPublic = true;
  videoData.publishedAt = new Date().toISOString();
  videoData.publishedViaSchedule = true;
  videoData.scheduledPublishStatus = 'published';

  // 3. Save updated video
  await videoBucket.put(
    metadata.videoId,
    JSON.stringify(videoData)
  );
}
```

### Retry Mechanism

**File**: `apps/scheduler/src/retry.ts`

```typescript
export async function scheduleRetries(
  failed: FailedVideo[],
  env: Env
): Promise<void> {
  for (const { video, error } of failed) {
    const retryCount = video.retryCount || 0;

    if (retryCount >= env.MAX_RETRIES) {
      // Mark as permanently failed
      await markAsFailed(env, video, error);
      await notifyFailure(env, video, error);
      continue;
    }

    // Calculate exponential backoff
    const delayMinutes = Math.pow(2, retryCount); // 1, 2, 4, 8...
    const retryTime = new Date();
    retryTime.setMinutes(retryTime.getMinutes() + delayMinutes);

    // Reschedule with incremented retry count
    const updatedMetadata = {
      ...video,
      retryCount: retryCount + 1,
      lastAttempt: new Date().toISOString(),
      error: error.message,
    };

    // Save back to scheduled bucket with new time
    await rescheduleVideo(
      env.SCHEDULED_VIDEOS,
      updatedMetadata,
      retryTime
    );
  }
}
```

### Monitoring & Health Checks

**File**: `apps/scheduler/src/monitoring.ts`

```typescript
export async function setupMonitoring(env: Env): Promise<void> {
  // Health check endpoint (optional separate worker)
  // Metrics collection
  // Alert thresholds

  const metrics = {
    scheduledVideosCount: 0,
    publishedToday: 0,
    failedToday: 0,
    averageDelay: 0, // seconds between scheduled and actual
    queueDepth: 0,
  };

  // Store metrics in KV with TTL
  await env.SCHEDULER_METRICS.put(
    'daily_metrics',
    JSON.stringify(metrics),
    { expirationTtl: 86400 } // 24 hours
  );
}

export async function checkHealth(env: Env): Promise<HealthStatus> {
  // Check if scheduler ran in last 2 minutes
  const lastRun = await env.SCHEDULER_LOCKS.get('last_run');
  const isHealthy = lastRun &&
    (Date.now() - parseInt(lastRun)) < 120000;

  return {
    healthy: isHealthy,
    lastRun,
    queueDepth: await getQueueDepth(env),
    failureRate: await getFailureRate(env),
  };
}
```

## Testing Strategy

### 1. Unit Tests

**Test Files**:
- `apps/scheduler/src/__tests__/publisher.test.ts`
- `apps/scheduler/src/__tests__/retry.test.ts`
- `apps/api-videos/src/endpoints/video/__tests__/schedule.test.ts`

**Test Cases**:
```typescript
describe('Video Scheduling', () => {
  test('should schedule video for future publication');
  test('should reject scheduling in the past');
  test('should reject scheduling less than 5 minutes ahead');
  test('should handle timezone conversions correctly');
  test('should prevent duplicate schedules');
  test('should allow rescheduling');
  test('should cancel scheduled publication');
  test('should publish video at scheduled time');
  test('should retry failed publications');
  test('should send notifications on success');
  test('should alert on permanent failure');
});
```

### 2. Integration Tests

**Scenarios**:
1. **Happy Path**: Schedule → Wait → Auto-publish → Notification
2. **Reschedule**: Schedule → Update → New time → Publish
3. **Cancel**: Schedule → Cancel → Video remains private
4. **Failure & Retry**: Schedule → Fail → Retry → Success
5. **Timezone**: Schedule in different timezones → Correct publish times
6. **Bulk**: Schedule 100+ videos → All publish correctly
7. **Race Condition**: Multiple schedulers → No duplicate publishes

### 3. Load Testing

**Target Metrics**:
- Handle 10,000 scheduled videos
- Process 1,000 videos per minute
- 99.9% success rate
- < 60 second publish delay

**Test Tools**:
- k6 for load testing
- Miniflare for local Worker testing
- Wrangler dev for integration testing

### 4. Monitoring Tests

**Alerts to Configure**:
1. Scheduler hasn't run in 5 minutes
2. Failure rate > 1%
3. Average delay > 120 seconds
4. Queue depth > 1000
5. Retry queue growing

## Implementation Steps

### Phase 1: Core Infrastructure (Days 1-3)

1. **Database Schema Updates**
   - [ ] Update `VideoObject` interface with scheduling fields
   - [ ] Create `ScheduledVideoMetadata` types
   - [ ] Deploy type changes to shared-types package

2. **Create Scheduler Worker**
   - [ ] Set up new `apps/scheduler/` workspace
   - [ ] Implement basic cron trigger
   - [ ] Add R2 bucket bindings
   - [ ] Deploy to development environment

3. **R2 Bucket Setup**
   - [ ] Create `scheduled-videos` bucket
   - [ ] Create preview bucket for development
   - [ ] Configure access permissions

### Phase 2: API Development (Days 4-6)

4. **Schedule Management APIs**
   - [ ] Create `/api/videos/{id}/schedule` POST endpoint
   - [ ] Create `/api/videos/{id}/schedule` PATCH endpoint
   - [ ] Create `/api/videos/{id}/schedule` DELETE endpoint
   - [ ] Create `/api/videos/scheduled` GET endpoint
   - [ ] Add OpenAPI documentation

5. **Publishing Logic**
   - [ ] Implement video status update logic
   - [ ] Add distributed locking mechanism
   - [ ] Implement retry mechanism
   - [ ] Add event logging to queue

### Phase 3: Frontend Development (Days 7-9)

6. **Upload Form Enhancement**
   - [ ] Create `ScheduleSection` component
   - [ ] Add date/time picker widgets
   - [ ] Implement timezone selector
   - [ ] Add validation and preview

7. **Dashboard Views**
   - [ ] Create scheduled videos list view
   - [ ] Add calendar/timeline view
   - [ ] Implement quick actions
   - [ ] Add status badges and countdowns

8. **Video Edit Page**
   - [ ] Add schedule management section
   - [ ] Implement reschedule functionality
   - [ ] Add cancel schedule option
   - [ ] Show schedule history

### Phase 4: Testing & Refinement (Days 10-12)

9. **Testing**
   - [ ] Write unit tests for all components
   - [ ] Perform integration testing
   - [ ] Conduct load testing
   - [ ] Test timezone edge cases
   - [ ] Test failure scenarios

10. **Monitoring & Alerts**
    - [ ] Set up health check endpoints
    - [ ] Configure CloudFlare Analytics
    - [ ] Set up error alerts
    - [ ] Create operational dashboard

### Phase 5: Documentation & Deployment (Days 13-14)

11. **Documentation**
    - [ ] API documentation
    - [ ] User guide for scheduling
    - [ ] Troubleshooting guide
    - [ ] Admin operations guide

12. **Production Deployment**
    - [ ] Deploy scheduler worker
    - [ ] Deploy API updates
    - [ ] Deploy frontend changes
    - [ ] Monitor initial usage

## Migration Plan

### For Existing Videos
No migration needed - existing videos remain unaffected. Scheduling is opt-in per video.

### For Active Development
1. Feature flag: `ENABLE_SCHEDULED_PUBLISHING`
2. Gradual rollout: Start with 10% of users
3. Monitor metrics before full rollout

## Rollback Plan

### If Issues Occur:
1. **Disable cron trigger** in Cloudflare dashboard
2. **Hide UI elements** via feature flag
3. **Process remaining schedules manually** if needed
4. **Revert deployment** if critical issues

### Rollback Commands:
```bash
# Disable scheduler
wrangler deploy --env production --var SCHEDULER_ENABLED=false apps/scheduler

# Revert API
git revert HEAD && wrangler deploy apps/api-videos

# Revert frontend
git revert HEAD && wrangler deploy apps/web
```

## Success Metrics

### Key Performance Indicators (KPIs)

1. **Adoption Rate**
   - Target: 30% of uploads use scheduling within 1 month
   - Measure: scheduled_videos / total_uploads

2. **Success Rate**
   - Target: 99.9% of scheduled videos publish successfully
   - Measure: published / scheduled

3. **Timing Accuracy**
   - Target: 95% publish within 60 seconds of scheduled time
   - Measure: actual_publish_time - scheduled_time

4. **User Satisfaction**
   - Target: 4.5+ star rating for feature
   - Measure: User feedback surveys

5. **System Performance**
   - Target: < 1% CPU increase from scheduler
   - Measure: Worker analytics

### Monitoring Dashboard

Create dashboard showing:
- Total scheduled videos (by hour/day/week)
- Success/failure rates
- Average publish delay
- Top scheduling times
- Timezone distribution
- Retry statistics

## Security Considerations

### Authentication & Authorization
- Only video owner can schedule/reschedule/cancel
- JWT validation on all schedule endpoints
- Rate limiting: Max 100 schedules per user per day

### Data Protection
- Scheduled metadata encrypted at rest in R2
- Timezone data considered PII - handle accordingly
- Audit log for all schedule operations

### Attack Vectors & Mitigations
1. **Schedule bombing**: Rate limiting + quotas
2. **Time manipulation**: Server-side time validation
3. **Duplicate publishes**: Distributed locking
4. **Resource exhaustion**: Batch size limits

## Cost Analysis

### Cloudflare Workers Costs

**Scheduler Worker**:
- Requests: 60 req/hour × 24 × 30 = 43,200/month
- CPU Time: ~50ms per run × 43,200 = 36 min/month
- **Estimated Cost**: $5-10/month

**R2 Storage**:
- Scheduled metadata: ~1KB per video
- 10,000 scheduled videos = 10MB
- **Estimated Cost**: < $1/month

**Additional Costs**:
- KV operations for locks: ~$5/month
- Queue messages: Included in existing
- **Total Additional Cost**: ~$15/month

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scheduler stops running | Low | High | Health checks, alerts, manual fallback |
| Mass failure at peak time | Low | High | Retry mechanism, gradual processing |
| Timezone calculation errors | Medium | Medium | Extensive testing, standard libraries |
| R2 query performance degradation | Low | Medium | Efficient key structure, caching |
| Duplicate publishes | Low | Low | Distributed locking, idempotency |

## Future Enhancements

### Phase 2 Features
1. **Premiere Mode**: Countdown timer, live chat during premiere
2. **Bulk Scheduling**: Schedule multiple videos at once
3. **Recurring Schedules**: Weekly/daily patterns
4. **Smart Scheduling**: ML-based optimal time suggestions
5. **Schedule Templates**: Save and reuse common schedules

### Phase 3 Features
1. **Cross-platform Sync**: Coordinate with social media
2. **Embargo System**: Geographic release timing
3. **A/B Testing**: Test different publish times
4. **Advanced Analytics**: Optimal time analysis
5. **API for External Tools**: Integration with content management systems

## Appendix

### A. Timezone Handling

Use IANA timezone database with libraries:
- Frontend: `date-fns-tz` or `luxon`
- Backend: Native `Intl.DateTimeFormat`

Example:
```typescript
// Convert user's local time to UTC for storage
const userTime = "2025-01-25 10:00";
const timezone = "America/New_York";
const utcTime = zonedTimeToUtc(userTime, timezone);

// Display in user's timezone
const displayTime = utcToZonedTime(utcTime, timezone);
```

### B. Cron Expression Reference

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)

Examples:
*/5 * * * *  - Every 5 minutes
0 * * * *    - Every hour
0 9 * * 1-5  - 9 AM on weekdays
```

### C. Error Codes

| Code | Description | User Action |
|------|-------------|------------|
| SCH001 | Invalid schedule time | Choose time at least 5 min in future |
| SCH002 | Video not found | Verify video exists |
| SCH003 | Unauthorized | Login required |
| SCH004 | Already scheduled | Cancel existing schedule first |
| SCH005 | Already published | Cannot schedule published videos |
| SCH006 | Scheduler unavailable | Try again later |

### D. Sample API Requests

```bash
# Schedule a video
curl -X POST https://api.alummahnow.net/api/videos/abc123/schedule \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduledPublishDate": "2025-01-25T10:00:00Z",
    "timezone": "America/New_York",
    "notifyOnPublish": true
  }'

# List scheduled videos
curl https://api.alummahnow.net/api/videos/scheduled \
  -H "Authorization: Bearer $TOKEN"

# Cancel schedule
curl -X DELETE https://api.alummahnow.net/api/videos/abc123/schedule \
  -H "Authorization: Bearer $TOKEN"
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-20 | System Architect | Initial implementation plan |

---

## Sign-off

- [ ] Technical Lead Approval
- [ ] Product Manager Approval
- [ ] Security Review
- [ ] DevOps Review

**Next Steps**: Review plan → Create implementation tasks → Begin Phase 1