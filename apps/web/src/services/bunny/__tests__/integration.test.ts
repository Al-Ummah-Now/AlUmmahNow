/**
 * Integration test for BunnyStreamService
 * 
 * This test verifies the complete workflow of using the service
 * in a real-world scenario.
 */

import { BunnyStreamService } from '../stream.service';
import type { BunnyConfig } from '../types';

describe('BunnyStreamService Integration', () => {
  const config: BunnyConfig = {
    pullZoneUrl: 'vz-integration-test.b-cdn.net',
    libraryId: '99999',
  };

  const videoId = 'integration-test-video-123';

  it('should generate all URLs for a complete video player setup', () => {
    const service = new BunnyStreamService(config);

    // Generate all URLs as you would for a real video player
    const videoUrls = service.getAllUrls(videoId, [
      { srclang: 'en', label: 'English' },
      { srclang: 'ar', label: 'العربية' },
    ]);

    // Verify HLS URL is correct
    expect(videoUrls.hls).toMatch(/^https:\/\//);
    expect(videoUrls.hls).toContain(videoId);
    expect(videoUrls.hls).toContain('playlist.m3u8');

    // Verify all MP4 qualities are present
    expect(videoUrls.mp4['240p']).toBeDefined();
    expect(videoUrls.mp4['360p']).toBeDefined();
    expect(videoUrls.mp4['480p']).toBeDefined();
    expect(videoUrls.mp4['720p']).toBeDefined();
    expect(videoUrls.mp4['1080p']).toBeDefined();

    // Verify thumbnail URL
    expect(videoUrls.thumbnail).toContain('thumbnail.jpg');

    // Verify preview URL
    expect(videoUrls.preview).toContain('preview.webp');

    // Verify captions
    expect(videoUrls.captions).toHaveLength(2);
    expect(videoUrls.captions![0].srclang).toBe('en');
    expect(videoUrls.captions![1].srclang).toBe('ar');
    expect(videoUrls.captions![0].url).toContain('/captions/en.vtt');
    expect(videoUrls.captions![1].url).toContain('/captions/ar.vtt');
  });

  it('should work with Video.js configuration object', () => {
    const service = new BunnyStreamService(config);
    const urls = service.getAllUrls(videoId, [
      { srclang: 'en', label: 'English' },
    ]);

    // Simulate Video.js configuration
    const videoJsConfig = {
      sources: [
        {
          src: urls.hls,
          type: 'application/x-mpegURL',
        },
        {
          src: urls.mp4['720p'],
          type: 'video/mp4',
        },
      ],
      poster: urls.thumbnail,
      tracks: urls.captions?.map(caption => ({
        kind: 'captions',
        src: caption.url,
        srclang: caption.srclang,
        label: caption.label,
      })),
    };

    // Verify the configuration is valid
    expect(videoJsConfig.sources).toHaveLength(2);
    expect(videoJsConfig.sources[0].type).toBe('application/x-mpegURL');
    expect(videoJsConfig.poster).toContain('thumbnail.jpg');
    expect(videoJsConfig.tracks).toHaveLength(1);
    expect(videoJsConfig.tracks![0].kind).toBe('captions');
  });

  it('should generate quality selector options', () => {
    const service = new BunnyStreamService(config);
    const mp4Urls = service.getAllMp4Urls(videoId);

    // Simulate quality selector
    const qualityOptions = Object.entries(mp4Urls).map(([quality, url]) => ({
      label: quality,
      value: url,
      resolution: parseInt(quality),
    }));

    expect(qualityOptions).toHaveLength(5);
    expect(qualityOptions[0].label).toBe('240p');
    expect(qualityOptions[4].label).toBe('1080p');
    expect(qualityOptions[0].resolution).toBe(240);
    expect(qualityOptions[4].resolution).toBe(1080);
  });

  it('should generate thumbnail gallery for preview', () => {
    const service = new BunnyStreamService(config);

    // Generate thumbnails at 10-second intervals
    const thumbnails = [];
    for (let i = 0; i <= 60; i += 10) {
      thumbnails.push({
        timestamp: i,
        url: service.getThumbnailUrl(videoId, {
          timestamp: i,
          width: 160,
          height: 90,
        }),
      });
    }

    expect(thumbnails).toHaveLength(7); // 0, 10, 20, 30, 40, 50, 60
    expect(thumbnails[0].timestamp).toBe(0);
    expect(thumbnails[6].timestamp).toBe(60);
    expect(thumbnails[0].url).toContain('thumbnail_0s.jpg');
    expect(thumbnails[3].url).toContain('thumbnail_30s.jpg');
    expect(thumbnails[0].url).toContain('width=160');
    expect(thumbnails[0].url).toContain('height=90');
  });

  it('should work with different video IDs', () => {
    const service = new BunnyStreamService(config);
    const videoIds = ['video-1', 'video-2', 'video-3'];

    videoIds.forEach(id => {
      const hls = service.getHlsUrl(id);
      expect(hls).toContain(id);
      expect(hls).toContain('playlist.m3u8');
    });
  });

  it('should maintain consistent URL structure across all methods', () => {
    const service = new BunnyStreamService(config);
    const baseUrl = `https://${config.pullZoneUrl}/${videoId}`;

    expect(service.getHlsUrl(videoId)).toBe(`${baseUrl}/playlist.m3u8`);
    expect(service.getMp4Url(videoId, '720p')).toBe(`${baseUrl}/play_720.mp4`);
    expect(service.getThumbnailUrl(videoId)).toBe(`${baseUrl}/thumbnail.jpg`);
    expect(service.getPreviewUrl(videoId)).toBe(`${baseUrl}/preview.webp`);
    expect(service.getCaptionUrl(videoId, 'en')).toBe(`${baseUrl}/captions/en.vtt`);
  });

  it('should handle configuration retrieval without exposing secrets', () => {
    const service = new BunnyStreamService({
      ...config,
      apiKey: 'super-secret-key',
      tokenAuthEnabled: true,
    });

    const retrievedConfig = service.getConfig();

    expect(retrievedConfig.pullZoneUrl).toBe(config.pullZoneUrl);
    expect(retrievedConfig.libraryId).toBe(config.libraryId);
    expect(retrievedConfig.tokenAuthEnabled).toBe(true);
    expect(retrievedConfig).not.toHaveProperty('apiKey');
  });
});
