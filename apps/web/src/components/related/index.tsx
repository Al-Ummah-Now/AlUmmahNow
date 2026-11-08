"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";
import { useLanguage } from "@/hooks/useLanguage";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosEmpty from "@/components/related/RelatedVideosEmpty";

const RelatedVideosSection: React.FC<{ relatedVideos: VideoInfo[], keyPrefix: string | null, loading?: boolean, onRetry?: () => void }> = ({ relatedVideos, keyPrefix, loading = false, onRetry }) => {
  const { t } = useLanguage();
  return (
    <div className="related-videos bg-white dark:bg-gray-900">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">{t.video.relatedVideos}</h2>
      {loading ? <RelatedVideosSkeleton /> : relatedVideos.length === 0 ? <RelatedVideosEmpty onRetry={onRetry} /> : (
        <div data-testid="related-videos-list" className="space-y-4 mx-4 md:mx-0">
          {relatedVideos.map((video) => (
            <RelatedVideo key={`${keyPrefix}_${video.id}`} {...video} />
          ))}
        </div>
      )}
    </div>
  );
};

export default RelatedVideosSection;
