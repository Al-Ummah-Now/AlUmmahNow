"use client";
import React from "react";
import Image from "next/image";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";

const VideoPlayerRTL: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  const aspectRatio = (options.width ?? 1920) / (options.height ?? 1080);
  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900" dir="rtl">
        <div className={`w-full rounded-lg overflow-hidden`}
          style={{
            aspectRatio: `${aspectRatio}`, // Dynamically set the aspect ratio
            margin: 0,
            padding: 0,
            lineHeight: 0,
          }}>
          {/* Video Player */}
          <iframe
            src={`https://iframe.mediadelivery.net/embed/400189/${options.id}?autoplay=false`}
            loading="lazy"
            style={{
              border: "none",
              position: "absolute",
              top: 0,
              height: "100%",
              width: "100%",
            }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen={true}
            referrerPolicy="origin"
          ></iframe>
        </div>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center w-full">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image
            src={options.channelAvatar}
            alt="User"
            sizes="10vw"
            className="bg-gray-500"
            fill
          />
        </div>
        <div className="mt-4">
          <h1 className="sm:text-md md:text-xl font-semibold text-black dark:text-white">
            {removeUnwantedChars(options.title)}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayerRTL;