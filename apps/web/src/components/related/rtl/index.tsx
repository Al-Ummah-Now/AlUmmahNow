"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";
import { useLanguage } from "@/hooks/useLanguage";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosError from "@/components/related/RelatedVideosError";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[], loading?: boolean, failed?: boolean, onRetry?: () => void }> = ({ relatedVideos, loading = false, failed = false, onRetry }) => {
  const { t } = useLanguage();
  if (!loading && !failed && relatedVideos.length === 0) return null;

  return (
    <div className="related-videos bg-white dark:bg-gray-900" dir="rtl">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">{t.video.relatedVideos}</h2>
      {loading ? <RelatedVideosSkeleton /> : failed ? <RelatedVideosError onRetry={onRetry} /> : (
        <div data-testid="related-videos-list" className="space-y-4">
          {relatedVideos.map((video) => (
            <RelatedVideo key={video.id} {...video} />
          ))}
        </div>
      )}
    </div>
  );
};

export default RelatedVideosSectionRTL;
