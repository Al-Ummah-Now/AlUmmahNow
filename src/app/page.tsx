"use client";
import React, { useState, useEffect } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard";
import Header from "@/components/Header";
import LeftNavigation from "@/components/LeftNavigation";

const VideosPage: React.FC = () => {
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const fetchVideos = async (page: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/videos?page=${page}&limit=9`);
      if (!response.ok) {
        throw new Error(`Error fetching videos: ${response.statusText}`);
      }
      const data: PaginationResponse<VideoObject> = await response.json();
      setVideos(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos(page);
  }, [page]);

  const handleNextPage = () => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  };

  const handlePreviousPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className="flex flex-col min-h-screen bg-ummah-bg">
      {/* Header */}
      <Header toggleCollapse={toggleCollapse} />

      <div className="flex flex-1 flex-col">
        {/* Left Navigation */}
        <LeftNavigation isCollapsed={isCollapsed} />

        <main
          className={`flex flex-col p-4 w-full transition-all duration-300 ${isCollapsed ? "md:pl-20" : "md:pl-56"
            }`}
        >
          <h1 className="text-2xl font-bold text-ummah-text mb-4">Videos</h1>
          {loading ? (
            <p className="text-ummah-label">Loading...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-4">
              {videos.map((video) => (
                <VideoCard key={video.id} {...video} />
              ))}
            </div>
          )}
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={handlePreviousPage}
              disabled={page === 1}
              className="px-4 py-2 bg-ummah-400 text-white rounded disabled:opacity-50"
            >
              Previous
            </button>
            <p className="text-ummah-label">
              Page {page} of {totalPages}
            </p>
            <button
              onClick={handleNextPage}
              disabled={page === totalPages}
              className="px-4 py-2 bg-ummah-400 text-white rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default VideosPage;