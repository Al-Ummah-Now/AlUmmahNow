"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";
import CustomVideoPlayer from "@/components/VideoPlayer/CustomVideoPlayer";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";

const VideoPlayerRTL: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const { user } = useAuth();

  const title = getLocalizedValue((options as PlayerOptions & { titleLocalized?: Record<string, string> }).titleLocalized, options.title, 'ar');

  // Convert PlayerOptions to CustomVideoPlayer props
  const videoSources = [
    {
      src: `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/playlist.m3u8`,
      type: 'application/x-mpegURL'
    }
  ];

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  const posterUrl = options.poster || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/thumbnail.jpg`;

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900" dir="rtl">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* New Custom Video.js Player with Arabic/RTL support */}
          <CustomVideoPlayer
            videoId={options.id}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={true}
            isLive={false}
            lang="ar"
            className="w-full"
            ariaLabel={`فيديو: ${removeUnwantedChars(title)}`}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center w-full" dir="rtl">
        <Link
          href={`/ar/channel/${options.channel}`}
          className="w-10 h-10 rounded-full overflow-hidden relative hover:opacity-80 transition-opacity"
        >
          <Image
            src={options.channelAvatar || '/avatar.png'}
            alt="صورة القناة"
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