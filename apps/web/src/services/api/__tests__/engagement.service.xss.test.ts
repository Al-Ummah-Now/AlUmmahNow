/**
 * XSS Security Tests for Video Engagement Service
 *
 * Tests the XSS protection mechanisms implemented in the engagement service
 * to ensure all user input is properly validated and sanitized.
 */

import { VideoEngagementService } from '../engagement.service';

describe('VideoEngagementService - XSS Protection', () => {
  let service: VideoEngagementService;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new VideoEngagementService();

    // Mock window.location.origin for testing
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://example.com' },
      writable: true
    });

    // Mock console methods to suppress error logs during tests
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('XSS Attack Vectors', () => {
    const xssAttackVectors = [
      '<script>alert("XSS")</script>',
      'javascript:alert("XSS")',
      '<img src=x onerror=alert("XSS")>',
      '"><script>alert("XSS")</script>',
      '\';alert(String.fromCharCode(88,83,83))//\';alert(String.fromCharCode(88,83,83))//";',
      '<svg/onload=alert("XSS")>',
      '<iframe src=javascript:alert("XSS")>',
      '../../etc/passwd',
      '../../../windows/system32/config/sam',
      'video?id=<script>alert(1)</script>',
      'video&id=<img src=x onerror=alert(1)>',
      '%3Cscript%3Ealert(%22XSS%22)%3C/script%3E',
      '&#60;script&#62;alert("XSS")&#60;/script&#62;',
      '<body onload=alert("XSS")>',
      '<div style="background:url(javascript:alert(1))">',
      'onclick=alert(1)//',
      '<input onfocus=alert(1) autofocus>',
      '<select onfocus=alert(1) autofocus>',
      '<textarea onfocus=alert(1) autofocus>',
      '<keygen onfocus=alert(1) autofocus>',
      '<video><source onerror="alert(1)">',
      '<audio src=x onerror=alert(1)>',
      '<details open ontoggle=alert(1)>',
      '<marquee onstart=alert(1)>',
      '${alert(1)}', // Template injection
      '{{alert(1)}}', // Angular-style template injection
      '#{alert(1)}', // Ruby template injection
      '%{alert(1)}', // Other template syntaxes
    ];

    describe('getShareUrl method', () => {
      it('should reject all XSS attack vectors', () => {
        xssAttackVectors.forEach(attack => {
          const result = service.getShareUrl(attack, 'copy');
          expect(result).toBeNull();
          expect(console.error).toHaveBeenCalledWith(
            '[VideoEngagementService] Invalid video ID format - potential XSS attempt'
          );
        });
      });

      it('should accept valid video IDs', () => {
        const validIds = [
          'abc123',
          'video-123',
          'video_123',
          'a1b2c3d4e5f6',
          'VIDEO-ID-123',
          'test_video_id',
          '123456789',
          'a-b-c-d-e-f'
        ];

        validIds.forEach(id => {
          const result = service.getShareUrl(id, 'copy');
          expect(result).toBe(`https://example.com/watch/${encodeURIComponent(id)}`);
        });
      });

      it('should properly encode URLs for social platforms', () => {
        const videoId = 'test-video-123';

        // Twitter
        const twitterUrl = service.getShareUrl(videoId, 'twitter');
        expect(twitterUrl).toContain('https://twitter.com/intent/tweet?url=');
        expect(twitterUrl).toContain(encodeURIComponent(`https://example.com/watch/${encodeURIComponent(videoId)}`));

        // Facebook
        const facebookUrl = service.getShareUrl(videoId, 'facebook');
        expect(facebookUrl).toContain('https://www.facebook.com/sharer/sharer.php?u=');
        expect(facebookUrl).toContain(encodeURIComponent(`https://example.com/watch/${encodeURIComponent(videoId)}`));

        // Email
        const emailUrl = service.getShareUrl(videoId, 'email');
        expect(emailUrl).toContain('mailto:?subject=Check out this video&body=');
        expect(emailUrl).toContain(encodeURIComponent(`https://example.com/watch/${encodeURIComponent(videoId)}`));
      });
    });

    describe('copyShareUrl method', () => {
      it('should reject all XSS attack vectors', async () => {
        for (const attack of xssAttackVectors) {
          const result = await service.copyShareUrl(attack);
          expect(result.success).toBe(false);
          expect(result.error).toBe('Invalid video ID format');
        }
      });

      it('should accept valid video IDs', async () => {
        // Mock clipboard API
        const mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
          clipboard: {
            writeText: mockWriteText
          }
        });

        const validId = 'test-video-123';
        const result = await service.copyShareUrl(validId);

        expect(result.success).toBe(true);
        expect(mockWriteText).toHaveBeenCalledWith(
          `https://example.com/watch/${encodeURIComponent(validId)}`
        );
      });
    });

    describe('trackShare method', () => {
      it('should reject invalid video IDs', async () => {
        for (const attack of xssAttackVectors.slice(0, 5)) {
          const result = await service.trackShare(attack, 'twitter');
          expect(result.success).toBe(false);
          expect(result.error).toBe('Invalid video ID format');
        }
      });

      it('should accept valid video IDs', async () => {
        const result = await service.trackShare('valid-video-123', 'twitter');
        expect(result.success).toBe(true);
      });
    });

    describe('trackView method', () => {
      it('should reject invalid video IDs', async () => {
        for (const attack of xssAttackVectors.slice(0, 5)) {
          const result = await service.trackView(attack);
          expect(result.success).toBe(false);
          expect(result.error).toBe('Invalid video ID format');
        }
      });

      it('should accept valid inputs', async () => {
        const result = await service.trackView('valid-video-123');
        expect(result.success).toBe(true);
      });
    });

    describe('likeVideo method', () => {
      // Mock VideosAPI
      beforeEach(() => {
        jest.mock('@/lib/api/videos', () => ({
          VideosAPI: {
            like: jest.fn().mockResolvedValue({ success: true }),
            unlike: jest.fn().mockResolvedValue({ success: true })
          }
        }));
      });

      it('should reject invalid video IDs', async () => {
        const result = await service.likeVideo(
          '<script>alert(1)</script>',
          'valid-channel'
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid video ID format');
      });
    });
  });

  describe('Input Validation', () => {
    describe('Video ID validation', () => {
      it('should reject empty strings', () => {
        expect(service.getShareUrl('', 'copy')).toBeNull();
      });

      it('should reject strings longer than 100 characters', () => {
        const longId = 'a'.repeat(101);
        expect(service.getShareUrl(longId, 'copy')).toBeNull();
      });

      it('should reject special characters', () => {
        const invalidIds = [
          'video!@#',
          'video$%^',
          'video&*()',
          'video<>',
          'video[]{}',
          'video|\\',
          'video;:',
          'video\'\"',
          'video,.',
          'video/',
          'video?',
          'video=+',
          'video\n\r',
          'video\t',
          'video ',
          ' video',
        ];

        invalidIds.forEach(id => {
          expect(service.getShareUrl(id, 'copy')).toBeNull();
        });
      });

      it('should accept alphanumeric with hyphens and underscores', () => {
        const validIds = [
          'abc',
          '123',
          'ABC',
          'abc123',
          'ABC-123',
          'abc_123',
          'a-b-c_1-2-3',
          'VIDEO_ID_123',
          'test-video-id',
        ];

        validIds.forEach(id => {
          expect(service.getShareUrl(id, 'copy')).not.toBeNull();
        });
      });
    });

  });

  describe('URL Encoding', () => {
    it('should properly encode video IDs in URLs', () => {
      // Even valid IDs should be encoded for URL safety
      const videoId = 'test_video-123';
      const url = service.getShareUrl(videoId, 'copy');

      // The video ID should be encoded in the URL
      expect(url).toBe(`https://example.com/watch/${encodeURIComponent(videoId)}`);
    });

    it('should double-encode for social media platforms', () => {
      const videoId = 'test_video-123';
      const twitterUrl = service.getShareUrl(videoId, 'twitter');

      // The entire video URL should be encoded as a parameter
      const expectedVideoUrl = `https://example.com/watch/${encodeURIComponent(videoId)}`;
      const expectedTwitterUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(expectedVideoUrl)}`;

      expect(twitterUrl).toBe(expectedTwitterUrl);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined window gracefully', () => {
      // Temporarily remove window
      const originalWindow = global.window;
      // @ts-expect-error - Testing edge case with window removed
      delete global.window;

      const result = service.getShareUrl('valid-video', 'copy');
      expect(result).toBeNull();

      // Restore window
      global.window = originalWindow;
    });

    it('should handle null/undefined inputs', async () => {
      // @ts-expect-error - Testing runtime behavior
      expect(service.getShareUrl(null, 'copy')).toBeNull();
      // @ts-expect-error - Testing runtime behavior
      expect(service.getShareUrl(undefined, 'copy')).toBeNull();

      // @ts-expect-error - Testing runtime behavior
      const result1 = await service.copyShareUrl(null);
      expect(result1.success).toBe(false);

      // @ts-expect-error - Testing runtime behavior
      const result2 = await service.trackShare(undefined, 'twitter');
      expect(result2.success).toBe(false);
    });

    it('should handle non-string inputs', () => {
      const nonStringInputs = [
        123,
        { id: 'video' },
        ['video'],
        true,
        false,
        Symbol('video'),
        () => 'video'
      ];

      nonStringInputs.forEach(input => {
        // @ts-expect-error - Testing runtime behavior
        expect(service.getShareUrl(input, 'copy')).toBeNull();
      });
    });
  });

  describe('Security Boundaries', () => {
    it('should limit video ID length to 100 characters', () => {
      const maxLength = 'a'.repeat(100);
      const tooLong = 'a'.repeat(101);

      expect(service.getShareUrl(maxLength, 'copy')).not.toBeNull();
      expect(service.getShareUrl(tooLong, 'copy')).toBeNull();
    });

    it('should not allow path traversal attempts', () => {
      const pathTraversalAttempts = [
        '../video',
        '..\\video',
        'video/../other',
        'video/../../admin',
        './../video',
        'video/..',
        '....//video',
        'video%2F..%2F',
        'video%5C..%5C',
      ];

      pathTraversalAttempts.forEach(attempt => {
        expect(service.getShareUrl(attempt, 'copy')).toBeNull();
      });
    });

    it('should not allow URL manipulation attempts', () => {
      const urlManipulationAttempts = [
        'video#fragment',
        'video?query=param',
        'video&param=value',
        'http://evil.com/video',
        '//evil.com/video',
        'video@evil.com',
        'video:password@evil.com',
      ];

      urlManipulationAttempts.forEach(attempt => {
        expect(service.getShareUrl(attempt, 'copy')).toBeNull();
      });
    });
  });
});