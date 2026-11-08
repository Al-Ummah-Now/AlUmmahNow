"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[], loading?: boolean }> = ({ relatedVideos, loading = false }) => {
  return (
    <div className="related-videos bg-white dark:bg-gray-900" dir="rtl">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">الفيديوهات ذات الصلة</h2>
      {loading ? <RelatedVideosSkeleton /> : (
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
