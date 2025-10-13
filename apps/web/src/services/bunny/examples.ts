/**
 * Example usage of BunnyStreamService
 * 
 * This file demonstrates various ways to use the BunnyStreamService
 * for generating Bunny.net Stream URLs.
 */

import { BunnyStreamService, createBunnyStreamService } from './index';
import type { BunnyConfig } from './types';

// ============================================================================
// Example 1: Create service with manual configuration
// ============================================================================
export function example1_ManualConfig() {
  const config: BunnyConfig = {
    pullZoneUrl: 'vz-example.b-cdn.net',
    libraryId: '12345',
  };

  const service = new BunnyStreamService(config);
  const videoId = 'abc123-def456-ghi789';

  // Generate HLS URL
  const hlsUrl = service.getHlsUrl(videoId);
  console.log('HLS URL:', hlsUrl);
  // Output: https://vz-example.b-cdn.net/abc123-def456-ghi789/playlist.m3u8
}

// ============================================================================
// Example 2: Create service from environment variables
// ============================================================================
export function example2_EnvironmentConfig() {
  // Requires environment variables:
  // NEXT_PUBLIC_BUNNY_PULL_ZONE_URL=vz-example.b-cdn.net
  // NEXT_PUBLIC_BUNNY_LIBRARY_ID=12345

  const service = createBunnyStreamService();
  const videoId = 'abc123-def456-ghi789';

  const hlsUrl = service.getHlsUrl(videoId);
  console.log('HLS URL:', hlsUrl);
}

// ============================================================================
// Example 3: Generate all video URLs
// ============================================================================
export function example3_AllUrls() {
  const service = createBunnyStreamService();
  const videoId = 'abc123-def456-ghi789';

  // Get all URLs with captions
  const urls = service.getAllUrls(videoId, [
    { srclang: 'en', label: 'English' },
    { srclang: 'ar', label: 'Arabic' },
  ]);

  console.log('All URLs:', {
    hls: urls.hls,
    mp4_720p: urls.mp4['720p'],
    thumbnail: urls.thumbnail,
    preview: urls.preview,
    captions: urls.captions,
  });
}

// ============================================================================
// Example 4: Video.js integration
// ============================================================================
export function example4_VideoJsIntegration(videoId: string) {
  const service = createBunnyStreamService();

  // Get all URLs for the video
  const urls = service.getAllUrls(videoId, [
    { srclang: 'en', label: 'English' },
    { srclang: 'ar', label: 'العربية' },
  ]);

  // Return Video.js configuration object
  return {
    sources: [
      {
        src: urls.hls,
        type: 'application/x-mpegURL', // HLS
      },
      // Fallback to MP4 if HLS not supported
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
      default: caption.srclang === 'en', // Default to English
    })),
  };
}

// ============================================================================
// Example 5: Generate quality selector for player
// ============================================================================
export function example5_QualitySelector(videoId: string) {
  const service = createBunnyStreamService();

  // Get all MP4 URLs
  const mp4Urls = service.getAllMp4Urls(videoId);

  // Create quality selector options
  const qualityOptions = Object.entries(mp4Urls).map(([quality, url]) => ({
    label: quality,
    value: url,
    resolution: parseInt(quality), // 240, 360, 480, 720, 1080
  }));

  console.log('Quality options:', qualityOptions);
  return qualityOptions;
}

// ============================================================================
// Example 6: Generate thumbnails at different timestamps
// ============================================================================
export function example6_ThumbnailGallery(videoId: string) {
  const service = createBunnyStreamService();

  // Generate thumbnails at 10-second intervals for a 60-second preview
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

  console.log('Thumbnail gallery:', thumbnails);
  return thumbnails;
}

// ============================================================================
// Example 7: React component integration
// ============================================================================
export function example7_ReactComponent() {
  return `
import { createBunnyStreamService } from '@/services/bunny';
import { useEffect, useRef } from 'react';
import videojs from 'video.js';

export function VideoPlayer({ videoId }: { videoId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const service = createBunnyStreamService();
    const urls = service.getAllUrls(videoId, [
      { srclang: 'en', label: 'English' },
      { srclang: 'ar', label: 'العربية' },
    ]);

    // Initialize Video.js
    playerRef.current = videojs(videoRef.current, {
      controls: true,
      responsive: true,
      fluid: true,
      sources: [{ src: urls.hls, type: 'application/x-mpegURL' }],
      poster: urls.thumbnail,
      tracks: urls.captions?.map(caption => ({
        kind: 'captions',
        src: caption.url,
        srclang: caption.srclang,
        label: caption.label,
      })),
    });

    // Cleanup
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
      }
    };
  }, [videoId]);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" />
    </div>
  );
}
`;
}

// ============================================================================
// Example 8: Generate download links
// ============================================================================
export function example8_DownloadLinks(videoId: string) {
  const service = createBunnyStreamService();

  // Get MP4 URLs for download
  const mp4Urls = service.getAllMp4Urls(videoId);

  const downloadLinks = Object.entries(mp4Urls).map(([quality, url]) => ({
    quality,
    url,
    label: `Download ${quality}`,
  }));

  console.log('Download links:', downloadLinks);
  return downloadLinks;
}

// ============================================================================
// Example 9: Preview hover effect
// ============================================================================
export function example9_PreviewHover(videoId: string) {
  const service = createBunnyStreamService();

  return {
    posterImage: service.getThumbnailUrl(videoId),
    previewAnimation: service.getPreviewUrl(videoId),
    // Use previewAnimation on hover, posterImage by default
  };
}

// ============================================================================
// Example 10: Server-side rendering (SSR)
// ============================================================================
export function example10_SSR() {
  return `
// In a Next.js page or API route
import { createBunnyStreamService } from '@/services/bunny';

export async function getServerSideProps({ params }: any) {
  const service = createBunnyStreamService();
  const videoId = params.videoId;

  const urls = service.getAllUrls(videoId);

  return {
    props: {
      videoUrls: urls,
    },
  };
}

export default function VideoPage({ videoUrls }: any) {
  return (
    <div>
      <video controls poster={videoUrls.thumbnail}>
        <source src={videoUrls.hls} type="application/x-mpegURL" />
        <source src={videoUrls.mp4['720p']} type="video/mp4" />
        {videoUrls.captions?.map((caption: any) => (
          <track
            key={caption.srclang}
            kind="captions"
            src={caption.url}
            srcLang={caption.srclang}
            label={caption.label}
          />
        ))}
      </video>
    </div>
  );
}
`;
}

// ============================================================================
// Example 11: Error handling
// ============================================================================
export function example11_ErrorHandling() {
  try {
    // This will throw an error if environment variables are missing
    const service = createBunnyStreamService();
    const videoId = 'test-video';
    const hlsUrl = service.getHlsUrl(videoId);
    console.log('HLS URL:', hlsUrl);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Configuration error:', error.message);
      // Handle missing configuration
    }
  }
}

// ============================================================================
// Example 12: Custom thumbnail for video card
// ============================================================================
export function example12_VideoCard(videoId: string, title: string) {
  const service = createBunnyStreamService();

  return {
    id: videoId,
    title,
    thumbnail: service.getThumbnailUrl(videoId, {
      width: 320,
      height: 180,
    }),
    preview: service.getPreviewUrl(videoId),
    playUrl: service.getHlsUrl(videoId),
  };
}
