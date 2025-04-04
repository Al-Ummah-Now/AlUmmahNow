"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";

const RelatedVideosSection: React.FC<{ relatedVideos: VideoInfo[] }> = ({ relatedVideos }) => {
  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Related Videos</h2>
      <div className="space-y-4">
        {relatedVideos.map((video) => (
          <RelatedVideo key={video.id} {...video} />
        ))}
      </div>
    </div>
  );
};

export default RelatedVideosSection;
