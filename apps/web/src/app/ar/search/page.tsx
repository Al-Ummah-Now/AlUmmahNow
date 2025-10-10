"use client";
import React, { useState, useEffect, useCallback } from "react";
import { PaginationResponse, VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/rtl/index";
import SearchFilters from "@/components/search/SearchFilters/rtl/index";
import SearchSuggestions from "@/components/search/SearchSuggestions/rtl/index";
import TrendingContent from "@/components/search/TrendingContent/rtl/index";
import { SearchFilters as SearchFiltersType } from "@/lib/api/types";
import { VideosAPI } from "@/lib/api/videos";
import { redirect, useSearchParams, usePathname } from "next/navigation";

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
    const path = usePathname();
    const rtl = path.indexOf('/ar') > -1;

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

    return (
        <main className="flex flex-col p-4 w-full transition-all duration-300" style={{ direction: rtl ? "rtl" : "ltr" }}>
            <h1 className="text-2xl font-bold text-black mb-4">بحث الفيديوهات</h1>

            {/* Search Bar with Suggestions and Filters */}
            <div className="flex items-center gap-2 mb-6" dir="rtl">
                <SearchFilters
                    filters={filters}
                    onFiltersChange={setFilters}
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                    isOpen={showFilters}
                    onToggle={() => setShowFilters(!showFilters)}
                />
                <button
                    onClick={handleSearch}
                    className="px-4 py-2 bg-gray-700 text-white rounded-l-md hover:bg-gray-800 transition-colors"
                >
                    بحث
                </button>
                <SearchSuggestions
                    query={searchQuery}
                    onSuggestionSelect={handleSuggestionSelect}
                    onQueryChange={setSearchQuery}
                    onSearch={handleSearch}
                    placeholder="ابحث عن الفيديوهات..."
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
                <div className="flex flex-wrap gap-2 mb-4" dir="rtl">
                    <span className="text-sm text-gray-600">المرشحات النشطة:</span>
                    {filters.category && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            الفئة: {filters.category}
                        </span>
                    )}
                    {filters.language && filters.language !== 'all' && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            اللغة: {filters.language === 'ar' ? 'العربية' : 'الإنجليزية'}
                        </span>
                    )}
                    {filters.duration && filters.duration !== 'all' && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            المدة: {filters.duration === 'short' ? 'قصير' : filters.duration === 'medium' ? 'متوسط' : 'طويل'}
                        </span>
                    )}
                    {filters.dateFrom && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            من: {filters.dateFrom}
                        </span>
                    )}
                    {filters.dateTo && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            إلى: {filters.dateTo}
                        </span>
                    )}
                </div>
            )}

            {/* Search Results */}
            {hasSearched && (
                <>
                    <div className="flex items-center justify-between mb-4" dir="rtl">
                        <p className="text-gray-600">
                            {loading ? 'جاري البحث...' : `تم العثور على ${videos.length} نتيجة`}
                            {searchQuery && ` لـ "${searchQuery}"`}
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
                            <h3 className="text-lg font-semibold text-gray-600 mb-2">
                                لم يتم العثور على نتائج
                            </h3>
                            <p className="text-gray-500 mb-4">
                                حاول تعديل مصطلحات البحث أو المرشحات
                            </p>
                            <button
                                onClick={handleClearFilters}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                            >
                                مسح المرشحات
                            </button>
                        </div>
                    )}
                </>
            )}
        </main>
    );
};

export default SearchPage;
