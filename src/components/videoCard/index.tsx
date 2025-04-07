"use client";
import React from "react";
import { redirect } from 'next/navigation';
import Image from "next/image";
import { VideoObject } from "@/interfaces";
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";

const VideoCard: React.FC<VideoObject> = (video) => {
    let handleClick = () => {
        redirect(`/video?vid=${video.id}`);
    }

    return (
        <div className="video-card cursor-pointer bg-white dark:bg-gray-900 text-black dark:text-white flex flex-col rounded-lg shadow-md overflow-hidden" onClick={handleClick}>
            {/* Thumbnail */}
            <div className="relative w-full h-48 bg-gray-200">
                {video.thumbnailUrl && (
                    <Image
                        src={resolveUrl(video.thumbnailUrl)}
                        alt={video.title.replace(/⧸/g, ".")}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        fill
                    />
                )}
            </div>

            {/* Video Details */}
            <div className="p-4">
                <h3 className="text-lg truncate font-[Tahoma]">
                    {removeUnwantedChars(video.title)}
                </h3>
                <p className="text-sm truncate">{video.channel}</p>
                <p className="text-sm">
                    {video.views} views • {new Date(video.dateCreated).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
};

export default VideoCard;