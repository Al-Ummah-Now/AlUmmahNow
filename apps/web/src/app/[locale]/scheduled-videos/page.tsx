"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { searchVideos } from '@/lib/api/videos';
import type { VideoObject } from '@/interfaces';
import { ViewSwitcher, type ViewMode } from '@/components/calendar/ViewSwitcher';
import { CalendarControls } from '@/components/calendar/CalendarControls';
import { ScheduledVideosList } from '@/components/scheduled-videos/ScheduledVideosList';
import { navigateNext, navigatePrevious, type ViewType, type CalendarType } from '@/components/calendar/utils/dateFormatters';
import { Loader } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { View, NavigateAction } from 'react-big-calendar';

// Lazy load calendar component for better performance
const ScheduledVideoCalendar = dynamic(
  () => import('@/components/calendar/ScheduledVideoCalendar').then(mod => ({ default: mod.ScheduledVideoCalendar })),
  {
    loading: () => (
      <div className="flex justify-center items-center py-24">
        <Loader className="animate-spin text-blue-600" size={48} />
      </div>
    ),
    ssr: false
  }
);

export default function ScheduledVideosPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLanguage();
  const auth = useAuth();
  const { user: multiAccountUser, loading: multiAccountLoading } = useMultiAccount();

  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View state with URL persistence
  const [view, setView] = useState<ViewMode>(() => {
    const viewParam = searchParams.get('view');
    return (viewParam === 'calendar' || viewParam === 'list') ? viewParam : 'list';
  });

  const [calendarType, setCalendarType] = useState<CalendarType>(() => {
    const typeParam = searchParams.get('calendarType');
    return (typeParam === 'hijri' || typeParam === 'gregorian') ? typeParam : 'gregorian';
  });

  const [calendarView, setCalendarView] = useState<ViewType>(() => {
    const viewTypeParam = searchParams.get('calendarView');
    return (viewTypeParam === 'month' || viewTypeParam === 'week' || viewTypeParam === 'day') ? viewTypeParam : 'month';
  });

  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // Combined loading state
  const loading = multiAccountLoading || fetchLoading;

  // Update URL when view state changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    params.set('calendarType', calendarType);
    params.set('calendarView', calendarView);

    const newUrl = `${pathname}?${params.toString()}`;
    router.replace(newUrl, { scroll: false });
  }, [view, calendarType, calendarView, pathname, router, searchParams]);

  // Redirect if not authenticated or no channels
  useEffect(() => {
    if (!auth.user) {
      router.push(`/${locale}`);
      return;
    }

    // Redirect users without channels to main page
    const userChannels = multiAccountUser?.channels || [];
    if (userChannels.length === 0) {
      router.push(`/${locale}`);
    }
  }, [auth.user, multiAccountUser?.channels, router, locale]);

  // Fetch scheduled videos using single API call
  const fetchScheduledVideos = async () => {
    if (!auth.user) {
      setFetchLoading(false);
      return;
    }

    // Wait for multiAccountUser to load before fetching
    if (!multiAccountUser) {
      return;
    }

    try {
      setFetchLoading(true);
      setError(null);

      // Get all channels the user owns
      const userChannels = multiAccountUser.channels || [];
      const channelIds = userChannels.map(ch => ch.id);

      if (channelIds.length === 0) {
        // User has no channels, show empty state
        setVideos([]);
        setFetchLoading(false);
        return;
      }

      // Use single searchVideos call with schedule filtering
      const result = await searchVideos(
        '', // Empty query to get all videos
        {
          channelIds, // Filter by user's channels
          isOwner: true, // Only show videos owned by the user
          scheduleFilter: 'scheduled', // Get all scheduled videos
          sortBy: 'date', // Sort by date (most recent first)
          sortOrder: 'desc',
        },
        {
          limit: 100, // Fetch up to 100 scheduled videos
        },
        {
          userId: auth.user.id,
          channelId: auth.user.id, // Use user ID as fallback channel
        }
      );

      if (!result) {
        throw new Error('Failed to fetch scheduled videos');
      }

      setVideos(result.data);
    } catch (err) {
      console.error('Error fetching scheduled videos:', err);
      setError('An error occurred while fetching scheduled videos');
    } finally {
      setFetchLoading(false);
    }
  };

  useEffect(() => {
    fetchScheduledVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user, multiAccountUser?.channels]);

  // Handle view change
  const handleViewChange = (newView: ViewMode) => {
    setView(newView);
  };

  // Handle calendar navigation
  const handleNavigatePrevious = () => {
    setCurrentDate(prev => navigatePrevious(prev, calendarView));
  };

  const handleNavigateNext = () => {
    setCurrentDate(prev => navigateNext(prev, calendarView));
  };

  const handleNavigateToday = () => {
    setCurrentDate(new Date());
  };

  const handleCalendarNavigate = (date: Date, _view: View, _action: NavigateAction) => {
    setCurrentDate(date);
  };

  // Handle event click
  const handleEventClick = (videoId: string) => {
    router.push(`/${locale}/video/${videoId}/edit`);
  };

  // Handle video click from list
  const handleVideoClick = (videoId: string) => {
    router.push(`/${locale}/video/${videoId}/edit`);
  };

  if (!auth.user) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {t.schedule?.scheduledVideos ?? 'Scheduled Videos'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Please sign in to view your scheduled videos.
          </p>
          <Link
            href={`/${locale}/`}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t.navigation?.signIn ?? 'Sign In'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-6 lg:px-8 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t.schedule?.myScheduledVideos ?? 'My Scheduled Videos'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.schedule?.noScheduledVideosMessage ?? 'View and manage your scheduled videos'}
          </p>
        </div>

        {/* View Switcher */}
        <ViewSwitcher
          currentView={view}
          onViewChange={handleViewChange}
        />
      </div>

      {/* Calendar Controls (only shown in calendar view) */}
      {view === 'calendar' && (
        <div className="mb-6">
          <CalendarControls
            currentDate={currentDate}
            viewType={calendarView}
            calendarType={calendarType}
            onViewTypeChange={setCalendarView}
            onCalendarTypeChange={setCalendarType}
            onNavigatePrevious={handleNavigatePrevious}
            onNavigateNext={handleNavigateNext}
            onNavigateToday={handleNavigateToday}
          />
        </div>
      )}

      {/* Main Content */}
      {view === 'list' ? (
        <ScheduledVideosList
          videos={videos}
          isLoading={loading}
          error={error ? new Error(error) : null}
          onVideoClick={handleVideoClick}
          onRefresh={fetchScheduledVideos}
        />
      ) : (
        <ScheduledVideoCalendar
          videos={videos}
          calendarType={calendarType}
          viewType={calendarView}
          currentDate={currentDate}
          onNavigate={handleCalendarNavigate}
          onEventClick={handleEventClick}
          isLoading={loading}
          error={error ? new Error(error) : null}
        />
      )}
    </div>
  );
}
