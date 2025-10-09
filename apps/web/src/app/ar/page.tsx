"use client";
import React, { useState, useEffect, useRef } from "react";
import { VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/rtl/index";
import { useQueryState } from "nuqs";
import { usePathname } from "next/navigation";
import { fetchVideosWithPagination } from "@/lib/clients/videos";

const VideosPage: React.FC = () => {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [_cursor, setCursor] = useQueryState("cursor", { shallow: true });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const path = usePathname();
  const rtl = path.indexOf('/ar') > -1;
  
  // Prevent duplicate initial fetch
  const hasInitialFetch = useRef(false);

  const fetchVideos = async (cursor: string | null) => {
    setLoading(true);
    try {
      const data = await fetchVideosWithPagination(cursor);
      
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
      setNextCursor(data.cursor);
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Prevent duplicate initial fetch
    if (hasInitialFetch.current) {
      console.log('VideosPage (AR): Skipping duplicate initial fetch');
      return;
    }
    
    console.log('VideosPage (AR): Performing initial fetch');
    hasInitialFetch.current = true;
    fetchVideos(null);
  }, []);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor); // Update the cursor in the query state
      fetchVideos(nextCursor); // Fetch the next page of videos
    }
  };

  return (
    <main className={`flex flex-col p-4 w-full transition-all duration-300 ${isCollapsed ? "md:pr-20" : "md:pr-56"}`} style={{ direction: rtl ? "rtl" : "ltr" }}>
      <h1 className="text-2xl font-bold text-black dark:text-white mb-4">الفيديوهات</h1>
      {loading && videos.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">جاري التحميل...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
          {videos.map((video) => (
            <VideoCard key={`rtl_${video.id}`} {...video} />
          ))}
        </div>
      )}
      <div className="flex justify-center items-center mt-6">
        <button
          onClick={handleNextPage}
          disabled={!nextCursor || loading}
          className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50"
        >
          {loading ? "جاري التحميل..." : "تحميل المزيد"}
        </button>
      </div>
    </main>
  );
};

export default VideosPage;
