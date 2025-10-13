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
  const [startTime, setStartTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure component renders only on client
  useEffect(() => {
    setIsClient(true);
    
    // Load saved progress from localStorage
    const savedProgress = localStorage.getItem('video-progress-example');
    if (savedProgress) {
      setStartTime(parseInt(savedProgress));
    }
  }, []);

  const handlePlay = () => {
    console.log('▶️ Video started playing');
    setIsPlaying(true);
  };

  const handlePause = () => {
    console.log('⏸️ Video paused');
    setIsPlaying(false);
  };

  const handleTimeUpdate = (current: number, total: number) => {
    setCurrentTime(current);
    setDuration(total);
    
    // Save progress every 10 seconds
    if (Math.floor(current) % 10 === 0) {
      localStorage.setItem('video-progress-example', current.toString());
      console.log(`💾 Progress saved: ${Math.floor(current)}s / ${Math.floor(total)}s`);
    }

    // Log milestone events
    const progress = (current / total) * 100;
    if (Math.floor(progress) === 25 && Math.floor(currentTime / total * 100) < 25) {
      console.log('📊 25% milestone reached');
    } else if (Math.floor(progress) === 50 && Math.floor(currentTime / total * 100) < 50) {
      console.log('📊 50% milestone reached');
    } else if (Math.floor(progress) === 75 && Math.floor(currentTime / total * 100) < 75) {
      console.log('📊 75% milestone reached');
    }
  };

  const handleEnded = () => {
    console.log('✅ Video ended');
    setIsPlaying(false);
    localStorage.removeItem('video-progress-example');
  };

  const handleError = (err: any) => {
    console.error('❌ Video error:', err);
    setError(err?.message || 'An error occurred');
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
            bunnyVideoId="your-bunny-video-guid"
            title="Example Video - Introduction"
            autoplay={false}
            startTime={startTime}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onTimeUpdate={handleTimeUpdate}
            onError={handleError}
            rtl={false}
          />

          {/* Player Info */}
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <h3 className="font-semibold mb-2">Player Status</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>{' '}
                <span className={isPlaying ? 'text-green-600' : 'text-gray-600'}>
                  {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Time:</span>{' '}
                <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              {startTime > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Resumed from:</span>{' '}
                  <span>{formatTime(startTime)}</span>
                </div>
              )}
              {error && (
                <div className="col-span-2 text-destructive">
                  <span className="text-muted-foreground">Error:</span> {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Arabic Version */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Arabic (RTL)</h2>
        <div className="bg-card rounded-lg p-6 border">
          <CustomVideoPlayer
            videoId="example-video-2"
            bunnyVideoId="your-bunny-video-guid"
            title="مثال على الفيديو - مقدمة"
            autoplay={false}
            rtl={true}
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
      onPlay={() => console.log('Playing')}
      onPause={() => console.log('Paused')}
      onEnded={() => console.log('Ended')}
      onTimeUpdate={(current, duration) => {
        console.log(\`\${current}/\${duration}\`);
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
