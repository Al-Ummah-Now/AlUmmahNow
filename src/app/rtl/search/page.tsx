"use client";
import React, { useState } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/rtl/index";
import Header from "@/components/Header/rtl/index";
import LeftNavigation from "@/components/LeftNavigation/rtl/index";

const SearchPage: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState("");
    const [videos, setVideos] = useState<VideoObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(true);

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setLoading(true);
        try {
            const response = await fetch(
                `https://videos.api.alummahnow.net/api/videos?search=${encodeURIComponent(
                    searchQuery
                )}`
            );
            if (!response.ok) {
                throw new Error(`Error fetching search results: ${response.statusText}`);
            }
            const data: PaginationResponse<VideoObject> = await response.json();
            setVideos(data.data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-white" dir="rtl">
            {/* Header */}
            <Header toggleCollapse={() => setIsCollapsed(!isCollapsed)} />

            {/* Left Navigation */}
            <LeftNavigation
                withOverlay={true}
                isCollapsed={isCollapsed}
                onCollapse={() => setIsCollapsed(true)}
            />

            <main
                className={`flex flex-col p-4 w-full transition-all duration-300 "md:pl-56"`}>
                <h1 className="text-2xl font-bold text-black mb-4">بحث الفيديوهات</h1>

                {/* Search Bar */}
                <div className="flex items-center mb-6">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ابحث عن الفيديوهات..."
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-r-md focus:outline-none focus:ring-2 focus:ring-offset-gray-700"
                    />
                    <button
                        onClick={handleSearch}
                        className="px-4 py-2 bg-gray-700 text-white rounded-l-md"
                    >
                        بحث
                    </button>
                </div>

                {/* Search Results */}
                {loading ? (
                    <p className="text-gray-500">جاري التحميل...</p>
                ) : videos.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {videos.map((video) => (
                            <VideoCard key={video.id} {...video} />
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">لم يتم العثور على نتائج.</p>
                )}
            </main>
        </div>
    );
};

export default SearchPage;
