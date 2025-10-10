"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";

const RelatedVideosSection: React.FC<{ relatedVideos: VideoInfo[], keyPrefix: string | null }> = ({ relatedVideos, keyPrefix }) => {
  return (
    <div className="related-videos bg-white dark:bg-gray-900">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">Related Videos</h2>
      <div className="space-y-4 mx-4 md:mx-0">
        {relatedVideos.map((video) => (
          <RelatedVideo key={`${keyPrefix}_${video.id}`} {...video} />
        ))}
      </div>
    </div>
  );
};

export default RelatedVideosSection;
