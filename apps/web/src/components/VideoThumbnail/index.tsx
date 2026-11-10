"use client";
import React, { useEffect, useState, type CSSProperties } from "react";
import { resolveUrl } from "@/lib/utility";
import { FitImage } from "./FitImage";

export interface VideoThumbnailProps {
  /** Thumbnail URL; empty/undefined renders the placeholder */
  src?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
  /** Replaces the default play icon when there is no image to show */
  placeholder?: React.ReactNode;
  /** Inline style of the wrapper, e.g. THUMBNAIL_16_9 */
  style?: CSSProperties;
  /** The video's size (Bunny's width/height): vertical and square videos letterbox from the first paint */
  videoWidth?: number | null;
  videoHeight?: number | null;
  children?: React.ReactNode;
}

/** 16:9 thumbnail box. `fill` images need a sized wrapper or it collapses to height 0. */
export const THUMBNAIL_16_9 = { aspectRatio: "16 / 9" } as const;

/**
 * Video/playlist thumbnail with a neutral placeholder.
 *
 * Videos without a thumbnail (still processing, failed uploads, test data)
 * or whose image fails to load show a muted play icon on a light-gray
 * (light theme) / black (dark theme) background instead of a blank box.
 *
 * Never distorts: a vertical, square or 4:3 thumbnail is shown whole over a
 * blurred copy of itself instead of being cropped to a centre strip
 * (FitImage, lib/video/aspect.ts).
 */
const VideoThumbnail: React.FC<VideoThumbnailProps> = ({
  src,
  alt,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  className = "",
  placeholder,
  style,
  videoWidth,
  videoHeight,
  children,
}) => {
  const [failed, setFailed] = useState(false);

  // A new src (e.g. after re-render with fresh data) deserves a fresh attempt
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <div className={`relative w-full overflow-hidden bg-gray-200 dark:bg-black ${className}`} style={style}>
      {showImage ? (
        <FitImage
          src={resolveUrl(src as string)}
          alt={alt}
          sizes={sizes}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          data-testid="video-thumbnail-placeholder"
          role="img"
          aria-label={alt}
        >
          {placeholder ?? (
            <svg
              className="h-12 w-12 text-gray-400 dark:text-gray-700"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
            </svg>
          )}
        </div>
      )}
      {children}
    </div>
  );
};

export default VideoThumbnail;
