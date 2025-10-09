"use client";
import React, { useState, useEffect } from "react";
import VideoPlayer from "@/components/videoPlayer/index";
import RelatedVideosSection from "@/components/related/index";
import { useQueryState } from "nuqs";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions } from "@/components/videoPlayer/interface";
import { fetchVideoById, fetchVideos } from "@/lib/clients/videos";

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const [vid, _setVid] = useQueryState("vid", { shallow: false });

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);

  // Fetch video by ID from query string
  useEffect(() => {
    const fetchVideoDetails = async () => {
      if (!isMounted) return;

      const details = await fetchVideoById(vid);
      setVideoDetails(details);
    };

    fetchVideoDetails();
  }, [vid, isMounted]);

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      const videos = await fetchVideos();
      setRelatedVideos(videos);
    };

    fetchRelatedVideos();
  }, []);

  return (
    <main className="flex flex-1 flex-col md:flex-row overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden">
        <div className="flex flex-col w-full lg:w-3/4 overflow-hidden">
          {/* Video Player Section */}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-center">
              <VideoPlayer options={videoDetails} />
            </div>
          )}

          {/* Comments Section */}
          <div className="flex flex-col w-full mt-4 gap-6 overflow-auto">
            <div className="w-full ">
              {/* <CommentsSection comments={comments} /> */}
            </div>
          </div>
        </div>

        {/* Related Videos Section */}
        <div className="hidden lg:block lg:w-1/4 min-w-[350px] max-w-[500px] pt-4 overflow-auto">
          <RelatedVideosSection relatedVideos={relatedVideos} keyPrefix="t_" />
        </div>
      </div>

      {/* Related Videos Section (Mobile Only) */}
      <div className="block lg:hidden w-full mt-4 overflow-auto">
        <RelatedVideosSection relatedVideos={relatedVideos} keyPrefix="b_" />
      </div>
    </main>
  );
}