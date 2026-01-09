import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MessageProcessor } from '../../../apps/processor/src/messageProcessor';
import { QueueMock } from '../mocks/queue.mock';
import { R2Mock } from '../mocks/r2.mock';
import { MessageFactory } from '../helpers/messageFactory';

describe('MessageProcessor', () => {
  let processor: MessageProcessor;
  let queueMock: QueueMock;
  let r2Mock: R2Mock;

  beforeEach(() => {
    queueMock = new QueueMock();
    r2Mock = new R2Mock();
    processor = new MessageProcessor({
      queue: queueMock,
      storage: r2Mock,
      maxRetries: 3,
      batchSize: 10
    });
  });

  afterEach(() => {
    queueMock.clear();
    r2Mock.clear();
  });

  describe('Profile Message Processing', () => {
    describe('ProfileCreate', () => {
      it('should process profile creation successfully', async () => {
        const message = MessageFactory.createProfileMessage('ProfileCreate', {
          email: 'test@example.com',
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.profileCreated).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });

      it('should handle duplicate profile creation', async () => {
        const message = MessageFactory.createProfileMessage('ProfileCreate', {
          userId: 'existing-user',
          email: 'existing@example.com'
        });

        // Process twice
        await processor.processMessage(message);
        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.duplicateHandled).toBe(true);
      });

      it('should validate required profile fields', async () => {
        const message = MessageFactory.createProfileMessage('ProfileCreate', {
          email: '', // Invalid empty email
          username: 'testuser'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation');
      });
    });

    describe('ProfileUpdate', () => {
      it('should process profile update successfully', async () => {
        const message = MessageFactory.createProfileMessage('ProfileUpdate', {
          userId: 'user-123',
          username: 'newusername',
          bio: 'Updated bio'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.profileUpdated).toBe(true);
      });

      it('should handle non-existent profile update', async () => {
        const message = MessageFactory.createProfileMessage('ProfileUpdate', {
          userId: 'non-existent-user'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('ProfileDelete', () => {
      it('should process profile deletion successfully', async () => {
        const message = MessageFactory.createProfileMessage('ProfileDelete', {
          userId: 'user-123'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.profileDeleted).toBe(true);
        expect(result.dataCleanup).toBe(true);
      });

      it('should handle profile deletion with dependencies', async () => {
        const message = MessageFactory.createProfileMessage('ProfileDelete', {
          userId: 'user-with-videos'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.dependencyCleanup).toBe(true);
      });
    });

    describe('ProfileView', () => {
      it('should track profile views correctly', async () => {
        const message = MessageFactory.createProfileMessage('ProfileView', {
          profileId: 'profile-123',
          viewerId: 'viewer-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.viewTracked).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });

      it('should not track self views', async () => {
        const message = MessageFactory.createProfileMessage('ProfileView', {
          profileId: 'profile-123',
          viewerId: 'profile-123' // Same user
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.viewTracked).toBe(false);
        expect(result.selfViewIgnored).toBe(true);
      });
    });
  });

  describe('Video Message Processing', () => {
    describe('VideoCreate', () => {
      it('should process video creation successfully', async () => {
        const message = MessageFactory.createVideoMessage('VideoCreate', {
          title: 'Test Video',
          description: 'Test description',
          channelId: 'channel-123',
          visibility: 'public'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.videoCreated).toBe(true);
        expect(result.searchIndexUpdated).toBe(true);
      });

      it('should validate video metadata', async () => {
        const message = MessageFactory.createVideoMessage('VideoCreate', {
          title: '', // Invalid empty title
          description: 'Valid description'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation');
      });
    });

    describe('VideoView', () => {
      it('should track video views correctly', async () => {
        const message = MessageFactory.createVideoMessage('VideoView', {
          videoId: 'video-123',
          userId: 'user-456',
          watchTime: 120,
          duration: 300
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.viewTracked).toBe(true);
        expect(result.watchHistoryUpdated).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });

      it('should handle partial watch progress', async () => {
        const message = MessageFactory.createVideoMessage('VideoView', {
          videoId: 'video-123',
          userId: 'user-456',
          watchTime: 30,
          duration: 300,
          completed: false
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.watchHistoryUpdated).toBe(true);
        expect(result.completed).toBe(false);
      });

      it('should mark video as completed when 90% watched', async () => {
        const message = MessageFactory.createVideoMessage('VideoView', {
          videoId: 'video-123',
          userId: 'user-456',
          watchTime: 270,
          duration: 300
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.completed).toBe(true);
      });
    });

    describe('VideoLike/Unlike', () => {
      it('should process video like successfully', async () => {
        const message = MessageFactory.createVideoMessage('VideoLike', {
          videoId: 'video-123',
          userId: 'user-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.likeRecorded).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });

      it('should handle duplicate likes', async () => {
        const message = MessageFactory.createVideoMessage('VideoLike', {
          videoId: 'video-123',
          userId: 'user-456'
        });

        // Like twice
        await processor.processMessage(message);
        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.duplicateIgnored).toBe(true);
      });

      it('should process video unlike successfully', async () => {
        const message = MessageFactory.createVideoMessage('VideoUnlike', {
          videoId: 'video-123',
          userId: 'user-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.likeRemoved).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });
    });
  });

  describe('Channel Message Processing', () => {
    describe('ChannelCreate', () => {
      it('should process channel creation successfully', async () => {
        const message = MessageFactory.createChannelMessage('ChannelCreate', {
          name: 'Test Channel',
          description: 'Test channel description',
          userId: 'user-123'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.channelCreated).toBe(true);
        expect(result.searchIndexUpdated).toBe(true);
      });
    });

    describe('ChannelView', () => {
      it('should track channel views correctly', async () => {
        const message = MessageFactory.createChannelMessage('ChannelView', {
          channelId: 'channel-123',
          viewerId: 'viewer-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.viewTracked).toBe(true);
        expect(result.analyticsUpdated).toBe(true);
      });
    });
  });

  describe('Comment Message Processing', () => {
    describe('CommentCreate', () => {
      it('should process comment creation successfully', async () => {
        const message = MessageFactory.createCommentMessage('CommentCreate', {
          videoId: 'video-123',
          userId: 'user-456',
          content: 'Great video!'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.commentCreated).toBe(true);
        expect(result.notificationSent).toBe(true);
      });

      it('should validate comment content', async () => {
        const message = MessageFactory.createCommentMessage('CommentCreate', {
          videoId: 'video-123',
          userId: 'user-456',
          content: '' // Invalid empty comment
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation');
      });
    });

    describe('CommentLike', () => {
      it('should process comment like successfully', async () => {
        const message = MessageFactory.createCommentMessage('CommentLike', {
          commentId: 'comment-123',
          userId: 'user-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.likeRecorded).toBe(true);
      });
    });
  });

  describe('Subscription Message Processing', () => {
    describe('Subscribe', () => {
      it('should process channel subscription successfully', async () => {
        const message = MessageFactory.createSubscriptionMessage('Subscribe', {
          userId: 'user-123',
          channelId: 'channel-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.subscriptionRecorded).toBe(true);
        expect(result.channelStatsUpdated).toBe(true);
        expect(result.notificationSent).toBe(true);
      });

      it('should handle duplicate subscriptions', async () => {
        const message = MessageFactory.createSubscriptionMessage('Subscribe', {
          userId: 'user-123',
          channelId: 'channel-456'
        });

        // Subscribe twice
        await processor.processMessage(message);
        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.duplicateIgnored).toBe(true);
      });
    });

    describe('Unsubscribe', () => {
      it('should process channel unsubscription successfully', async () => {
        const message = MessageFactory.createSubscriptionMessage('Unsubscribe', {
          userId: 'user-123',
          channelId: 'channel-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.subscriptionRemoved).toBe(true);
        expect(result.channelStatsUpdated).toBe(true);
      });
    });
  });

  describe('Playlist Message Processing', () => {
    describe('PlaylistCreate', () => {
      it('should process playlist creation successfully', async () => {
        const message = MessageFactory.createPlaylistMessage('PlaylistCreate', {
          name: 'My Playlist',
          userId: 'user-123',
          isPublic: true
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.playlistCreated).toBe(true);
      });
    });

    describe('PlaylistAdd', () => {
      it('should add video to playlist successfully', async () => {
        const message = MessageFactory.createPlaylistMessage('PlaylistAdd', {
          playlistId: 'playlist-123',
          videoId: 'video-456',
          userId: 'user-123'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.videoAdded).toBe(true);
        expect(result.playlistUpdated).toBe(true);
      });

      it('should handle duplicate video in playlist', async () => {
        const message = MessageFactory.createPlaylistMessage('PlaylistAdd', {
          playlistId: 'playlist-123',
          videoId: 'video-456',
          userId: 'user-123'
        });

        // Add twice
        await processor.processMessage(message);
        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.duplicateIgnored).toBe(true);
      });
    });
  });

  describe('Watch History Message Processing', () => {
    describe('WatchHistoryUpdate', () => {
      it('should update watch history successfully', async () => {
        const message = MessageFactory.createWatchHistoryMessage('WatchHistoryUpdate', {
          userId: 'user-123',
          videoId: 'video-456',
          watchTime: 120,
          duration: 300,
          lastPosition: 120,
          completed: false
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.watchHistoryUpdated).toBe(true);
        expect(result.progressTracked).toBe(true);
      });

      it('should handle watch history completion', async () => {
        const message = MessageFactory.createWatchHistoryMessage('WatchHistoryUpdate', {
          userId: 'user-123',
          videoId: 'video-456',
          watchTime: 300,
          duration: 300,
          lastPosition: 300,
          completed: true
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.watchHistoryUpdated).toBe(true);
        expect(result.completionRecorded).toBe(true);
      });
    });

    describe('WatchHistoryDelete', () => {
      it('should delete watch history successfully', async () => {
        const message = MessageFactory.createWatchHistoryMessage('WatchHistoryDelete', {
          userId: 'user-123',
          videoId: 'video-456'
        });

        const result = await processor.processMessage(message);

        expect(result.success).toBe(true);
        expect(result.watchHistoryDeleted).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid message types', async () => {
      const invalidMessage = {
        id: 'msg-invalid',
        type: 'InvalidMessageType',
        timestamp: new Date().toISOString(),
        data: {}
      };

      const result = await processor.processMessage(invalidMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid message type');
    });

    it('should handle malformed messages', async () => {
      const malformedMessage = {
        // Missing required fields
        data: { userId: 'user-123' }
      };

      const result = await processor.processMessage(malformedMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });

    it('should handle processing errors gracefully', async () => {
      const message = MessageFactory.createVideoMessage('VideoView', {
        videoId: 'video-that-causes-error',
        userId: 'user-123'
      });

      // Mock a processing error
      jest.spyOn(processor, 'processVideoView').mockRejectedValue(new Error('Processing error'));

      const result = await processor.processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Processing error');
      expect(result.retryAttempted).toBe(true);
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple messages in batch', async () => {
      const messages = [
        MessageFactory.createVideoMessage('VideoView'),
        MessageFactory.createVideoMessage('VideoLike'),
        MessageFactory.createProfileMessage('ProfileView'),
        MessageFactory.createSubscriptionMessage('Subscribe')
      ];

      const results = await processor.processBatch(messages);

      expect(results).toHaveLength(4);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle mixed success/failure in batch', async () => {
      const messages = [
        MessageFactory.createVideoMessage('VideoView'),
        { id: 'invalid', type: 'InvalidType' }, // Invalid message
        MessageFactory.createVideoMessage('VideoLike')
      ];

      const results = await processor.processBatch(messages);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('should respect batch size limits', async () => {
      const messages = Array.from({ length: 15 }, () => 
        MessageFactory.createVideoMessage('VideoView')
      );

      const results = await processor.processBatch(messages);

      expect(results.length).toBeLessThanOrEqual(10); // Max batch size
    });
  });

  describe('Message Persistence', () => {
    it('should save all processed messages to R2', async () => {
      const message = MessageFactory.createVideoMessage('VideoView');

      await processor.processMessage(message);

      const stored = await r2Mock.get(`messages/${message.id}`);
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored).id).toBe(message.id);
    });

    it('should save failed messages to DLQ after retries', async () => {
      const message = MessageFactory.createVideoMessage('VideoView');
      
      // Mock persistent failure
      jest.spyOn(processor, 'processVideoView').mockRejectedValue(new Error('Persistent error'));

      await processor.processMessage(message);

      const dlqMessages = queueMock.getDLQMessages();
      expect(dlqMessages.length).toBeGreaterThan(0);
      expect(dlqMessages[0].id).toBe(message.id);
    });
  });
});