"use client";
import React, { useState } from "react";
import Image from "next/image";
import { removeUnwantedChars } from "@/lib/utility";

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

const VideoPlayer: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  return (
    <>
    <div
      className="flex justify-center w-full h-auto mt-0 max-w-[320px] max-h-[200px] md:max-w-[720px] md:max-h-[480px] xl:max-w-[1024px] xl:max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px] relative">
      <div className="w-[1920px] h-[1080px] rounded-lg overflow-hidden max-w-[320px] max-h-[200px] md:max-w-[720px] md:max-h-[480px] xl:max-w-[1024px] xl:max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px] dark:bg-gray-900" >
        {/* Video Player */}
        <iframe src={`https://iframe.mediadelivery.net/embed/400189/${options.id}?autoplay=false`}
          loading="lazy" style={{ border: "none", position: "absolute", top: 0, height: "100%", width: "100%" }}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen={true} referrerPolicy="origin">
        </iframe>
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
          <h1 className="sm:text-md md:text-xl  font-semibold text-black dark:text-white">
            {removeUnwantedChars(options.title)}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayer;