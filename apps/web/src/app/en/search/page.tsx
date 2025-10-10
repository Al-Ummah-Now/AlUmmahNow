"use client";
import React, { useState, useEffect, useCallback } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/index";
import SearchFilters from "@/components/search/SearchFilters/index";
import SearchSuggestions from "@/components/search/SearchSuggestions/index";
import TrendingContent from "@/components/search/TrendingContent/index";
import { SearchFilters as SearchFiltersType } from "@/lib/api/types";
import { VideosAPI } from "@/lib/api/videos";

const SearchPage: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState("");
    const [videos, setVideos] = useState<VideoObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState<SearchFiltersType>({
        category: '',
        language: 'all',
        duration: 'all',
        sortBy: 'relevance',
        sortOrder: 'desc'
    });
    const [hasSearched, setHasSearched] = useState(false);
    const [triggerSearch, setTriggerSearch] = useState(false); // Flag to trigger search from suggestion

    const hasActiveFilters = useCallback(() => {
        return Object.values(filters).some(value => 
            value && value !== 'all' && value !== 'relevance'
        );
    }, [filters]);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim() && !hasActiveFilters()) return;

        setLoading(true);
        setHasSearched(true);
        try {
            const data = await VideosAPI.search(searchQuery, filters, { limit: 20 });
            setVideos(data?.data || []);
        } catch (error) {
            console.error('Search error:', error);
            setVideos([]);
        } finally {
            setLoading(false);
        }
    }, [searchQuery, filters, hasActiveFilters]);

    const handleSuggestionSelect = (suggestion: string) => {
        setSearchQuery(suggestion);
        setTriggerSearch(true); // Set flag to trigger search after state update
    };

    // Effect to trigger search when suggestion is selected
    useEffect(() => {
        if (triggerSearch && searchQuery.trim()) {
            handleSearch();
            setTriggerSearch(false); // Reset flag
        }
    }, [triggerSearch, searchQuery, handleSearch]);

    const handleApplyFilters = () => {
        setShowFilters(false);
        handleSearch();
    };

    const handleClearFilters = () => {
        setFilters({
            category: '',
            language: 'all',
            duration: 'all',
            sortBy: 'relevance',
            sortOrder: 'desc'
        });
        setShowFilters(false);
        // Re-search if there's a query
        if (searchQuery.trim()) {
            handleSearch();
        }
    };

    // Handle Enter key in search
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <main className="flex flex-col p-4 w-full transition-all duration-300">
            <h1 className="text-2xl font-bold text-black dark:text-white mb-4">Search Videos</h1>

            {/* Search Bar with Suggestions and Filters */}
            <div className="flex items-center gap-2 mb-6">
                <SearchSuggestions
                    query={searchQuery}
                    onSuggestionSelect={handleSuggestionSelect}
                    onQueryChange={setSearchQuery}
                    onSearch={handleSearch}
                    placeholder="Search for videos..."
                />
                <button
                    onClick={handleSearch}
                    className="px-4 py-2 bg-gray-700 text-white rounded-r-md hover:bg-gray-800 transition-colors"
                >
                    Search
                </button>
                <SearchFilters
                    filters={filters}
                    onFiltersChange={setFilters}
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                    isOpen={showFilters}
                    onToggle={() => setShowFilters(!showFilters)}
                />
            </div>

            {/* Show trending content if no search has been performed */}
            {!hasSearched && (
                <TrendingContent 
                    className="mb-8"
                    limit={8}
                />
            )}

            {/* Active Filters Display */}
            {hasActiveFilters() && (
                <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Active filters:</span>
                    {filters.category && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            Category: {filters.category}
                        </span>
                    )}
                    {filters.language && filters.language !== 'all' && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            Language: {filters.language}
                        </span>
                    )}
                    {filters.duration && filters.duration !== 'all' && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            Duration: {filters.duration}
                        </span>
                    )}
                    {filters.dateFrom && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            From: {filters.dateFrom}
                        </span>
                    )}
                    {filters.dateTo && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            To: {filters.dateTo}
                        </span>
                    )}
                </div>
            )}

            {/* Search Results */}
            {hasSearched && (
                <>
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-gray-600 dark:text-gray-300">
                            {loading ? 'Searching...' : `Found ${videos.length} results`}
                            {searchQuery && ` for "${searchQuery}"`}
                        </p>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {Array.from({ length: 8 }).map((_, index) => (
                                <div key={index} className="animate-pulse">
                                    <div className="bg-gray-200 aspect-video rounded-lg mb-2"></div>
                                    <div className="space-y-2">
                                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : videos.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {videos.map((video) => (
                                <VideoCard key={video.id} {...video} />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <div className="text-gray-400 text-6xl mb-4">🔍</div>
                            <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">
                                No results found
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-4">
                                Try adjusting your search terms or filters
                            </p>
                            <button
                                onClick={handleClearFilters}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                            >
                                Clear Filters
                            </button>
                        </div>
                    )}
                </>
            )}
        </main>
    );
};

export default SearchPage;