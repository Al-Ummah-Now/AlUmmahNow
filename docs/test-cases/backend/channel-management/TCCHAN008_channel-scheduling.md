# TCCHAN008: Channel Scheduling

## Test Overview

**Test Case ID**: TCCHAN008  
**Category**: Channel Management  
**Sub-category**: Scheduling & Automation  
**Priority**: High  
**Estimated Duration**: 45 minutes  
**Test Type**: Functional Testing + Integration Testing

## Description

This test case validates the channel scheduling functionality, including scheduled content publishing, automated posting, live stream scheduling, and content calendar management. The test ensures that creators can schedule videos, live streams, and other content for future publication with proper timing, notifications, and automated execution.

## Requirements

### Functional Requirements
- FR1: Users can schedule video uploads for future publication
- FR2: Users can schedule live streams with start/end times
- FR3: Content calendar displays scheduled content clearly
- FR4: Automated notifications for scheduled content
- FR5: Batch scheduling operations support
- FR6: Time zone handling for international creators
- FR7: Conflict detection for overlapping schedules
- FR8: Scheduled content management (edit, cancel, reschedule)

### Technical Requirements
- TR1: Queue-based scheduling system
- TR2: Cron job support for recurring schedules
- TR3: Time zone conversion and validation
- TR4: Notification system integration
- TR5: Content calendar API endpoints
- TR6: Schedule conflict detection algorithms
- TR7: Audit logging for schedule changes
- TR8: Performance optimization for large schedules

### Business Requirements
- BR1: Support for content creators across time zones
- BR2: Automated publishing reduces manual workload
- BR3: Consistent content delivery timing
- BR4: Analytics for scheduled content performance
- BR5: Backup and recovery for scheduled content
- BR6: Integration with social media scheduling

## Test Environment

### Required Components
- **Frontend**: Next.js web application
- **Backend**: Hono API with scheduling endpoints
- **Database**: R2 storage for schedule data
- **Queue System**: Cloudflare Queue for scheduled tasks
- **Notification Service**: WebSocket server for alerts
- **Time Service**: Accurate time zone handling

### Test Data
- Channel with scheduling permissions
- Sample videos for scheduling
- Live stream configurations
- Different time zone scenarios
- Schedule conflict scenarios

### Test Accounts
- **Channel Owner**: Full scheduling permissions
- **Channel Manager**: Limited scheduling permissions
- **Viewer**: No scheduling permissions (negative testing)

## Test Procedure

### Phase 1: Video Scheduling (15 minutes)

1. **Navigate to Channel Dashboard**
   - Login as channel owner
   - Access channel management section
   - Navigate to "Content Scheduler"

2. **Schedule Single Video**
   - Select "Schedule Video Upload"
   - Choose video file from library
   - Set publication date/time (future)
   - Configure video metadata
   - Set notification preferences
   - Save schedule

3. **Validate Schedule Creation**
   - Verify schedule appears in calendar
   - Check schedule details accuracy
   - Confirm notification settings
   - Validate time zone conversion

4. **Edit Scheduled Video**
   - Select existing scheduled video
   - Modify publication time
   - Update video metadata
   - Change notification settings
   - Save changes

5. **Cancel Scheduled Video**
   - Select scheduled video
   - Choose cancel option
   - Confirm cancellation
   - Verify removal from calendar

### Phase 2: Live Stream Scheduling (15 minutes)

6. **Schedule Live Stream**
   - Select "Schedule Live Stream"
   - Set stream title and description
   - Configure start/end times
   - Set stream privacy settings
   - Enable pre-stream notifications
   - Save live stream schedule

7. **Configure Stream Settings**
   - Set up stream quality options
   - Configure chat moderation
   - Set recording preferences
   - Configure backup stream settings
   - Save stream configuration

8. **Validate Live Stream Schedule**
   - Verify stream appears in calendar
   - Check stream configuration
   - Validate notification timing
   - Test reminder notifications

9. **Reschedule Live Stream**
   - Select scheduled live stream
   - Modify start/end times
   - Update stream settings
   - Adjust notification timing
   - Save rescheduled stream

### Phase 3: Batch Scheduling (10 minutes)

10. **Create Batch Schedule**
    - Select multiple videos
    - Choose "Batch Schedule"
    - Set common publication settings
    - Configure staggered publishing
    - Set notification preferences
    - Execute batch schedule

11. **Validate Batch Schedule**
    - Verify all items scheduled
    - Check publication timing
    - Validate calendar display
    - Confirm notification setup

12. **Manage Batch Schedule**
    - Edit individual items in batch
    - Modify batch settings
    - Cancel selected items
    - Reschedule batch items

### Phase 4: Calendar Management (5 minutes)

13. **Navigate Content Calendar**
    - Access calendar view
    - Filter by content type
    - Navigate different months
    - View schedule details

14. **Calendar Interactions**
    - Drag and drop rescheduling
    - Quick edit from calendar
    - Export calendar data
    - Print schedule summary

## Test Data

### Schedule Data Structure
```typescript
interface ScheduledContent {
  id: string;
  channelId: string;
  contentType: 'video' | 'live_stream' | 'playlist';
  title: string;
  description: string;
  scheduledTime: Date;
  timezone: string;
  status: 'scheduled' | 'published' | 'cancelled' | 'failed';
  notificationSettings: {
    enabled: boolean;
    reminderTimes: number[]; // minutes before
    channels: string[]; // notification channels
  };
  metadata: {
    tags: string[];
    category: string;
    privacy: 'public' | 'private' | 'unlisted';
  };
  createdAt: Date;
  updatedAt: Date;
}

interface LiveStreamSchedule extends ScheduledContent {
  contentType: 'live_stream';
  streamSettings: {
    endTime: Date;
    quality: string[];
    chatEnabled: boolean;
    recordingEnabled: boolean;
    backupUrl?: string;
  };
}
```

### Test Scenarios
```typescript
const scheduleTestScenarios = {
  basicVideoSchedule: {
    title: "Test Video Schedule",
    scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    timezone: "America/New_York",
    notificationSettings: {
      enabled: true,
      reminderTimes: [60, 15, 5], // 1hr, 15min, 5min before
      channels: ['email', 'push', 'websocket']
    }
  },
  
  liveStreamSchedule: {
    title: "Test Live Stream",
    scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
    endTime: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3 hours from now
    timezone: "Europe/London",
    streamSettings: {
      quality: ['720p', '1080p'],
      chatEnabled: true,
      recordingEnabled: true
    }
  },
  
  batchSchedule: {
    videos: [
      { id: 'video1', delay: 0 },
      { id: 'video2', delay: 30 * 60 * 1000 }, // 30 minutes later
      { id: 'video3', delay: 60 * 60 * 1000 }  // 1 hour later
    ],
    commonSettings: {
      timezone: "Asia/Tokyo",
      notificationSettings: { enabled: true }
    }
  }
};
```

## Expected Results

### Success Criteria
- All scheduled content created successfully
- Calendar displays schedules accurately
- Time zone conversions work correctly
- Notifications sent at specified times
- Batch operations complete successfully
- Schedule conflicts detected and handled
- Edit/cancel operations work properly

### Performance Criteria
- Schedule creation: < 2 seconds
- Calendar loading: < 3 seconds
- Batch operations: < 10 seconds
- Notification delivery: < 30 seconds

### UI/UX Criteria
- Intuitive calendar interface
- Clear schedule status indicators
- Easy rescheduling options
- Comprehensive schedule details
- Responsive design on mobile

## Error Scenarios

### Common Errors
1. **Invalid Schedule Time**
   - Error: Past date selected
   - Resolution: Show validation error, suggest future time

2. **Schedule Conflicts**
   - Error: Overlapping live streams
   - Resolution: Highlight conflicts, suggest alternatives

3. **Time Zone Issues**
   - Error: Invalid time zone
   - Resolution: Validate time zone, show local time

4. **Permission Denied**
   - Error: Insufficient permissions
   - Resolution: Check user role, show appropriate options

5. **Queue Full**
   - Error: Scheduling queue at capacity
   - Resolution: Queue overflow handling, retry mechanism

### Recovery Procedures
1. **Schedule Failure Recovery**
   - Check queue status
   - Retry failed schedules
   - Notify user of issues

2. **Time Zone Correction**
   - Detect time zone changes
   - Update existing schedules
   - Notify affected users

3. **Conflict Resolution**
   - Automatic conflict detection
   - Suggest resolution options
   - Manual override available

## Test Automation

### Playwright Test Implementation
```typescript
import { test, expect } from '@playwright/test';

test.describe('Channel Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    // Login as channel owner
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'channel.owner@example.com');
    await page.fill('[data-testid="password"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/dashboard');
  });

  test('should schedule video upload', async ({ page }) => {
    // Navigate to scheduler
    await page.click('[data-testid="content-scheduler"]');
    await page.waitForURL('/scheduler');

    // Schedule video
    await page.click('[data-testid="schedule-video"]');
    await page.selectOption('[data-testid="video-select"]', 'test-video-1');
    
    // Set future date
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await page.fill('[data-testid="schedule-date"]', futureDate.toISOString().split('T')[0]);
    await page.fill('[data-testid="schedule-time"]', '10:00');

    // Configure notifications
    await page.check('[data-testid="enable-notifications"]');
    await page.check('[data-testid="reminder-1hr"]');
    await page.check('[data-testid="reminder-15min"]');

    // Save schedule
    await page.click('[data-testid="save-schedule"]');
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    
    // Verify in calendar
    await page.click('[data-testid="calendar-view"]');
    await expect(page.locator('[data-testid="scheduled-item"]')).toContainText('test-video-1');
  });

  test('should schedule live stream', async ({ page }) => {
    await page.click('[data-testid="content-scheduler"]');
    
    // Schedule live stream
    await page.click('[data-testid="schedule-livestream"]');
    await page.fill('[data-testid="stream-title"]', 'Test Live Stream');
    await page.fill('[data-testid="stream-description"]', 'Test Description');
    
    // Set stream times
    const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() + 3 * 60 * 60 * 1000);
    
    await page.fill('[data-testid="start-time"]', startTime.toISOString());
    await page.fill('[data-testid="end-time"]', endTime.toISOString());
    
    // Configure stream settings
    await page.selectOption('[data-testid="stream-quality"]', ['720p', '1080p']);
    await page.check('[data-testid="enable-chat"]');
    await page.check('[data-testid="enable-recording"]');

    // Save schedule
    await page.click('[data-testid="save-stream-schedule"]');
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
  });

  test('should handle batch scheduling', async ({ page }) => {
    await page.click('[data-testid="content-scheduler"]');
    
    // Select multiple videos
    await page.check('[data-testid="video-select-1"]');
    await page.check('[data-testid="video-select-2"]');
    await page.check('[data-testid="video-select-3"]');
    
    // Batch schedule
    await page.click('[data-testid="batch-schedule"]');
    await page.selectOption('[data-testid="batch-timezone"]', 'America/New_York');
    await page.fill('[data-testid="batch-start-time"]', '10:00');
    await page.check('[data-testid="stagger-publishing"]');
    await page.fill('[data-testid="stagger-interval"]', '30');
    
    // Execute batch
    await page.click('[data-testid="execute-batch"]');
    await expect(page.locator('[data-testid="batch-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="batch-complete"]')).toBeVisible({ timeout: 10000 });
  });

  test('should detect schedule conflicts', async ({ page }) => {
    // Create first live stream schedule
    await page.click('[data-testid="content-scheduler"]');
    await page.click('[data-testid="schedule-livestream"]');
    
    const streamTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await page.fill('[data-testid="start-time"]', streamTime.toISOString());
    await page.fill('[data-testid="end-time"]', new Date(streamTime.getTime() + 60 * 60 * 1000).toISOString());
    await page.click('[data-testid="save-stream-schedule"]');
    
    // Try to create conflicting stream
    await page.click('[data-testid="schedule-livestream"]');
    await page.fill('[data-testid="start-time"]', new Date(streamTime.getTime() + 30 * 60 * 1000).toISOString());
    await page.fill('[data-testid="end-time"]', new Date(streamTime.getTime() + 90 * 60 * 1000).toISOString());
    await page.click('[data-testid="save-stream-schedule"]');
    
    // Should show conflict error
    await expect(page.locator('[data-testid="conflict-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="conflict-resolution"]')).toBeVisible();
  });

  test('should handle time zone conversions', async ({ page }) => {
    await page.click('[data-testid="content-scheduler"]');
    await page.click('[data-testid="schedule-video"]');
    
    // Set different time zone
    await page.selectOption('[data-testid="timezone"]', 'Europe/London');
    
    // Schedule time
    const localTime = '10:00';
    await page.fill('[data-testid="schedule-time"]', localTime);
    
    // Verify time zone display
    await expect(page.locator('[data-testid="timezone-display"]')).toContainText('Europe/London');
    await expect(page.locator('[data-testid="local-time-display"]')).toContainText(localTime);
    await expect(page.locator('[data-testid="utc-time-display"]')).toBeVisible();
  });
});
```

### API Testing
```typescript
// API endpoint tests for scheduling
describe('Channel Scheduling API', () => {
  test('POST /api/channels/:id/schedule - create schedule', async () => {
    const response = await fetch('/api/channels/channel123/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: 'video',
        contentId: 'video123',
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        timezone: 'America/New_York',
        notificationSettings: {
          enabled: true,
          reminderTimes: [60, 15, 5]
        }
      })
    });
    
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.status).toBe('scheduled');
  });

  test('GET /api/channels/:id/schedule - list schedules', async () => {
    const response = await fetch('/api/channels/channel123/schedule');
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(Array.isArray(data.schedules)).toBe(true);
    expect(data.schedules.length).toBeGreaterThan(0);
  });
});
```

## Cross-Browser Testing Matrix

| Browser | Version | OS | Priority | Notes |
|---------|---------|----|----------|-------|
| Chrome | Latest | Windows/Mac/Linux | High | Primary testing browser |
| Firefox | Latest | Windows/Mac/Linux | High | Gecko engine compatibility |
| Safari | Latest | Mac | Medium | WebKit engine testing |
| Edge | Latest | Windows | Medium | Chromium-based testing |
| Mobile Chrome | Latest | Android | High | Mobile scheduling experience |
| Mobile Safari | Latest | iOS | High | iOS scheduling experience |

## Cross-Device Testing

| Device | Screen Size | Test Focus | Priority |
|--------|-------------|------------|----------|
| Desktop | 1920x1080 | Full calendar view | High |
| Laptop | 1366x768 | Compact calendar | Medium |
| Tablet | 768x1024 | Touch interactions | High |
| Mobile | 375x667 | Mobile scheduling | High |

## Performance Testing

### Load Testing
- Concurrent users: 100
- Schedule creation rate: 10/second
- Calendar view loading: < 3 seconds
- Batch operations: < 10 seconds

### Stress Testing
- Peak load: 500 concurrent users
- Large schedule sets: 1000+ items
- Memory usage: < 512MB
- CPU usage: < 70%

## Security Testing

### Authentication & Authorization
- JWT token validation
- Role-based access control
- Schedule ownership verification
- API rate limiting

### Data Protection
- Schedule data encryption
- Notification content security
- Audit log integrity
- Time zone data validation

## Accessibility Testing

### WCAG 2.1 AA Compliance
- Keyboard navigation support
- Screen reader compatibility
- Color contrast requirements
- Focus management

### ARIA Labels
- Calendar navigation
- Schedule status indicators
- Form field descriptions
- Error message announcements

## Test Metrics

### Coverage Metrics
- **Code Coverage**: > 90%
- **API Coverage**: 100%
- **UI Coverage**: > 85%
- **Integration Coverage**: > 80%

### Performance Metrics
- **Response Time**: < 2 seconds
- **Throughput**: > 100 requests/second
- **Error Rate**: < 0.1%
- **Availability**: > 99.9%

## Test Deliverables

1. **Test Plan Document** - This file
2. **Test Cases** - Detailed test procedures
3. **Test Scripts** - Automated test implementations
4. **Test Data** - Sample schedules and configurations
5. **Test Reports** - Execution results and metrics
6. **Bug Reports** - Issues found and resolutions

## Test Schedule

| Phase | Duration | Start Date | End Date |
|-------|----------|------------|----------|
| Planning | 2 days | Week 1 | Week 1 |
| Test Case Development | 3 days | Week 1 | Week 2 |
| Environment Setup | 1 day | Week 2 | Week 2 |
| Test Execution | 5 days | Week 2 | Week 3 |
| Bug Fixing | 2 days | Week 3 | Week 3 |
| Regression Testing | 2 days | Week 3 | Week 4 |
| Reporting | 1 day | Week 4 | Week 4 |

## Entry Criteria

- Development complete for scheduling features
- Test environment configured and accessible
- Test data prepared and validated
- Test scripts reviewed and approved
- Team trained on scheduling functionality

## Exit Criteria

- All test cases executed
- 95% pass rate achieved
- Critical and high priority bugs resolved
- Performance benchmarks met
- Security requirements validated
- Documentation completed

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Time zone bugs | Medium | High | Comprehensive time zone testing |
| Queue failures | Low | High | Queue monitoring and recovery |
| Performance issues | Medium | Medium | Load testing and optimization |
| Notification failures | Low | Medium | Redundant notification channels |
| User interface complexity | High | Low | User testing and feedback |

## Test Environment Cleanup

### Data Cleanup
- Remove test schedules
- Clear notification queues
- Reset calendar data
- Clean up test files

### Environment Reset
- Restart scheduling services
- Clear cache and temp files
- Reset database to baseline
- Verify clean state

## Sign-off

**Test Engineer**: _________________________  
**Date**: _________________________  
**Project Manager**: _________________________  
**Date**: _________________________  

---

*This test case is part of the Al Ummah Now comprehensive testing suite. For related test cases, refer to the Channel Management section of the Master Test Index.*