"use client";
import React, { useState, useEffect } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/rtl/index";
import { useQueryState } from "nuqs";
import { redirect, useSearchParams, usePathname } from "next/navigation";

const VideosPage: React.FC = () => {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [cursor, setCursor] = useQueryState("cursor", { shallow: true });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const path = usePathname();
  const rtl = path.indexOf('/rtl') > -1;

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

      setVideos((prevVideos) => [...prevVideos, ...data.data]);
      setNextCursor(data.cursor);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos(null);
  }, []);

  const handleNextPage = () => {
    if (nextCursor) {
      setNextCursor(nextCursor);
      fetchVideos(nextCursor);
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
