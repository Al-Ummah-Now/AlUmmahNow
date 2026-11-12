"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosEmpty from "@/components/related/RelatedVideosEmpty";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[], loading?: boolean, onRetry?: () => void }> = ({ relatedVideos, loading = false, onRetry }) => {
  return (
    <div className="related-videos bg-white dark:bg-gray-900" dir="rtl">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">المرئيات ذات الصلة</h2>
      {loading ? <RelatedVideosSkeleton /> : relatedVideos.length === 0 ? <RelatedVideosEmpty onRetry={onRetry} /> : (
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
