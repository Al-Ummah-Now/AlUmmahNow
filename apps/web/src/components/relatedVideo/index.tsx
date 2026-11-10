"use client";
import React from "react";
import Image from "next/image";
import { VideoInfo } from "@/interfaces";
import Link from "next/link";
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";
import { formatViews } from '@/lib/format/videoMeta';
import { RelativeDate } from '@/components/RelativeDate';
import { formatDuration } from '@/lib/playlists/playlist-utils';

const RelatedVideo: React.FC<VideoInfo> = (info) => {
  const { lang } = useLanguage();

  const duration = formatDuration(info.duration);
  return (
    <Link href={`/${lang}/video?vid=${info.id}`} data-testid="related-video" className="rv">
      <div className="rv-t">
        {info.thumbnail && <Image src={resolveUrl(info.thumbnail)} alt="" sizes="(min-width: 1024px) 200px, 50vw" fill style={{ objectFit: 'cover' }} />}
        {duration && <span className="rv-d">{duration}</span>}
      </div>
      <div className="rv-b">
        <h3 className="rv-title" dir="auto">{removeUnwantedChars(info.titleLocalized?.[lang] || info.title)}</h3>
        <p className="rv-sub">{info.channelName || info.channel}</p>
        <p className="rv-sub">{formatViews(info.views, lang)} • <RelativeDate value={info?.dateModified} lang={lang} /></p>
      </div>
    </Link>
  );
};

export default RelatedVideo;