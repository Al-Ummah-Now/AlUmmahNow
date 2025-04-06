"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[] }> = ({ relatedVideos }) => {
  return (
    <div className="related-videos bg-white dark:bg-gray-800" dir="rtl">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">Related Videos</h2>
      <div className="space-y-4">
        {relatedVideos.map((video) => (
          <RelatedVideo key={video.id} {...video} />
        ))}
      </div>
    </div>
  );
};

export default RelatedVideosSectionRTL;
