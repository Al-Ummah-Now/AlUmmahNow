# Integration Testing Implementation

Comprehensive integration testing suite for Al Ummah Now backend services covering cross-service workflows and end-to-end scenarios.

## Overview

This testing suite covers:
- **Cross-Service Integration**: API → Queue → Processor → R2 workflows
- **End-to-End User Journeys**: Complete user experience flows
- **Service Communication**: WebSocket, API, and Queue integration
- **Data Flow Validation**: End-to-end data consistency
- **Error Propagation**: Error handling across service boundaries
- **Performance Integration**: Multi-service performance validation

## Integration Test Categories

### 1. Service-to-Service Integration
- **API ↔ Queue**: Message publishing and consumption
- **Queue ↔ Processor**: Message processing workflows
- **Processor ↔ R2**: Data persistence and retrieval
- **API ↔ R2**: Direct storage operations
- **WebSocket ↔ API**: Real-time communication

### 2. End-to-End User Workflows
- **User Registration → Channel Creation → Video Upload**
- **Video Upload → Processing → Publishing → Viewing**
- **User Interaction → Analytics Processing → Reporting**
- **Content Moderation → Notification → User Action**

### 3. Data Integration
- **Data Consistency**: Cross-service data synchronization
- **Transaction Integrity**: Multi-service transaction handling
- **Eventual Consistency**: Asynchronous data propagation
- **Data Validation**: End-to-end data quality checks

## Test Structure

```
integration/
├── README.md                    # This file
├── workflows/                   # End-to-end workflow tests
│   ├── user-registration.test.ts
│   ├── video-upload.test.ts
│   ├── content-consumption.test.ts
│   ├── social-interactions.test.ts
│   ├── analytics-workflow.test.ts
│   └── moderation-workflow.test.ts
├── service-integration/         # Service-to-service integration
│   ├── api-queue.test.ts       # API to Queue integration
│   ├── queue-processor.test.ts # Queue to Processor integration
│   ├── processor-r2.test.ts    # Processor to R2 integration
│   ├── api-r2.test.ts         # API to R2 integration
│   ├── websocket-api.test.ts   # WebSocket to API integration
│   └── cross-service.test.ts   # Multi-service integration
├── data-integration/            # Data integration tests
│   ├── data-consistency.test.ts
│   ├── transaction-integrity.test.ts
│   ├── eventual-consistency.test.ts
│   └── data-validation.test.ts
├── performance-integration/     # Performance integration tests
│   ├── end-to-end-performance.test.ts
│   ├── load-distribution.test.ts
│   ├── bottleneck-analysis.test.ts
│   └── scalability-validation.test.ts
├── error-handling/             # Error handling integration
│   ├── error-propagation.test.ts
│   ├── recovery-scenarios.test.ts
│   ├── timeout-handling.test.ts
│   └── circuit-breaker.test.ts
├── fixtures/                   # Integration test data
│   ├── user-workflows.json
│   ├── video-workflows.json
│   ├── analytics-workflows.json
│   └── error-scenarios.json
├── utils/                      # Integration test utilities
│   ├── test-environment.ts     # Test environment setup
│   ├── service-coordinator.ts  # Service orchestration
│   ├── data-validator.ts       # Data validation utilities
│   └── workflow-helpers.ts    # Workflow test helpers
└── reports/                    # Integration test reports
    ├── workflow-results/       # Workflow test results
    ├── performance-metrics/    # Performance metrics
    └── integration-analysis/  # Integration analysis reports
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- pnpm package manager
- All backend services running

### Environment Setup

```bash
# Start all services for integration testing
docker-compose -f docker-compose.integration.yml up -d

# Wait for services to be ready
pnpm run integration:wait-for-services

# Setup test data
pnpm run integration:setup
```

### Running Integration Tests

```bash
# Run all integration tests
pnpm test:integration

# Run specific workflow tests
pnpm test:workflows

# Run service integration tests
pnpm test:service-integration

# Run data integration tests
pnpm test:data-integration

# Run performance integration tests
pnpm test:performance-integration

# Run error handling tests
pnpm test:error-handling

# Run with coverage
pnpm test:integration:coverage

# Run in watch mode
pnpm test:integration:watch
```

## Integration Test Implementation

### 1. End-to-End User Workflows

```typescript
// workflows/video-upload.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestEnvironment } from '../utils/test-environment';
import { WorkflowHelpers } from '../utils/workflow-helpers';
import { DataValidator } from '../utils/data-validator';

describe('Video Upload Workflow Integration', () => {
  let testEnv: TestEnvironment;
  let workflow: WorkflowHelpers;
  let validator: DataValidator;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
    workflow = new WorkflowHelpers(testEnv);
    validator = new DataValidator(testEnv);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Complete Video Upload Workflow', () => {
    it('should handle end-to-end video upload process', async () => {
      // 1. User Registration
      const user = await workflow.registerUser({
        email: 'creator@example.com',
        password: 'SecurePass123!',
        username: 'testcreator',
        firstName: 'Test',
        lastName: 'Creator'
      });

      expect(user.id).toBeTruthy();
      expect(user.email).toBe('creator@example.com');

      // 2. Channel Creation
      const channel = await workflow.createChannel(user.id, {
        name: 'Test Creator Channel',
        description: 'A channel for testing video uploads'
      });

      expect(channel.id).toBeTruthy();
      expect(channel.name).toBe('Test Creator Channel');
      expect(channel.userId).toBe(user.id);

      // 3. Video Upload
      const videoData = {
        title: 'Test Video Upload',
        description: 'This is a test video for integration testing',
        tags: ['test', 'integration', 'upload'],
        visibility: 'public' as const,
        duration: 300,
        file: await workflow.createTestVideoFile('test-video.mp4')
      };

      const video = await workflow.uploadVideo(user.id, channel.id, videoData);

      expect(video.id).toBeTruthy();
      expect(video.title).toBe('Test Video Upload');
      expect(video.status).toBe('processing');

      // 4. Wait for Processing (simulate async processing)
      await workflow.waitForVideoProcessing(video.id, 30000); // 30 seconds

      // 5. Verify Video is Processed and Published
      const processedVideo = await workflow.getVideo(video.id);
      expect(processedVideo.status).toBe('published');
      expect(processedVideo.streamUrl).toBeTruthy();
      expect(processedVideo.thumbnailUrl).toBeTruthy();

      // 6. Verify Analytics Tracking
      const analytics = await workflow.getVideoAnalytics(video.id);
      expect(analytics.uploadDate).toBeTruthy();
      expect(analytics.processingTime).toBeGreaterThan(0);

      // 7. Verify Search Indexing
      const searchResults = await workflow.searchVideos('Test Video Upload');
      expect(searchResults.some(v => v.id === video.id)).toBe(true);

      // 8. Data Consistency Validation
      const consistencyCheck = await validator.validateVideoDataConsistency(video.id);
      expect(consistencyCheck.isValid).toBe(true);
      expect(consistencyCheck.errors).toHaveLength(0);
    });

    it('should handle video upload with errors gracefully', async () => {
      const user = await workflow.registerUser({
        email: 'creator2@example.com',
        password: 'SecurePass123!',
        username: 'testcreator2'
      });

      const channel = await workflow.createChannel(user.id, {
        name: 'Test Creator Channel 2'
      });

      // Attempt upload with invalid file
      const invalidVideoData = {
        title: 'Invalid Video',
        description: 'This should fail',
        file: Buffer.from('invalid video data')
      };

      await expect(
        workflow.uploadVideo(user.id, channel.id, invalidVideoData)
      ).rejects.toThrow();

      // Verify no partial data was created
      const userVideos = await workflow.getUserVideos(user.id);
      expect(userVideos.filter(v => v.title === 'Invalid Video')).toHaveLength(0);
    });
  });

  describe('Video Viewing Workflow', () => {
    it('should track complete video viewing journey', async () => {
      // Setup: Create user, channel, and video
      const { user, channel, video } = await workflow.setupVideoContent();

      // 1. User discovers video through search
      const searchResults = await workflow.searchVideos(video.title);
      const foundVideo = searchResults.find(v => v.id === video.id);
      expect(foundVideo).toBeTruthy();

      // 2. User views video
      const viewSession = await workflow.startVideoView(user.id, video.id);
      expect(viewSession.sessionId).toBeTruthy();

      // 3. Simulate watching progress
      await workflow.updateWatchProgress(user.id, video.id, {
        watchTime: 60,
        currentPosition: 60,
        duration: video.duration || 300
      });

      // 4. User completes video
      await workflow.completeVideoView(user.id, video.id, {
        totalWatchTime: 300,
        completed: true
      });

      // 5. Verify analytics tracking
      const analytics = await workflow.getVideoAnalytics(video.id);
      expect(analytics.viewCount).toBeGreaterThan(0);
      expect(analytics.totalWatchTime).toBeGreaterThan(0);

      // 6. Verify watch history
      const watchHistory = await workflow.getUserWatchHistory(user.id);
      const historyEntry = watchHistory.find(h => h.videoId === video.id);
      expect(historyEntry).toBeTruthy();
      expect(historyEntry.completed).toBe(true);

      // 7. Verify recommendations updated
      const recommendations = await workflow.getUserRecommendations(user.id);
      expect(recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Social Interaction Workflow', () => {
    it('should handle complete social interaction flow', async () => {
      // Setup: Create creator with video and viewer
      const creator = await workflow.registerUser({
        email: 'creator@example.com',
        username: 'creator'
      });
      const channel = await workflow.createChannel(creator.id, {
        name: 'Creator Channel'
      });
      const video = await workflow.uploadAndPublishVideo(creator.id, channel.id);

      const viewer = await workflow.registerUser({
        email: 'viewer@example.com',
        username: 'viewer'
      });

      // 1. Viewer subscribes to creator
      const subscription = await workflow.subscribeToChannel(viewer.id, channel.id);
      expect(subscription.active).toBe(true);

      // 2. Viewer likes video
      const like = await workflow.likeVideo(viewer.id, video.id);
      expect(like.liked).toBe(true);

      // 3. Viewer comments on video
      const comment = await workflow.commentOnVideo(viewer.id, video.id, {
        content: 'Great video! Thanks for sharing.'
      });
      expect(comment.id).toBeTruthy();
      expect(comment.content).toBe('Great video! Thanks for sharing.');

      // 4. Creator receives notifications
      await workflow.waitForNotifications(creator.id, 5000);
      const notifications = await workflow.getUserNotifications(creator.id);
      
      const subscriptionNotification = notifications.find(n => 
        n.type === 'new_subscriber' && n.data.userId === viewer.id
      );
      const likeNotification = notifications.find(n => 
        n.type === 'video_like' && n.data.userId === viewer.id
      );
      const commentNotification = notifications.find(n => 
        n.type === 'new_comment' && n.data.userId === viewer.id
      );

      expect(subscriptionNotification).toBeTruthy();
      expect(likeNotification).toBeTruthy();
      expect(commentNotification).toBeTruthy();

      // 5. Verify analytics updated
      const videoAnalytics = await workflow.getVideoAnalytics(video.id);
      expect(videoAnalytics.likeCount).toBe(1);
      expect(videoAnalytics.commentCount).toBe(1);

      const channelAnalytics = await workflow.getChannelAnalytics(channel.id);
      expect(channelAnalytics.subscriberCount).toBe(1);
    });
  });
});
```

### 2. Service Integration Tests

```typescript
// service-integration/api-queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestEnvironment } from '../utils/test-environment';
import { ServiceCoordinator } from '../utils/service-coordinator';

describe('API to Queue Integration', () => {
  let testEnv: TestEnvironment;
  let coordinator: ServiceCoordinator;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
    coordinator = new ServiceCoordinator(testEnv);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Message Publishing', () => {
    it('should publish video view events to queue', async () => {
      // Create test video and user
      const { user, video } = await coordinator.createTestVideo();

      // Simulate video view through API
      const viewResponse = await coordinator.apiClient.post(`/api/videos/${video.id}/view`, {
        watchTime: 120,
        duration: 300
      });

      expect(viewResponse.status).toBe(200);

      // Verify message was published to queue
      await coordinator.waitForQueueMessage('VideoView', 5000);
      const messages = await coordinator.getQueueMessages();
      
      const viewMessage = messages.find(msg => 
        msg.type === 'VideoView' && 
        msg.data.videoId === video.id && 
        msg.data.userId === user.id
      );

      expect(viewMessage).toBeTruthy();
      expect(viewMessage.data.watchTime).toBe(120);
      expect(viewMessage.data.duration).toBe(300);
    });

    it('should publish user interaction events to queue', async () => {
      const { user, video } = await coordinator.createTestVideo();

      // Like video through API
      const likeResponse = await coordinator.apiClient.post(`/api/videos/${video.id}/like`);
      expect(likeResponse.status).toBe(200);

      // Verify like message was published
      await coordinator.waitForQueueMessage('VideoLike', 5000);
      const messages = await coordinator.getQueueMessages();
      
      const likeMessage = messages.find(msg => 
        msg.type === 'VideoLike' && 
        msg.data.videoId === video.id && 
        msg.data.userId === user.id
      );

      expect(likeMessage).toBeTruthy();
    });

    it('should publish batch events efficiently', async () => {
      const { user, video } = await coordinator.createTestVideo();

      // Generate multiple interactions rapidly
      const interactions = [
        () => coordinator.apiClient.post(`/api/videos/${video.id}/view`, { watchTime: 30 }),
        () => coordinator.apiClient.post(`/api/videos/${video.id}/like`),
        () => coordinator.apiClient.post(`/api/videos/${video.id}/view`, { watchTime: 60 }),
        () => coordinator.apiClient.post(`/api/comments`, {
          videoId: video.id,
          content: 'Test comment'
        })
      ];

      // Execute all interactions
      const responses = await Promise.all(interactions.map(fn => fn()));
      expect(responses.every(r => r.status === 200)).toBe(true);

      // Wait for all messages to be processed
      await coordinator.waitForQueueMessages(['VideoView', 'VideoLike', 'CommentCreate'], 10000);
      
      const messages = await coordinator.getQueueMessages();
      expect(messages.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Message Format Validation', () => {
    it('should publish properly formatted messages', async () => {
      const { user, video } = await coordinator.createTestVideo();

      await coordinator.apiClient.post(`/api/videos/${video.id}/view`, {
        watchTime: 120,
        duration: 300
      });

      await coordinator.waitForQueueMessage('VideoView', 5000);
      const messages = await coordinator.getQueueMessages();
      const viewMessage = messages.find(msg => msg.type === 'VideoView');

      // Validate message structure
      expect(viewMessage).toHaveProperty('id');
      expect(viewMessage).toHaveProperty('type');
      expect(viewMessage).toHaveProperty('timestamp');
      expect(viewMessage).toHaveProperty('data');
      expect(viewMessage).toHaveProperty('priority');

      // Validate data structure
      expect(viewMessage.data).toHaveProperty('videoId');
      expect(viewMessage.data).toHaveProperty('userId');
      expect(viewMessage.data).toHaveProperty('watchTime');
      expect(viewMessage.data).toHaveProperty('duration');

      // Validate data types
      expect(typeof viewMessage.id).toBe('string');
      expect(typeof viewMessage.type).toBe('string');
      expect(typeof viewMessage.timestamp).toBe('string');
      expect(typeof viewMessage.data).toBe('object');
    });

    it('should handle message publishing failures gracefully', async () => {
      // Simulate queue failure
      await coordinator.simulateQueueFailure();

      const { video } = await coordinator.createTestVideo();

      // Attempt to publish message
      const response = await coordinator.apiClient.post(`/api/videos/${video.id}/view`, {
        watchTime: 120
      });

      // API should still respond successfully (async processing)
      expect(response.status).toBe(200);

      // But message should not be in queue
      await new Promise(resolve => setTimeout(resolve, 2000));
      const messages = await coordinator.getQueueMessages();
      expect(messages.filter(msg => msg.type === 'VideoView')).toHaveLength(0);
    });
  });

  describe('Queue Performance', () => {
    it('should handle high-volume message publishing', async () => {
      const { video } = await coordinator.createTestVideo();
      const messageCount = 1000;

      // Publish many view events
      const startTime = Date.now();
      const promises = Array.from({ length: messageCount }, (_, i) =>
        coordinator.apiClient.post(`/api/videos/${video.id}/view`, {
          watchTime: i * 10,
          duration: 300
        })
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();

      // All requests should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // Performance should be reasonable
      const totalTime = endTime - startTime;
      const avgTimePerRequest = totalTime / messageCount;
      expect(avgTimePerRequest).toBeLessThan(100); // Less than 100ms per request

      // Wait for messages to be processed
      await coordinator.waitForQueueMessageCount(messageCount, 30000);
      
      const messages = await coordinator.getQueueMessages();
      expect(messages.filter(msg => msg.type === 'VideoView').length).toBeGreaterThanOrEqual(messageCount * 0.95); // Allow 5% loss
    });
  });
});
```

### 3. Data Integration Tests

```typescript
// data-integration/data-consistency.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestEnvironment } from '../utils/test-environment';
import { DataValidator } from '../utils/data-validator';

describe('Data Consistency Integration', () => {
  let testEnv: TestEnvironment;
  let validator: DataValidator;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
    validator = new DataValidator(testEnv);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Video Data Consistency', () => {
    it('should maintain consistency across all services', async () => {
      // Create video through API
      const video = await validator.createTestVideo({
        title: 'Consistency Test Video',
        description: 'Testing data consistency',
        tags: ['test', 'consistency']
      });

      // Wait for processing
      await validator.waitForVideoProcessing(video.id);

      // Validate data across services
      const consistencyReport = await validator.validateVideoDataConsistency(video.id);

      expect(consistencyReport.isValid).toBe(true);
      expect(consistencyReport.errors).toHaveLength(0);

      // Check specific consistencies
      expect(consistencyReport.apiData.title).toBe(consistencyReport.searchData.title);
      expect(consistencyReport.apiData.id).toBe(consistencyReport.analyticsData.videoId);
      expect(consistencyReport.r2Metadata.id).toBe(video.id);
    });

    it('should handle concurrent updates consistently', async () => {
      const video = await validator.createTestVideo();

      // Simulate concurrent updates
      const updates = [
        () => validator.updateVideoTitle(video.id, 'New Title 1'),
        () => validator.updateVideoDescription(video.id, 'New Description 1'),
        () => validator.updateVideoTags(video.id, ['new', 'tags'])
      ];

      await Promise.all(updates);

      // Wait for eventual consistency
      await validator.waitForEventualConsistency(video.id);

      // Validate final state
      const finalState = await validator.getVideoDataFromAllServices(video.id);
      
      // All services should have the same final state
      const titles = Object.values(finalState).map(data => data.title);
      expect(new Set(titles).size).toBe(1); // All titles should be the same
    });
  });

  describe('User Data Consistency', () => {
    it('should maintain user profile consistency', async () => {
      const user = await validator.createTestUser({
        username: 'consistencyuser',
        email: 'consistency@example.com'
      });

      // Update user profile
      await validator.updateUserProfile(user.id, {
        bio: 'Updated bio',
        avatar: 'new-avatar-url'
      });

      // Validate consistency across services
      const consistencyReport = await validator.validateUserDataConsistency(user.id);

      expect(consistencyReport.isValid).toBe(true);
      expect(consistencyReport.apiData.bio).toBe(consistencyReport.authData.bio);
      expect(consistencyReport.analyticsData.userId).toBe(user.id);
    });

    it('should handle user subscription consistency', async () => {
      const { user, channel } = await validator.createTestSubscription();

      // Verify subscription exists in all services
      const consistencyReport = await validator.validateSubscriptionConsistency(
        user.id,
        channel.id
      );

      expect(consistencyReport.isValid).toBe(true);
      expect(consistencyReport.apiSubscription.active).toBe(true);
      expect(consistencyReport.analyticsSubscription.active).toBe(true);
      expect(consistencyReport.notificationSubscription.active).toBe(true);
    });
  });

  describe('Analytics Data Consistency', () => {
    it('should maintain analytics consistency across updates', async () => {
      const { user, video } = await validator.createTestVideo();

      // Generate interactions
      await validator.simulateVideoViews(video.id, 100);
      await validator.simulateVideoLikes(video.id, 25);
      await validator.simulateVideoComments(video.id, 10);

      // Wait for analytics processing
      await validator.waitForAnalyticsProcessing(video.id);

      // Validate analytics consistency
      const analyticsReport = await validator.validateAnalyticsConsistency(video.id);

      expect(analyticsReport.isValid).toBe(true);
      expect(analyticsReport.viewAnalytics.viewCount).toBe(100);
      expect(analyticsReport.likeAnalytics.likeCount).toBe(25);
      expect(analyticsReport.commentAnalytics.commentCount).toBe(10);

      // Cross-validate with raw data
      expect(analyticsReport.viewAnalytics.viewCount).toBe(analyticsReport.rawViews.length);
      expect(analyticsReport.likeAnalytics.likeCount).toBe(analyticsReport.rawLikes.length);
    });
  });

  describe('Eventual Consistency', () => {
    it('should achieve eventual consistency within acceptable time', async () => {
      const video = await validator.createTestVideo();

      // Generate rapid interactions
      const interactions = Array.from({ length: 50 }, (_, i) =>
        validator.simulateVideoView(video.id, { watchTime: i * 10 })
      );

      await Promise.all(interactions);

      // Measure time to consistency
      const startTime = Date.now();
      await validator.waitForEventualConsistency(video.id);
      const consistencyTime = Date.now() - startTime;

      // Should achieve consistency within reasonable time
      expect(consistencyTime).toBeLessThan(30000); // 30 seconds

      // Validate final consistency
      const consistencyReport = await validator.validateVideoDataConsistency(video.id);
      expect(consistencyReport.isValid).toBe(true);
    });
  });
});
```

### 4. Performance Integration Tests

```typescript
// performance-integration/end-to-end-performance.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestEnvironment } from '../utils/test-environment';
import { PerformanceMonitor } from '../utils/performance-monitor';

describe('End-to-End Performance Integration', () => {
  let testEnv: TestEnvironment;
  let monitor: PerformanceMonitor;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
    monitor = new PerformanceMonitor(testEnv);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Complete Workflow Performance', () => {
    it('should complete video upload workflow within performance targets', async () => {
      const performanceTargets = {
        registration: 2000,      // 2 seconds
        channelCreation: 1500,    // 1.5 seconds
        videoUpload: 10000,       // 10 seconds
        videoProcessing: 30000,    // 30 seconds
        totalWorkflow: 45000       // 45 seconds total
      };

      // Monitor complete workflow
      const workflowMetrics = await monitor.measureWorkflow('video-upload', async () => {
        // 1. User Registration
        const registrationTime = await monitor.measureOperation('user-registration', async () => {
          return await testEnv.registerUser({
            email: 'perf@example.com',
            password: 'TestPass123!',
            username: 'perfuser'
          });
        });

        expect(registrationTime.duration).toBeLessThan(performanceTargets.registration);

        // 2. Channel Creation
        const channelCreationTime = await monitor.measureOperation('channel-creation', async () => {
          return await testEnv.createChannel(registrationTime.result.id, {
            name: 'Performance Test Channel'
          });
        });

        expect(channelCreationTime.duration).toBeLessThan(performanceTargets.channelCreation);

        // 3. Video Upload
        const videoUploadTime = await monitor.measureOperation('video-upload', async () => {
          return await testEnv.uploadVideo(registrationTime.result.id, channelCreationTime.result.id, {
            title: 'Performance Test Video',
            file: await testEnv.createTestVideoFile('perf-test.mp4')
          });
        });

        expect(videoUploadTime.duration).toBeLessThan(performanceTargets.videoUpload);

        // 4. Wait for Processing
        const processingTime = await monitor.measureOperation('video-processing', async () => {
          return await testEnv.waitForVideoProcessing(videoUploadTime.result.id);
        });

        expect(processingTime.duration).toBeLessThan(performanceTargets.videoProcessing);

        return {
          user: registrationTime.result,
          channel: channelCreationTime.result,
          video: videoUploadTime.result
        };
      });

      // Validate overall workflow performance
      expect(workflowMetrics.duration).toBeLessThan(performanceTargets.totalWorkflow);

      // Validate resource usage
      expect(workflowMetrics.memoryUsage).toBeLessThan(512 * 1024 * 1024); // 512MB
      expect(workflowMetrics.cpuUsage).toBeLessThan(80); // 80%
    });

    it('should handle concurrent workflows efficiently', async () => {
      const concurrentWorkflows = 10;
      const maxAcceptableTime = 60000; // 60 seconds

      // Start multiple workflows concurrently
      const workflowPromises = Array.from({ length: concurrentWorkflows }, (_, i) =>
        monitor.measureWorkflow(`video-upload-${i}`, async () => {
          const user = await testEnv.registerUser({
            email: `perf${i}@example.com`,
            password: 'TestPass123!',
            username: `perfuser${i}`
          });

          const channel = await testEnv.createChannel(user.id, {
            name: `Performance Test Channel ${i}`
          });

          const video = await testEnv.uploadVideo(user.id, channel.id, {
            title: `Performance Test Video ${i}`,
            file: await testEnv.createTestVideoFile(`perf-test-${i}.mp4`)
          });

          return await testEnv.waitForVideoProcessing(video.id);
        })
      );

      // Wait for all workflows to complete
      const startTime = Date.now();
      const results = await Promise.all(workflowPromises);
      const totalTime = Date.now() - startTime;

      // Validate concurrent performance
      expect(totalTime).toBeLessThan(maxAcceptableTime);
      expect(results.every(r => r.success)).toBe(true);

      // Validate resource efficiency
      const avgMemoryUsage = results.reduce((sum, r) => sum + r.memoryUsage, 0) / results.length;
      expect(avgMemoryUsage).toBeLessThan(256 * 1024 * 1024); // 256MB average
    });
  });

  describe('Service Communication Performance', () => {
    it('should maintain low latency for API to Queue communication', async () => {
      const messageCount = 1000;
      const maxLatency = 100; // 100ms

      const latencies = [];

      for (let i = 0; i < messageCount; i++) {
        const startTime = Date.now();
        
        await testEnv.publishVideoViewEvent({
          videoId: `video-${i}`,
          userId: `user-${i}`,
          watchTime: 120
        });

        const latency = Date.now() - startTime;
        latencies.push(latency);
      }

      // Calculate latency statistics
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      expect(avgLatency).toBeLessThan(maxLatency);
      expect(p95Latency).toBeLessThan(maxLatency * 2);
    });

    it('should handle high-throughput message processing', async () => {
      const messageCount = 10000;
      const targetThroughput = 1000; // messages per second

      const startTime = Date.now();
      
      // Publish messages
      const publishPromises = Array.from({ length: messageCount }, (_, i) =>
        testEnv.publishVideoViewEvent({
          videoId: `video-${i}`,
          userId: `user-${i}`,
          watchTime: 120
        })
      );

      await Promise.all(publishPromises);
      const publishTime = Date.now() - startTime;

      // Wait for processing
      await testEnv.waitForMessageProcessing(messageCount, 60000);
      const totalTime = Date.now() - startTime;

      // Calculate throughput
      const throughput = messageCount / (totalTime / 1000);
      expect(throughput).toBeGreaterThan(targetThroughput);

      // Validate processing efficiency
      const processingTime = totalTime - publishTime;
      expect(processingTime).toBeLessThan(publishTime * 2); // Processing shouldn't take much longer than publishing
    });
  });
});
```

## Test Environment Setup

### Docker Compose for Integration Testing

```yaml
# docker-compose.integration.yml
version: '3.8'

services:
  # API Service
  api-videos:
    build:
      context: ../../apps/api-videos
      dockerfile: Dockerfile
    ports:
      - "3086:3086"
    environment:
      - NODE_ENV=test
      - R2_BUCKET=al-ummah-now-test
      - QUEUE_NAME=alummah-messages-test
    depends_on:
      - redis
      - minio

  # Processor Service
  processor:
    build:
      context: ../../apps/processor
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=test
      - R2_BUCKET=al-ummah-now-test
      - QUEUE_NAME=alummah-messages-test
    depends_on:
      - redis
      - minio

  # WebSocket Server
  websocket-server:
    build:
      context: ../../apps/websocket-server
      dockerfile: Dockerfile
    ports:
      - "8787:8787"
    environment:
      - NODE_ENV=test
    depends_on:
      - redis

  # Redis for caching and sessions
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes

  # MinIO for S3-compatible storage (R2 simulation)
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=testuser
      - MINIO_ROOT_PASSWORD=testpass123
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

  # Mock Queue Service
  queue-mock:
    build:
      context: ./mocks/queue-service
    ports:
      - "4567:4567"
    environment:
      - NODE_ENV=test

volumes:
  minio_data:
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  pull_request:
    paths:
      - 'apps/**'
  schedule:
    - cron: '0 4 * * *' # Daily at 4 AM UTC

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        
      - name: Install dependencies
        run: pnpm install
        
      - name: Build shared types
        run: pnpm --filter @al-ummah/shared-types build
        
      - name: Start integration environment
        run: |
          cd docs/test-cases/backend/integration
          docker-compose -f docker-compose.integration.yml up -d
          
      - name: Wait for services
        run: |
          cd docs/test-cases/backend/integration
          pnpm run integration:wait-for-services
          
      - name: Run integration tests
        run: |
          cd docs/test-cases/backend/integration
          pnpm test:integration
          
      - name: Generate integration report
        run: |
          cd docs/test-cases/backend/integration
          pnpm run integration:report
          
      - name: Upload integration reports
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: integration-reports
          path: docs/test-cases/backend/integration/reports/
          
      - name: Cleanup integration environment
        if: always()
        run: |
          cd docs/test-cases/backend/integration
          docker-compose -f docker-compose.integration.yml down -v
```

## Best Practices

### Integration Testing Guidelines
1. **Test Real Scenarios**: Focus on realistic user workflows
2. **Test Service Boundaries**: Validate communication between services
3. **Test Data Flow**: Ensure data consistency across services
4. **Test Error Scenarios**: Verify error handling across boundaries
5. **Test Performance**: Validate end-to-end performance

### Environment Management
1. **Isolated Environments**: Use dedicated test environments
2. **Consistent Data**: Use predictable test data
3. **Clean State**: Start with clean state for each test
4. **Resource Management**: Monitor and limit resource usage
5. **Parallel Execution**: Run tests in parallel when possible

### Data Management
1. **Data Factories**: Use factories for test data generation
2. **Data Cleanup**: Clean up data after each test
3. **Data Validation**: Validate data consistency
4. **Data Privacy**: Use anonymized test data
5. **Data Versioning**: Version test data for consistency

### Monitoring and Reporting
1. **Comprehensive Logging**: Log all integration test activities
2. **Performance Metrics**: Track performance across tests
3. **Error Tracking**: Track and analyze integration errors
4. **Trend Analysis**: Monitor performance trends over time
5. **Alerting**: Alert on integration test failures