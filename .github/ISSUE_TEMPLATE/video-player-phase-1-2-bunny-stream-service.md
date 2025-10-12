---
name: "[Phase 1.2] BunnyStreamService for URL Generation"
about: Implement service for generating Bunny.net streaming URLs
title: "[Phase 1.2] Implement BunnyStreamService for URL Generation"
labels: phase-1, video-player, enhancement, high-priority, backend
assignees: ''
---

## Overview
Create a TypeScript service class to generate all Bunny.net Stream URLs including HLS manifests, MP4 direct URLs, thumbnails, captions, and authenticated URLs. This service abstracts Bunny.net's URL structure and provides a clean API for the video player.

## Context
- **Why**: Need centralized URL generation logic for Bunny.net streams
- **Goal**: Clean abstraction over Bunny.net URL patterns
- **Dependency**: Requires Phase 1.1 (Video.js infrastructure) to be completed
- **Architecture Reference**: See `/docs/architecture/video-player-implementation-guide.md` lines 68-137

## Acceptance Criteria
- [ ] `BunnyStreamService` class created with all URL generation methods
- [ ] HLS playlist URL generation implemented
- [ ] MP4 direct URL generation for all qualities (240p-1080p)
- [ ] Thumbnail URL generation with optional timestamp
- [ ] Preview animation URL generation
- [ ] Captions/subtitles URL generation
- [ ] Token authentication support (optional, for future)
- [ ] Configuration via environment variables
- [ ] Full TypeScript type safety
- [ ] Unit tests with 100% coverage
- [ ] Documentation with JSDoc comments
- [ ] No hardcoded URLs or credentials

## Technical Details

### Files to Create/Modify
- `apps/web/src/services/bunny/stream.service.ts` - Main service class
- `apps/web/src/services/bunny/types.ts` - TypeScript interfaces
- `apps/web/src/services/bunny/__tests__/stream.service.test.ts` - Unit tests
- `apps/web/.env.local.example` - Add Bunny.net config examples
- `apps/web/.env.local` - Add actual Bunny.net credentials (gitignored)

### Implementation Steps

1. **Create TypeScript Types**
   ```typescript
   // apps/web/src/services/bunny/types.ts
   export interface BunnyConfig {
     pullZoneUrl: string;      // e.g., "vz-xxxxx.b-cdn.net"
     libraryId: string;         // Bunny.net library ID
     apiKey?: string;           // For authenticated requests
     tokenAuthEnabled?: boolean;
   }

   export type VideoQuality = '240p' | '360p' | '480p' | '720p' | '1080p';

   export interface BunnyVideoUrls {
     hls: string;
     mp4: Record<VideoQuality, string>;
     thumbnail: string;
     preview: string;
   }
   ```

2. **Implement Service Class**
   ```typescript
   // apps/web/src/services/bunny/stream.service.ts
   import type { BunnyConfig, VideoQuality, BunnyVideoUrls } from './types';

   export class BunnyStreamService {
     private config: BunnyConfig;

     constructor(config: BunnyConfig) {
       this.validateConfig(config);
       this.config = config;
     }

     /**
      * Generate HLS manifest URL for adaptive bitrate streaming
      * @param videoId - Bunny.net video ID (GUID)
      * @returns Full HLS manifest URL
      */
     getHLSUrl(videoId: string): string {
       this.validateVideoId(videoId);
       return `https://${this.config.pullZoneUrl}/${videoId}/playlist.m3u8`;
     }

     /**
      * Generate direct MP4 URL for specific quality
      * @param videoId - Bunny.net video ID
      * @param quality - Video quality (240p-1080p)
      * @returns Direct MP4 URL
      */
     getMP4Url(videoId: string, quality: VideoQuality): string {
       this.validateVideoId(videoId);
       return `https://${this.config.pullZoneUrl}/${videoId}/play_${quality}.mp4`;
     }

     /**
      * Generate thumbnail URL
      * @param videoId - Bunny.net video ID
      * @param time - Optional timestamp for specific frame (seconds)
      * @returns Thumbnail image URL
      */
     getThumbnailUrl(videoId: string, time?: number): string {
       this.validateVideoId(videoId);
       const baseUrl = `https://${this.config.pullZoneUrl}/${videoId}/thumbnail.jpg`;
       return time !== undefined ? `${baseUrl}?t=${time}` : baseUrl;
     }

     /**
      * Generate preview animation URL (WebP sprite sheet)
      * @param videoId - Bunny.net video ID
      * @returns Preview animation URL
      */
     getPreviewUrl(videoId: string): string {
       this.validateVideoId(videoId);
       return `https://${this.config.pullZoneUrl}/${videoId}/preview.webp`;
     }

     /**
      * Generate captions/subtitles URL
      * @param videoId - Bunny.net video ID
      * @param language - Language code (e.g., 'en', 'ar')
      * @returns Captions VTT file URL
      */
     getCaptionsUrl(videoId: string, language: string): string {
       this.validateVideoId(videoId);
       this.validateLanguage(language);
       return `https://${this.config.pullZoneUrl}/${videoId}/captions/${language}.vtt`;
     }

     /**
      * Generate all video URLs at once
      * @param videoId - Bunny.net video ID
      * @returns Object containing all URL types
      */
     getAllUrls(videoId: string): BunnyVideoUrls {
       return {
         hls: this.getHLSUrl(videoId),
         mp4: {
           '240p': this.getMP4Url(videoId, '240p'),
           '360p': this.getMP4Url(videoId, '360p'),
           '480p': this.getMP4Url(videoId, '480p'),
           '720p': this.getMP4Url(videoId, '720p'),
           '1080p': this.getMP4Url(videoId, '1080p')
         },
         thumbnail: this.getThumbnailUrl(videoId),
         preview: this.getPreviewUrl(videoId)
       };
     }

     /**
      * Generate token-authenticated URL (future implementation)
      * @param videoId - Bunny.net video ID
      * @param expiryTime - Unix timestamp when token expires
      * @returns Authenticated URL with token
      */
     getAuthenticatedUrl(videoId: string, expiryTime: number): string {
       if (!this.config.tokenAuthEnabled) {
         return this.getHLSUrl(videoId);
       }

       const token = this.generateToken(videoId, expiryTime);
       return `${this.getHLSUrl(videoId)}?token=${token}&expires=${expiryTime}`;
     }

     // Private validation methods
     private validateConfig(config: BunnyConfig): void {
       if (!config.pullZoneUrl) {
         throw new Error('BunnyConfig: pullZoneUrl is required');
       }
       if (!config.libraryId) {
         throw new Error('BunnyConfig: libraryId is required');
       }
       if (config.tokenAuthEnabled && !config.apiKey) {
         throw new Error('BunnyConfig: apiKey required when tokenAuthEnabled is true');
       }
     }

     private validateVideoId(videoId: string): void {
       if (!videoId || typeof videoId !== 'string') {
         throw new Error('Invalid video ID');
       }
       // Bunny.net uses GUIDs
       const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
       if (!guidRegex.test(videoId)) {
         throw new Error(`Invalid Bunny.net video ID format: ${videoId}`);
       }
     }

     private validateLanguage(language: string): void {
       if (!language || typeof language !== 'string' || language.length !== 2) {
         throw new Error('Language code must be 2 characters (ISO 639-1)');
       }
     }

     private generateToken(videoId: string, expiryTime: number): string {
       // TODO: Implement SHA256 hash: apiKey + videoId + expiryTime
       // See Bunny.net token authentication docs
       throw new Error('Token authentication not yet implemented');
     }
   }

   // Singleton instance factory
   let instance: BunnyStreamService | null = null;

   export function getBunnyStreamService(): BunnyStreamService {
     if (!instance) {
       const config: BunnyConfig = {
         pullZoneUrl: process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE!,
         libraryId: process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID!,
         apiKey: process.env.BUNNY_API_KEY,
         tokenAuthEnabled: process.env.NEXT_PUBLIC_BUNNY_TOKEN_AUTH === 'true'
       };
       instance = new BunnyStreamService(config);
     }
     return instance;
   }
   ```

3. **Create Unit Tests**
   ```typescript
   // apps/web/src/services/bunny/__tests__/stream.service.test.ts
   import { BunnyStreamService } from '../stream.service';
   import type { BunnyConfig } from '../types';

   describe('BunnyStreamService', () => {
     const mockConfig: BunnyConfig = {
       pullZoneUrl: 'vz-12345.b-cdn.net',
       libraryId: 'lib-123'
     };

     const validVideoId = '00000000-0000-0000-0000-000000000000';

     describe('Constructor', () => {
       it('should create instance with valid config', () => {
         const service = new BunnyStreamService(mockConfig);
         expect(service).toBeInstanceOf(BunnyStreamService);
       });

       it('should throw error if pullZoneUrl missing', () => {
         const invalidConfig = { ...mockConfig, pullZoneUrl: '' };
         expect(() => new BunnyStreamService(invalidConfig)).toThrow();
       });

       it('should throw error if libraryId missing', () => {
         const invalidConfig = { ...mockConfig, libraryId: '' };
         expect(() => new BunnyStreamService(invalidConfig)).toThrow();
       });
     });

     describe('getHLSUrl', () => {
       const service = new BunnyStreamService(mockConfig);

       it('should generate correct HLS URL', () => {
         const url = service.getHLSUrl(validVideoId);
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/playlist.m3u8`);
       });

       it('should throw error for invalid video ID', () => {
         expect(() => service.getHLSUrl('invalid-id')).toThrow();
       });

       it('should throw error for empty video ID', () => {
         expect(() => service.getHLSUrl('')).toThrow();
       });
     });

     describe('getMP4Url', () => {
       const service = new BunnyStreamService(mockConfig);

       it('should generate correct MP4 URL for 720p', () => {
         const url = service.getMP4Url(validVideoId, '720p');
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/play_720p.mp4`);
       });

       it('should generate correct MP4 URL for all qualities', () => {
         const qualities = ['240p', '360p', '480p', '720p', '1080p'] as const;
         qualities.forEach(quality => {
           const url = service.getMP4Url(validVideoId, quality);
           expect(url).toContain(`play_${quality}.mp4`);
         });
       });
     });

     describe('getThumbnailUrl', () => {
       const service = new BunnyStreamService(mockConfig);

       it('should generate thumbnail URL without timestamp', () => {
         const url = service.getThumbnailUrl(validVideoId);
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/thumbnail.jpg`);
       });

       it('should generate thumbnail URL with timestamp', () => {
         const url = service.getThumbnailUrl(validVideoId, 30);
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/thumbnail.jpg?t=30`);
       });
     });

     describe('getCaptionsUrl', () => {
       const service = new BunnyStreamService(mockConfig);

       it('should generate captions URL for English', () => {
         const url = service.getCaptionsUrl(validVideoId, 'en');
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/captions/en.vtt`);
       });

       it('should generate captions URL for Arabic', () => {
         const url = service.getCaptionsUrl(validVideoId, 'ar');
         expect(url).toBe(`https://${mockConfig.pullZoneUrl}/${validVideoId}/captions/ar.vtt`);
       });

       it('should throw error for invalid language code', () => {
         expect(() => service.getCaptionsUrl(validVideoId, 'invalid')).toThrow();
       });
     });

     describe('getAllUrls', () => {
       const service = new BunnyStreamService(mockConfig);

       it('should return all URL types', () => {
         const urls = service.getAllUrls(validVideoId);

         expect(urls.hls).toContain('playlist.m3u8');
         expect(urls.mp4['240p']).toContain('play_240p.mp4');
         expect(urls.mp4['1080p']).toContain('play_1080p.mp4');
         expect(urls.thumbnail).toContain('thumbnail.jpg');
         expect(urls.preview).toContain('preview.webp');
       });
     });
   });
   ```

4. **Add Environment Variables**
   ```bash
   # apps/web/.env.local.example
   # Bunny.net Stream Configuration
   NEXT_PUBLIC_BUNNY_PULL_ZONE=vz-xxxxx.b-cdn.net
   NEXT_PUBLIC_BUNNY_LIBRARY_ID=your-library-id
   NEXT_PUBLIC_BUNNY_TOKEN_AUTH=false
   BUNNY_API_KEY=your-api-key
   ```

### Dependencies
- **Prerequisites**: Phase 1.1 (Video.js infrastructure) must be completed
- **npm packages**: None (uses standard APIs)
- **API endpoints**: None (client-side only)
- **Environment variables**:
  - `NEXT_PUBLIC_BUNNY_PULL_ZONE` (required)
  - `NEXT_PUBLIC_BUNNY_LIBRARY_ID` (required)
  - `BUNNY_API_KEY` (optional, for token auth)

### Testing Requirements
- [ ] Unit test: All URL generation methods
- [ ] Unit test: Input validation (video ID, quality, language)
- [ ] Unit test: Config validation
- [ ] Unit test: Singleton factory pattern
- [ ] Unit test: Error handling for invalid inputs
- [ ] Integration test: URLs work with actual Bunny.net videos
- [ ] Manual test: HLS URLs load in Video.js player
- [ ] Manual test: Thumbnails display correctly

## Design Considerations

### Security
- Never expose `BUNNY_API_KEY` in client-side code
- Validate all inputs to prevent injection
- Token authentication for sensitive content
- CORS properly configured on Bunny.net

### Performance
- Singleton pattern prevents multiple service instances
- No network calls in service (pure URL generation)
- Lightweight class with minimal overhead

### Maintainability
- Clear separation of concerns
- Type-safe with full TypeScript support
- Well-documented with JSDoc
- Easy to extend for new URL types

### Future Considerations
- Token authentication implementation
- Support for signed URLs
- DRM integration for premium content
- Multi-CDN failover support

## Success Metrics
- 100% unit test coverage
- Zero TypeScript errors
- All validation tests pass
- URLs successfully load media in browser
- Service used throughout codebase

## References
- [Bunny.net Stream API Documentation](https://docs.bunny.net/reference/stream-api-overview)
- [Bunny.net Video Delivery](https://docs.bunny.net/docs/stream-video-delivery)
- [Bunny.net Token Authentication](https://docs.bunny.net/docs/stream-security-token-authentication)
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md` (lines 68-137)

## Estimated Effort
**Small** - 3-4 hours

### Breakdown
- Service implementation: 1.5 hours
- TypeScript types and validation: 1 hour
- Unit tests: 1-1.5 hours
- Documentation and examples: 30 minutes
