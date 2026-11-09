"use client";
import React from "react";
import Image from "next/image";
import { VideoInfo } from "@/interfaces";
import Link from "next/link";
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";
import { formatViews } from '@/lib/format/videoMeta';
import { RelativeDate } from '@/components/RelativeDate';

const RelatedVideo: React.FC<VideoInfo> = (info) => {
  const { lang } = useLanguage();

  return (
    <Link
      href={`/en/video?vid=${info.id}`}
      data-testid="related-video"
      className="flex items-center space-x-4 rtl:space-x-reverse cursor-pointer rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <div className="w-1/3 bg-gray-300 rounded-lg overflow-hidden h-16 relative max-w-[100px]">
        {info.thumbnail && (
          <Image
            src={resolveUrl(info.thumbnail)}
            alt=""
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
        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{info.channelName || info.channel}</p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {formatViews(info.views, lang)} • <RelativeDate value={info?.dateModified} lang={lang} />
        </p>
      </div>
    </Link>
  );
};

export default RelatedVideo;