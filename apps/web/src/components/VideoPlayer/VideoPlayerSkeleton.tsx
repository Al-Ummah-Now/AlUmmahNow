'use client';

import React from 'react';

export interface VideoPlayerSkeletonProps {
  className?: string;
  rtl?: boolean;
}

export function VideoPlayerSkeleton({ className = '', rtl = false }: VideoPlayerSkeletonProps) {
  return (
    <div 
      className={`relative aspect-video bg-muted rounded-lg overflow-hidden ${className}`}
      role="status"
      aria-label={rtl ? 'جاري تحميل الفيديو...' : 'Loading video...'}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {/* Animated shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-muted-foreground/10 to-transparent animate-shimmer" />
      
      {/* Play button placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-muted-foreground/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-muted-foreground/40"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      {/* Control bar placeholder */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background/80 to-transparent">
        <div className="flex items-center justify-between h-full px-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-muted-foreground/20" />
            <div className="w-8 h-8 rounded bg-muted-foreground/20" />
            <div className="w-12 h-4 rounded bg-muted-foreground/20" />
          </div>
          <div className="flex-1 mx-4 h-1 rounded bg-muted-foreground/20" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-muted-foreground/20" />
            <div className="w-8 h-8 rounded bg-muted-foreground/20" />
            <div className="w-8 h-8 rounded bg-muted-foreground/20" />
          </div>
        </div>
      </div>

      {/* Screen reader text */}
      <span className="sr-only">
        {rtl ? 'جاري تحميل مشغل الفيديو...' : 'Loading video player...'}
      </span>
    </div>
  );
}
