"use client";
import React, { useMemo } from "react";
import Image from "next/image";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "./interface";
import CustomVideoPlayer from "@/components/VideoPlayer/CustomVideoPlayer";
import { useAuth } from "@/components/AuthProvider/authContext";

const VideoPlayer: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const { user } = useAuth();

  // Convert PlayerOptions to CustomVideoPlayer props
  // Memoize to prevent new array reference on every render
  const videoSources = useMemo(() => [
    {
      src: `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/playlist.m3u8`,
      type: 'application/x-mpegURL'
    }
  ], [options.id]);

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  const posterUrl = options.poster || `https://vz-215a1ffd-a5a.b-cdn.net/${options.id}/thumbnail.jpg`;

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900">
        <div className="w-full rounded-lg overflow-hidden 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
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
            ariaLabel={`Video: ${removeUnwantedChars(options.title)}`}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center w-full">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image
            src={options.channelAvatar || '/avatar.png'}
            alt="User"
            sizes="10vw"
            className="bg-gray-500"
            fill
          />
        </div>
        <div className="mt-4">
          <h1 className="sm:text-md md:text-xl  font-semibold text-black dark:text-white">
            {removeUnwantedChars(options.title)}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayer;