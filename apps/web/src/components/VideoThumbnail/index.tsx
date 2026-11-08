"use client";
import React, { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import { resolveUrl } from "@/lib/utility";

export interface VideoThumbnailProps {
  /** Thumbnail URL; empty/undefined renders the placeholder */
  src?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
  /** Inline style of the wrapper, e.g. THUMBNAIL_16_9 */
  style?: CSSProperties;
  children?: React.ReactNode;
}

/**
 * 16:9 thumbnail box. Inline because the @tailwindcss/aspect-ratio plugin
 * replaces the theme's aspect scale: `aspect-video` produces no CSS at all, and
 * with `fill` images the wrapper then collapses to height 0.
 */
export const THUMBNAIL_16_9 = { aspectRatio: "16 / 9" } as const;

/**
 * Video/playlist thumbnail with a neutral placeholder.
 *
 * Videos without a thumbnail (still processing, failed uploads, test data)
 * or whose image fails to load show a muted play icon on a light-gray
 * (light theme) / black (dark theme) background instead of a blank box.
 */
const VideoThumbnail: React.FC<VideoThumbnailProps> = ({
  src,
  alt,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  className = "",
  style,
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
        <Image
          src={resolveUrl(src as string)}
          alt={alt}
          sizes={sizes}
          fill
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          data-testid="video-thumbnail-placeholder"
          role="img"
          aria-label={alt}
        >
          <svg
            className="h-12 w-12 text-gray-400 dark:text-gray-700"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
          </svg>
        </div>
      )}
      {children}
    </div>
  );
};

export default VideoThumbnail;
