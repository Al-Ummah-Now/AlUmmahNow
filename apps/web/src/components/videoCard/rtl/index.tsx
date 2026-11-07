"use client";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { VideoObject, getLocalizedValue } from "@al-ummah/shared-types";
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";

const VideoCardRTL: React.FC<VideoObject> = (video) => {
  const { t, lang: locale } = useLanguage();

  const title = getLocalizedValue(video.titleLocalized, video.title, locale);

  // A real link (not an onClick redirect) so cards are keyboard focusable,
  // can be opened in a new tab and are announced as links
  return (
    <Link
      href={`/ar/video?vid=${video.id}`}
      data-testid="video-card"
      data-video-id={video.id}
      className="video-card cursor-pointer bg-white dark:bg-gray-900 text-black dark:text-white flex flex-col rounded-lg shadow-md overflow-hidden"
      dir="rtl"
    >
      {/* Thumbnail */}
      <div className="relative w-full h-48 bg-gray-200">
        {video.thumbnailUrl && (
          <Image
            src={resolveUrl(video.thumbnailUrl)}
            alt={title.replace(/⧸/g, ".")}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            fill
          />
        )}
      </div>

      {/* Video Details */}
      <div className="p-4">
        <h3 className="text-lg truncate font-[Tahoma]">
          {removeUnwantedChars(title)}
        </h3>
        <p className="text-sm truncate">{video.channel}</p>
        <p className="text-sm">
          {video.views} {t.video.videoViews.toLowerCase()} • {new Date(video.dateCreated).toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
};

export default VideoCardRTL;
