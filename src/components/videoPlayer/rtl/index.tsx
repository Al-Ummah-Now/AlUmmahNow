"use client";
import React, { useState } from "react";
import Image from "next/image";

export interface PlayerOptions {
  id: string;
  title: string;
  channel: string;
  channelAvatar: string;
  description: string;
  views: string;
  url: string;
  autoplay: boolean;
  type: string;
  width?: number;
  height?: number;
  dateCreated: Date;
}

const VideoPlayerRTL: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const [isLoading, setIsLoading] = useState(true);

  const handleCanPlay = () => {
    setIsLoading(false); // Video is ready to play
  };

  return (
    <>
      <div className="flex justify-center w-full h-auto mt-0 max-w-[320px] max-h-[200px] md:max-w-[720px] md:max-h-[480px] xl:max-w-[1024px] xl:max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px] relative" dir="rtl">
        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-200 z-10">
            <div className="w-8 h-8 border-4 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {/* Video Player */}
        <video
          key={options.id}
          className="video-js vjs-default-skin h-auto rounded-lg overflow-hidden max-w-[320px] max-h-[200px] md:max-w-[720px] md:max-h-[480px] xl:max-w-[1024px] xl:max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px]"
          controls
          preload="auto"
          onCanPlay={handleCanPlay} // Trigger when the video is ready
        >
          <source
            src={options?.url ? `https://${options.url}` : ""}
            type={options?.type ?? "video/mp4"}
          />
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center" dir="rtl">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image
            src={options.channelAvatar}
            alt="User"
            width={40}
            height={40}
            objectFit="cover"
            className="bg-gray-500"
          />
        </div>
        <div className="mt-4">
          <h1 className="text-xl font-semibold text-black">
            {options.title}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayerRTL;