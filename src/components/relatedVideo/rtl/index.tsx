"use client";
import React from "react";
import Image from "next/image";
import { VideoInfo } from "@/interfaces";
import { redirect } from "next/navigation";

const RelatedVideoRTL: React.FC<VideoInfo> = (info) => {
  const handleClick = () => {
    redirect(`/video?vid=${info.id}`);
  };

  return (
    <div className="flex items-center space-x-4" onClick={handleClick} dir="rtl">
      <div className="w-1/3 bg-gray-300 rounded-lg overflow-hidden">
        {info.thumbnail && (
          <Image
            src={`https://${info.thumbnail}`}
            alt="Thumbnail"
            className="!relative"
            fill
          />
        )}
      </div>
      <div className="w-2/3">
        <h3 className="text-sm font-semibold text-black dark:text-white truncate">{info.title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{info.channel}</p>
        <p className="text-xs text-gray-500">
          {info.views} • {info?.dateModified?.toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

export default RelatedVideoRTL;