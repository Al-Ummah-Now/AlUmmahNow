"use client";
import React, { useState, useEffect } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/index";
import { useQueryState } from "nuqs";

const VideosPage: React.FC = () => {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [cursor, setCursor] = useQueryState("cursor", { shallow: true });
  const [nextCursor, setNextCursor] = useState<string | null>(null); 
  const [loading, setLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const fetchVideos = async (cursor: string | null) => {
    setLoading(true);
    try {
      const cursorString = cursor ? `&cursor=${cursor}` : "";
      const response = await fetch(
        `https://videos.api.alummahnow.net/api/videos?limit=15${cursorString}`
      );
      if (!response.ok) {
        throw new Error(`Error fetching videos: ${response.statusText}`);
      }
      const data: PaginationResponse<VideoObject> = await response.json();

      // Append new videos to the existing list
      setVideos((prevVideos) => [...prevVideos, ...data.data]);
      setNextCursor(data.cursor); // Update the next cursor
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch videos on initial render
    fetchVideos(null);
  }, []); // Empty dependency array to run only once

  const handleNextPage = () => {
    if (nextCursor) {
      setNextCursor(nextCursor); // Update the cursor in the query state
      fetchVideos(nextCursor); // Fetch the next page of videos
    }
  };

  return (
        <main
          className={`flex flex-col p-4 w-full transition-all duration-300 ${
            isCollapsed ? "md:pl-20" : "md:pl-56"
          }`}
        >
          <h1 className="text-2xl font-bold text-black dark:text-white mb-4">Videos</h1>
          {loading && videos.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">Loading...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
              {videos.map((video) => (
                <VideoCard key={video.id} {...video} />
              ))}
            </div>
          )}
          <div className="flex justify-center items-center mt-6">
            <button
              onClick={handleNextPage}
              disabled={!nextCursor || loading}
              className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load More"}
            </button>
          </div>
        </main>
  );
};

export default VideosPage;