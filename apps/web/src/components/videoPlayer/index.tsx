"use client";
import React, { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "./interface";
import CustomVideoPlayer from "@/components/VideoPlayer/CustomVideoPlayer";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";

const VideoPlayer: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const locale = lang;

  const title = getLocalizedValue((options as PlayerOptions & { titleLocalized?: Record<string, string> }).titleLocalized, options.title, locale);

  // Convert PlayerOptions to CustomVideoPlayer props
  // Memoize to prevent new array reference on every render
  const videoSources = useMemo(() => [
    {
      src: options.playUrl || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/playlist.m3u8`,
      type: 'application/x-mpegURL'
    }
  ], [options.playUrl, options.id]);

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  // Ensure the poster URL has the protocol (https://) - some API responses return relative URLs
  const posterUrl = useMemo(() => {
    const poster = options.poster || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/thumbnail.jpg`;
    // If the poster URL doesn't start with http:// or https://, prepend https://
    if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
      return `https://${poster}`;
    }
    return poster;
  }, [options.poster, options.id]);

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* New Custom Video.js Player */}
          <CustomVideoPlayer
            videoId={options.id}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            lang="en"
            className="w-full"
            ariaLabel={`Video: ${removeUnwantedChars(title)}`}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="mt-4 w-full">
        {/* Video Title */}
        <h1 className="text-lg md:text-xl font-semibold text-black dark:text-white mb-3">
          {removeUnwantedChars(title)}
        </h1>

        {/* Channel Info */}
        <div className="flex space-x-3 items-center">
          <Link
            href={`/${lang}/channels/${options.channel}`}
            className="w-10 h-10 rounded-full overflow-hidden relative hover:opacity-80 transition-opacity"
          >
            <Image
              src={options.channelAvatar || '/avatar.png'}
              alt="Channel Avatar"
              sizes="10vw"
              className="bg-gray-500"
              fill
            />
          </Link>
          <div>
            <Link
              href={`/${lang}/channels/${options.channel}`}
              className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white"
            >
              {removeUnwantedChars(options.channelName)}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default VideoPlayer;