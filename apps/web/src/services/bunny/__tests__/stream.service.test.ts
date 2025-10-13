/**
 * Unit tests for BunnyStreamService
 */

import { BunnyStreamService, createBunnyStreamService } from '../stream.service';
import type { BunnyConfig, VideoQuality } from '../types';

describe('BunnyStreamService', () => {
  const mockConfig: BunnyConfig = {
    pullZoneUrl: 'vz-test123.b-cdn.net',
    libraryId: '12345',
  };

  const testVideoId = 'abc123-def456-ghi789';

  describe('Constructor', () => {
    it('should create instance with valid config', () => {
      const service = new BunnyStreamService(mockConfig);
      expect(service).toBeInstanceOf(BunnyStreamService);
    });

    it('should throw error if pullZoneUrl is missing', () => {
      const invalidConfig = { ...mockConfig, pullZoneUrl: '' };
      expect(() => new BunnyStreamService(invalidConfig)).toThrow(
        'BunnyStreamService: pullZoneUrl is required'
      );
    });

    it('should throw error if libraryId is missing', () => {
      const invalidConfig = { ...mockConfig, libraryId: '' };
      expect(() => new BunnyStreamService(invalidConfig)).toThrow(
        'BunnyStreamService: libraryId is required'
      );
    });

    it('should accept optional apiKey', () => {
      const configWithKey = { ...mockConfig, apiKey: 'test-api-key' };
      const service = new BunnyStreamService(configWithKey);
      expect(service).toBeInstanceOf(BunnyStreamService);
    });

    it('should accept optional tokenAuthEnabled', () => {
      const configWithToken = { ...mockConfig, tokenAuthEnabled: true };
      const service = new BunnyStreamService(configWithToken);
      expect(service).toBeInstanceOf(BunnyStreamService);
    });
  });

  describe('getHlsUrl', () => {
    it('should generate correct HLS URL', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getHlsUrl(testVideoId);
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/playlist.m3u8`);
    });

    it('should handle token options (placeholder)', () => {
      const service = new BunnyStreamService({ ...mockConfig, tokenAuthEnabled: true });
      const url = service.getHlsUrl(testVideoId, { expiresIn: 3600 });
      // Token auth is placeholder, should return base URL
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/playlist.m3u8`);
    });
  });

  describe('getMp4Url', () => {
    it('should generate correct MP4 URL for 240p', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getMp4Url(testVideoId, '240p');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_240.mp4`);
    });

    it('should generate correct MP4 URL for 360p', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getMp4Url(testVideoId, '360p');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_360.mp4`);
    });

    it('should generate correct MP4 URL for 480p', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getMp4Url(testVideoId, '480p');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_480.mp4`);
    });

    it('should generate correct MP4 URL for 720p', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getMp4Url(testVideoId, '720p');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_720.mp4`);
    });

    it('should generate correct MP4 URL for 1080p', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getMp4Url(testVideoId, '1080p');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_1080.mp4`);
    });

    it('should handle token options (placeholder)', () => {
      const service = new BunnyStreamService({ ...mockConfig, tokenAuthEnabled: true });
      const url = service.getMp4Url(testVideoId, '720p', { expiresIn: 3600 });
      // Token auth is placeholder, should return base URL
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_720.mp4`);
    });
  });

  describe('getAllMp4Urls', () => {
    it('should generate MP4 URLs for all quality levels', () => {
      const service = new BunnyStreamService(mockConfig);
      const urls = service.getAllMp4Urls(testVideoId);

      expect(urls['240p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_240.mp4`);
      expect(urls['360p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_360.mp4`);
      expect(urls['480p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_480.mp4`);
      expect(urls['720p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_720.mp4`);
      expect(urls['1080p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_1080.mp4`);
    });

    it('should have all quality levels', () => {
      const service = new BunnyStreamService(mockConfig);
      const urls = service.getAllMp4Urls(testVideoId);

      const qualities: VideoQuality[] = ['240p', '360p', '480p', '720p', '1080p'];
      qualities.forEach(quality => {
        expect(urls[quality]).toBeDefined();
      });
    });
  });

  describe('getThumbnailUrl', () => {
    it('should generate default thumbnail URL', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId);
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail.jpg`);
    });

    it('should generate thumbnail URL with timestamp', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { timestamp: 30 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail_30s.jpg`);
    });

    it('should generate thumbnail URL with custom width', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { width: 640 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail.jpg?width=640`);
    });

    it('should generate thumbnail URL with custom height', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { height: 360 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail.jpg?height=360`);
    });

    it('should generate thumbnail URL with custom dimensions', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { width: 640, height: 360 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail.jpg?width=640&height=360`);
    });

    it('should generate thumbnail URL with timestamp and dimensions', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { timestamp: 15, width: 320, height: 180 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail_15s.jpg?width=320&height=180`);
    });

    it('should handle timestamp of 0', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getThumbnailUrl(testVideoId, { timestamp: 0 });
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail_0s.jpg`);
    });
  });

  describe('getPreviewUrl', () => {
    it('should generate correct preview URL', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getPreviewUrl(testVideoId);
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/preview.webp`);
    });
  });

  describe('getCaptionUrl', () => {
    it('should generate caption URL for English', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getCaptionUrl(testVideoId, 'en');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/captions/en.vtt`);
    });

    it('should generate caption URL for Arabic', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getCaptionUrl(testVideoId, 'ar');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/captions/ar.vtt`);
    });

    it('should handle any language code', () => {
      const service = new BunnyStreamService(mockConfig);
      const url = service.getCaptionUrl(testVideoId, 'fr-CA');
      expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/captions/fr-CA.vtt`);
    });
  });

  describe('getCaptionUrls', () => {
    it('should generate multiple caption URLs', () => {
      const service = new BunnyStreamService(mockConfig);
      const captions = service.getCaptionUrls(testVideoId, [
        { srclang: 'en', label: 'English' },
        { srclang: 'ar', label: 'Arabic' },
      ]);

      expect(captions).toHaveLength(2);
      expect(captions[0]).toEqual({
        srclang: 'en',
        label: 'English',
        url: `https://${mockConfig.pullZoneUrl}/${testVideoId}/captions/en.vtt`,
      });
      expect(captions[1]).toEqual({
        srclang: 'ar',
        label: 'Arabic',
        url: `https://${mockConfig.pullZoneUrl}/${testVideoId}/captions/ar.vtt`,
      });
    });

    it('should handle empty caption array', () => {
      const service = new BunnyStreamService(mockConfig);
      const captions = service.getCaptionUrls(testVideoId, []);
      expect(captions).toHaveLength(0);
    });

    it('should handle single caption', () => {
      const service = new BunnyStreamService(mockConfig);
      const captions = service.getCaptionUrls(testVideoId, [
        { srclang: 'en', label: 'English' },
      ]);

      expect(captions).toHaveLength(1);
      expect(captions[0].srclang).toBe('en');
      expect(captions[0].label).toBe('English');
    });
  });

  describe('getAllUrls', () => {
    it('should generate all URLs without captions', () => {
      const service = new BunnyStreamService(mockConfig);
      const urls = service.getAllUrls(testVideoId);

      expect(urls.hls).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/playlist.m3u8`);
      expect(urls.mp4['720p']).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/play_720.mp4`);
      expect(urls.thumbnail).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/thumbnail.jpg`);
      expect(urls.preview).toBe(`https://${mockConfig.pullZoneUrl}/${testVideoId}/preview.webp`);
      expect(urls.captions).toBeUndefined();
    });

    it('should generate all URLs with captions', () => {
      const service = new BunnyStreamService(mockConfig);
      const urls = service.getAllUrls(testVideoId, [
        { srclang: 'en', label: 'English' },
        { srclang: 'ar', label: 'Arabic' },
      ]);

      expect(urls.hls).toBeDefined();
      expect(urls.mp4).toBeDefined();
      expect(urls.thumbnail).toBeDefined();
      expect(urls.preview).toBeDefined();
      expect(urls.captions).toHaveLength(2);
      expect(urls.captions![0].srclang).toBe('en');
      expect(urls.captions![1].srclang).toBe('ar');
    });

    it('should include all MP4 quality levels', () => {
      const service = new BunnyStreamService(mockConfig);
      const urls = service.getAllUrls(testVideoId);

      expect(urls.mp4['240p']).toBeDefined();
      expect(urls.mp4['360p']).toBeDefined();
      expect(urls.mp4['480p']).toBeDefined();
      expect(urls.mp4['720p']).toBeDefined();
      expect(urls.mp4['1080p']).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return config without sensitive data', () => {
      const service = new BunnyStreamService(mockConfig);
      const config = service.getConfig();

      expect(config.pullZoneUrl).toBe(mockConfig.pullZoneUrl);
      expect(config.libraryId).toBe(mockConfig.libraryId);
      expect(config.tokenAuthEnabled).toBe(false);
      expect(config).not.toHaveProperty('apiKey');
    });

    it('should return tokenAuthEnabled as true when set', () => {
      const service = new BunnyStreamService({ ...mockConfig, tokenAuthEnabled: true });
      const config = service.getConfig();

      expect(config.tokenAuthEnabled).toBe(true);
    });

    it('should not expose apiKey', () => {
      const service = new BunnyStreamService({ ...mockConfig, apiKey: 'secret-key' });
      const config = service.getConfig();

      expect(config).not.toHaveProperty('apiKey');
    });
  });
});

describe('createBunnyStreamService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create service from environment variables', () => {
    process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL = 'vz-env-test.b-cdn.net';
    process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID = '67890';

    const service = createBunnyStreamService();
    const config = service.getConfig();

    expect(config.pullZoneUrl).toBe('vz-env-test.b-cdn.net');
    expect(config.libraryId).toBe('67890');
  });

  it('should throw error if NEXT_PUBLIC_BUNNY_PULL_ZONE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL;
    process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID = '67890';

    expect(() => createBunnyStreamService()).toThrow(
      'NEXT_PUBLIC_BUNNY_PULL_ZONE_URL environment variable is required'
    );
  });

  it('should throw error if NEXT_PUBLIC_BUNNY_LIBRARY_ID is missing', () => {
    process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL = 'vz-env-test.b-cdn.net';
    delete process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID;

    expect(() => createBunnyStreamService()).toThrow(
      'NEXT_PUBLIC_BUNNY_LIBRARY_ID environment variable is required'
    );
  });

  it('should include optional apiKey from environment', () => {
    process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL = 'vz-env-test.b-cdn.net';
    process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID = '67890';
    process.env.NEXT_PUBLIC_BUNNY_API_KEY = 'env-api-key';

    const service = createBunnyStreamService();
    expect(service).toBeInstanceOf(BunnyStreamService);
    // API key should be set but not exposed in config
    const config = service.getConfig();
    expect(config).not.toHaveProperty('apiKey');
  });

  it('should set tokenAuthEnabled from environment', () => {
    process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL = 'vz-env-test.b-cdn.net';
    process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID = '67890';
    process.env.NEXT_PUBLIC_BUNNY_TOKEN_AUTH = 'true';

    const service = createBunnyStreamService();
    const config = service.getConfig();

    expect(config.tokenAuthEnabled).toBe(true);
  });

  it('should default tokenAuthEnabled to false', () => {
    process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL = 'vz-env-test.b-cdn.net';
    process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID = '67890';

    const service = createBunnyStreamService();
    const config = service.getConfig();

    expect(config.tokenAuthEnabled).toBe(false);
  });
});
