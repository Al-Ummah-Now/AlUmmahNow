"use client";
import React, { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";

const VideoPlayerRTL: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const { user } = useAuth();
  const { t } = useLanguage();

  const title = getLocalizedValue((options as PlayerOptions & { titleLocalized?: Record<string, string> }).titleLocalized, options.title, 'ar');

  // Convert PlayerOptions to CustomVideoPlayer props. Same source resolution as
  // the LTR variant (API playUrl first) and memoized so re-renders don't hand
  // the player a new sources array, which would reload the video.
  const videoSources = useMemo(() => [
    {
      src: options.playUrl || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/playlist.m3u8`,
      type: 'application/x-mpegURL'
    }
  ], [options.playUrl, options.id]);

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  const posterUrl = useMemo(() => {
    const poster = options.poster || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/thumbnail.jpg`;
    if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
      return `https://${poster}`;
    }
    return poster;
  }, [options.poster, options.id]);

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900" dir="rtl">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* New Custom Video.js Player with Arabic/RTL support */}
          <VideoPlayerWithChapters
            videoId={options.id}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            lang="ar"
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center w-full" dir="rtl">
        <Link
          href={`/ar/channels/${options.channel}`}
          className="w-11 h-11 rounded-full overflow-hidden relative hover:opacity-80 transition-opacity"
        >
          <Image
            src={options.channelAvatar || '/avatar.png'}
            alt={t.a11y.channelAvatar.replace('{channel}', removeUnwantedChars(options.channelName))}
            sizes="10vw"
            className="bg-gray-500"
            fill
          />
        </Link>
        <div className="mt-4">
          <h1 className="sm:text-md md:text-xl font-semibold text-black dark:text-white">
            {removeUnwantedChars(title)}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayerRTL;