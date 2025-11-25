'use client';

/**
 * Example page demonstrating CustomVideoPlayer usage
 * 
 * This is a reference implementation showing how to use the CustomVideoPlayer
 * component with all its features including progress tracking, analytics,
 * and error handling.
 * 
 * To use this example:
 * 1. Replace 'your-bunny-video-guid' with an actual Bunny.net video GUID
 * 2. Optionally add user authentication
 * 3. Integrate with your analytics service
 */

import React, { useState, useEffect } from 'react';
import { CustomVideoPlayer, VideoPlayerSkeleton } from '@/components/VideoPlayer';

export default function VideoPlayerExample() {
  const [isClient, setIsClient] = useState(false);

  // Ensure component renders only on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return <VideoPlayerSkeleton />;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">CustomVideoPlayer Example</h1>
        <p className="text-muted-foreground">
          This page demonstrates the CustomVideoPlayer component with all features enabled.
        </p>
      </div>

      {/* English Version */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">English (LTR)</h2>
        <div className="bg-card rounded-lg p-6 border">
          <CustomVideoPlayer
            videoId="example-video-1"
            sources={[
              { src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' },
              { src: 'https://example.com/video.mp4', type: 'video/mp4' }
            ]}
            poster="https://example.com/poster.jpg"
            autoplay={false}
          />
        </div>
      </div>

      {/* Arabic Version */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Arabic (RTL)</h2>
        <div className="bg-card rounded-lg p-6 border">
          <CustomVideoPlayer
            videoId="example-video-2"
            sources={[
              { src: 'https://example.com/video.m3u8', type: 'application/x-mpegURL' },
              { src: 'https://example.com/video.mp4', type: 'video/mp4' }
            ]}
            poster="https://example.com/poster.jpg"
            autoplay={false}
          />
        </div>
      </div>

      {/* Loading State Example */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Loading State</h2>
        <div className="bg-card rounded-lg p-6 border">
          <VideoPlayerSkeleton />
        </div>
      </div>

      {/* Code Example */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Code Example</h2>
        <div className="bg-muted rounded-lg p-6 overflow-x-auto">
          <pre className="text-sm">
            <code>{`import { CustomVideoPlayer } from '@/components/VideoPlayer';

function MyVideoPage() {
  return (
    <CustomVideoPlayer
      videoId="my-video-123"
      bunnyVideoId="bunny-guid-abc-def"
      title="My Video Title"
      autoplay={false}
      startTime={0}
      onPlay={() => logger.debug('Playing')}
      onPause={() => logger.debug('Paused')}
      onEnded={() => logger.debug('Ended')}
      onTimeUpdate={(current, duration) => {
        logger.debug(\`\${current}/\${duration}\`);
      }}
      rtl={false}
    />
  );
}`}</code>
          </pre>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <h3 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">
          ℹ️ To use this example with real videos:
        </h3>
        <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>Replace &apos;your-bunny-video-guid&apos; with an actual Bunny.net video GUID</li>
          <li>Ensure environment variables are set (see .env.example)</li>
          <li>Open browser console to see event logs</li>
          <li>Test resume functionality by refreshing the page while playing</li>
        </ol>
      </div>
    </div>
  );
}
