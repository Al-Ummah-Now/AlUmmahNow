"use client";
import React from "react";
import { VideoInfo } from "@/interfaces";
import Link from '@/components/common/AppLink';
import { removeUnwantedChars, resolveUrl } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDuration } from '@/lib/playlists/playlist-utils';

import { FitImage } from '@/components/VideoThumbnail/FitImage';
import { channelLabel } from '@/lib/channel-name';
import { VideoDate, ViewCount } from '@/components/VideoDate';
const RelatedVideoRTL: React.FC<VideoInfo> = (info) => {
  const { lang } = useLanguage();

  const duration = formatDuration(info.duration);
  return (
    <Link href={`/${lang}/video/${encodeURIComponent(info.id)}`} data-testid="related-video" className="rv">
      <div className="rv-t">
        {info.thumbnail && <FitImage src={resolveUrl(info.thumbnail)} alt="" sizes="(min-width: 1024px) 200px, 50vw" videoWidth={info.width} videoHeight={info.height} />}
        {duration && <span className="rv-d">{duration}</span>}
      </div>
      <div className="rv-b">
        <h3 className="rv-title" dir="auto">{removeUnwantedChars(info.titleLocalized?.[lang] || info.title)}</h3>
        <p className="rv-sub">{channelLabel(info, lang)}</p>
        <p className="rv-sub"><ViewCount count={info.views} lang={lang} /> • <VideoDate video={info} lang={lang} /></p>
      </div>
    </Link>
  );
};

export default RelatedVideoRTL;