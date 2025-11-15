"use client";
import React, { useState, useEffect, useRef } from "react";
import { VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/index";
import { useQueryState } from "nuqs";
import { fetchVideosWithPagination } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";

const VideosPage: React.FC = () => {
  const { user } = useAuth();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [_cursor, setCursor] = useQueryState("cursor", { shallow: true });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCollapsed, _setIsCollapsed] = useState(true);

  // Prevent duplicate initial fetch
  const hasInitialFetch = useRef(false);

  const fetchVideos = async (cursor: string | null) => {
    setLoading(true);
    try {
      const data = await fetchVideosWithPagination(cursor, user?.id);
      
      if (!data) {
        console.error("Failed to fetch videos");
        return;
      }

      // Append new videos to the existing list, avoiding duplicates
      setVideos((prevVideos) => {
        const existingIds = new Set(prevVideos.map(video => video.id));
        const newVideos = data.data.filter(video => !existingIds.has(video.id));
        return [...prevVideos, ...newVideos];
      });
      setNextCursor(data.cursor); // Update the next cursor
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Prevent duplicate initial fetch
    if (hasInitialFetch.current) {
      console.log('VideosPage: Skipping duplicate initial fetch');
      return;
    }
    
    console.log('VideosPage: Performing initial fetch');
    hasInitialFetch.current = true;
    fetchVideos(null);
  }, []); // Empty dependency array to run only once

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor); // Update the cursor in the query state
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