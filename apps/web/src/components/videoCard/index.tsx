"use client";
import React from "react";
import Link from "next/link";
import VideoThumbnail from "@/components/VideoThumbnail";
import { VideoObject, getLocalizedValue } from "@al-ummah/shared-types";
import { removeUnwantedChars } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";
import { VideoCardMenu } from "@/components/library/VideoCardMenu";

const VideoCard: React.FC<VideoObject> = (video) => {
    const { t, lang } = useLanguage();
    const locale = lang;

    const title = getLocalizedValue(video.titleLocalized, video.title, locale);

    // A real link (not an onClick redirect) so cards are keyboard focusable,
    // can be opened in a new tab and are announced as links
    return (
        <div className="relative">
            <Link
                href={`/${lang}/video?vid=${video.id}`}
                data-testid="video-card"
                data-video-id={video.id}
                className="video-card cursor-pointer bg-white dark:bg-gray-900 text-black dark:text-white flex flex-col rounded-lg shadow-md overflow-hidden"
            >
                {/* Thumbnail */}
                <VideoThumbnail src={video.thumbnailUrl} alt={title.replace(/⧸/g, ".")} className="h-48" />

                {/* Video Details */}
                <div className="p-4 pe-12">
                    <h3 className="text-lg truncate font-[Tahoma]">
                        {removeUnwantedChars(title)}
                    </h3>
                    <p className="text-sm truncate">{video.channel}</p>
                    <p className="text-sm">
                        {video.views} {t.video.videoViews.toLowerCase()} • {new Date(video.dateCreated).toLocaleDateString()}
                    </p>
                </div>
            </Link>
            {/* Outside the link: interactive controls must not be nested in an anchor */}
            <VideoCardMenu videoId={video.id} title={removeUnwantedChars(title)} className="absolute bottom-2 end-2" />
        </div>
    );
};

export default VideoCard;
