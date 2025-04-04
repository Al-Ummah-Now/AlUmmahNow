"use client";
import React from "react";
import { redirect } from 'next/navigation';
import Image from "next/image";
import { VideoObject } from "@/interfaces";

const VideoCard: React.FC<VideoObject> = (video) => {
  let handleClick = () => {
    redirect(`/video?vid=${video.id}`);
  }

    return (
        <div className="flex flex-col bg-white rounded-lg shadow-md overflow-hidden" onClick={handleClick}>
            {/* Thumbnail */}
            <div className="relative w-full h-48 bg-gray-200">
                {video.thumbnailUrl && (
                    <Image
                        src={`https://${video.thumbnailUrl}`}
                        alt={video.title}
                        fill
                        className="object-cover"
                    />
                )}
            </div>

            {/* Video Details */}
            <div className="p-4">
                <h3 className="text-lg  text-black truncate font-[Tahoma]">
                    {video.title}
                </h3>
                <p className="text-sm text-gray-500 truncate">{video.channel}</p>
                <p className="text-sm text-gray-500">
                    {video.views} views • {new Date(video.dateCreated).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
};

export default VideoCard;