"use client";
import React from "react";
import RelatedVideoRTL from "@/components/relatedVideo/rtl";
import { VideoInfo } from "@/interfaces";

const RelatedVideosSectionRTL: React.FC<{ relatedVideos: VideoInfo[] }> = ({ relatedVideos }) => {
  return (
    <div dir="rtl">
      <h2 className="text-lg font-bold mb-4">الفيديوهات ذات الصلة</h2>
      <div className="space-y-4">
        {relatedVideos.map((video) => (
          <RelatedVideoRTL key={video.id} {...video} />
        ))}
      </div>
    </div>
  );
};

export default RelatedVideosSectionRTL;
