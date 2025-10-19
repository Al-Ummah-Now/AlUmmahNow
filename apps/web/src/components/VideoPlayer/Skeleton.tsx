import React from 'react';
import { cn } from '@/lib/utils';

export interface VideoPlayerSkeletonProps {
  className?: string;
  aspectRatio?: '16/9' | '4/3' | '1/1';
  showControls?: boolean;
}

export const VideoPlayerSkeleton: React.FC<VideoPlayerSkeletonProps> = ({
  className,
  aspectRatio = '16/9',
  showControls = true
}) => {
  const aspectRatioClasses = {
    '16/9': 'aspect-video',
    '4/3': 'aspect-[4/3]',
    '1/1': 'aspect-square'
  };

  return (
    <div
      className={cn(
        'relative bg-gray-900 rounded-lg overflow-hidden',
        aspectRatioClasses[aspectRatio],
        className
      )}
      role="status"
      aria-label="Loading video player"
    >
      {/* Main video area skeleton */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_2px,rgba(255,255,255,0.03)_2px,rgba(255,255,255,0.03)_4px)] animate-pulse" />
      </div>

      {/* Center loading indicator */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-gray-700 border-t-[#ffa037] rounded-full animate-spin" />
          <span className="text-gray-400 text-sm animate-pulse">Loading video...</span>
        </div>
      </div>

      {/* Control bar skeleton */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/80 to-transparent">
          <div className="absolute bottom-2 left-2 right-2 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-[#ffa037] rounded-full animate-pulse" />
          </div>
          <div className="absolute bottom-4 left-2 right-2 flex justify-between items-center">
            <div className="flex space-x-3">
              <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
              <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
              <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
            </div>
            <div className="flex space-x-3">
              <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
              <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
              <div className="w-12 h-8 bg-gray-700 rounded animate-pulse" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
