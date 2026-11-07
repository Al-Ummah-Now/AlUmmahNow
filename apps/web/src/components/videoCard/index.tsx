"use client";
import React from "react";
import { redirect } from 'next/navigation';
import VideoThumbnail from "@/components/VideoThumbnail";
import { VideoObject, getLocalizedValue } from "@al-ummah/shared-types";
import { removeUnwantedChars } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";

const VideoCard: React.FC<VideoObject> = (video) => {
    const { t, lang } = useLanguage();
    const locale = lang;

    const title = getLocalizedValue(video.titleLocalized, video.title, locale);

    const handleClick = () => {
        redirect(`/${lang}/video?vid=${video.id}`);
    }

    return (
        <div className="video-card cursor-pointer bg-white dark:bg-gray-900 text-black dark:text-white flex flex-col rounded-lg shadow-md overflow-hidden" onClick={handleClick}>
            {/* Thumbnail */}
            <VideoThumbnail src={video.thumbnailUrl} alt={title.replace(/⧸/g, ".")} className="h-48" />

            {/* Video Details */}
            <div className="p-4">
                <h3 className="text-lg truncate font-[Tahoma]">
                    {removeUnwantedChars(title)}
                </h3>
                <p className="text-sm truncate">{video.channel}</p>
                <p className="text-sm">
                    {video.views} {t.video.videoViews.toLowerCase()} • {new Date(video.dateCreated).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
};

export default VideoCard;