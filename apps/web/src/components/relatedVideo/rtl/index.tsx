"use client";
import React from "react";
import Image from "next/image";
import { VideoInfo } from "@/interfaces";
import { redirect } from "next/navigation";
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";

const RelatedVideoRTL: React.FC<VideoInfo> = (info) => {
  const handleClick = () => {
    redirect(`/ar/video?vid=${info.id}`);
  };

  return (
    <div className="flex items-center space-x-4 cursor-pointer" onClick={handleClick} dir="rtl">
      <div className="w-1/3 bg-gray-300 rounded-lg overflow-hidden h-16 relative max-w-[100px]">
        {info.thumbnail && (
          <Image
            src={resolveUrl(info.thumbnail)}
            alt="Thumbnail"
            sizes="10vw"
            fill
            style={{
              objectFit: 'cover',
            }}
          />
        )}
      </div>
      <div className="w-2/3">
        <h3 className="text-sm font-semibold text-black dark:text-white truncate">
          {removeUnwantedChars(info.title)}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{info.channel}</p>
        <p className="text-xs text-gray-500">
          {info.views} مشاهدة • {info?.dateModified?.toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

export default RelatedVideoRTL;