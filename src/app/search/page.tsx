"use client";
import React, { useState } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard";
import Header from "@/components/Header";
import LeftNavigation from "@/components/LeftNavigation";

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
        <div className="flex flex-col min-h-screen bg-ummah-bg">
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
                <h1 className="text-2xl font-bold text-ummah-text mb-4">Search Videos</h1>

                {/* Search Bar */}
                <div className="flex items-center mb-6">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search for videos..."
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-ummah-400"
                    />
                    <button
                        onClick={handleSearch}
                        className="px-4 py-2 bg-ummah-400 text-white rounded-r-md"
                    >
                        Search
                    </button>
                </div>

                {/* Search Results */}
                {loading ? (
                    <p className="text-ummah-label">Loading...</p>
                ) : videos.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {videos.map((video) => (
                            <VideoCard key={video.id} {...video} />
                        ))}
                    </div>
                ) : (
                    <p className="text-ummah-label">No results found.</p>
                )}
            </main>
        </div>
    );
};

export default SearchPage;