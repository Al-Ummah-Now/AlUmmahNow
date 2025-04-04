"use client";
import React from "react";
import { redirect } from "next/navigation";
import Image from "next/image";
import { VideoInfo } from "@/interfaces";

const RelatedVideo: React.FC<VideoInfo> = (info) => {
  const handleClick = () => {
    redirect(`/video?vid=${info.id}`);
  };

  return (
    <div className="flex items-center space-x-4" onClick={handleClick}>
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
        <h3 className="text-sm font-semibold text-black truncate">
          {info.title}
        </h3>
        <p className="text-xs text-gray-500 truncate">{info.channel}</p>
        <p className="text-xs text-gray-500">
          {info.views} • {info?.dateModified?.toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

export default RelatedVideo;