"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosFailed from "@/components/related/RelatedVideosFailed";
import type { RelatedShelfStatus } from "@/hooks/useRelatedVideos";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[], status: RelatedShelfStatus, onRetry?: () => void }> = ({ relatedVideos, status, onRetry }) => {
  // A successful empty answer hides the shelf: the owner's rule is no hollow sections (#1552)
  if (status === 'success' && relatedVideos.length === 0) return null;
  return (
    <div className="related-videos bg-white dark:bg-gray-900" dir="rtl">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">المرئيات ذات الصلة</h2>
      {status === 'loading' ? <RelatedVideosSkeleton /> : status === 'error' ? <RelatedVideosFailed onRetry={onRetry} /> : (
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
