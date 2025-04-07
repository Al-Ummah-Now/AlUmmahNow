"use client";
import React, { useState, useEffect } from "react";
import VideoPlayer, { PlayerOptions } from "@/components/videoPlayer/rtl/index";
import RelatedVideosSection from "@/components/related/rtl/index";
import { useQueryState } from "nuqs";
import { PaginationResponse, VideoInfo, VideoObject } from "../../../interfaces";

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const [vid, setVid] = useQueryState("vid", { shallow: false });

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);

  // Fetch video by ID from query string
  useEffect(() => {
    if (!isMounted) return;

    const fetchVideoById = async () => {
      if (!vid) return;

      try {
        const response = await fetch(
          `https://videos.api.alummahnow.net/api/videos/${vid}`
        );
        if (!response.ok) {
          throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const video: VideoObject = await response.json();
        setVideoDetails({
          id: video.id,
          title: video.title,
          description: video.description,
          channel: video.channel,
          url: video.videoUrl,
          views: `${video.views || 0}`,
          dateCreated: new Date(video.dateCreated),
          autoplay: false,
          type: "video/mp4",
          channelAvatar: video.channelThumbnailUrl,
        });
      } catch (error) {
        console.error(error);
      }
    };

    fetchVideoById();
  }, [vid, isMounted]);

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      try {
        const response = await fetch(
          "https://videos.api.alummahnow.net/api/videos?limit=15"
        );
        if (!response.ok) {
          throw new Error(`Error fetching related videos: ${response.statusText}`);
        }
        const result: PaginationResponse<VideoObject> = await response.json();
        setRelatedVideos(
          result.data.map((video) => ({
            id: video.id,
            title: video.title,
            description: video.description,
            channel: video.channel,
            channelId: video.channelId,
            thumbnail: video.thumbnailUrl,
            video: video.videoUrl,
            views: `${video.views || 0}`,
            dateCreated: new Date(video.dateCreated),
            dateModified: new Date(video.dateModified),
          }))
        );
      } catch (error) {
        console.error(error);
      }
    };

    fetchRelatedVideos();
  }, []);

  return (
    <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
      <main className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden">
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
          <RelatedVideosSection relatedVideos={relatedVideos} />
        </div>
      </main>

      {/* Related Videos Section (Mobile Only) */}
      <div className="block lg:hidden w-full mt-4 overflow-auto">
        <RelatedVideosSection relatedVideos={relatedVideos} />
      </div>
    </div>
  );
}
