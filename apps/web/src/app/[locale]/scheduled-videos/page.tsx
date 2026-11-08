'use client';

import { logger } from '@/lib/logger-client';
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
import { navigateNext, navigatePrevious, type ViewType } from '@/components/calendar/utils/dateFormatters';
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

  const [calendarView, setCalendarView] = useState<ViewType>(() => {
    const viewTypeParam = searchParams.get('calendarView');
    return (viewTypeParam === 'month' || viewTypeParam === 'week' || viewTypeParam === 'day') ? viewTypeParam : 'month';
  });

  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // Combined loading state for list view
  const loading = multiAccountLoading || fetchLoading;

  // Calendar-specific loading: only show loading during actual video fetch
  // Don't tie to multiAccountLoading to avoid stuck loading states
  const calendarLoading = fetchLoading;

  // Debug logging to track loading state
  useEffect(() => {
    logger.debug('[ScheduledVideos] Loading state:', {
      multiAccountLoading,
      fetchLoading,
      loading,
      calendarLoading,
      hasAuth: !!auth.user,
      hasMultiAccount: !!multiAccountUser,
      videosCount: videos.length
    });
  }, [multiAccountLoading, fetchLoading, loading, calendarLoading, auth.user, multiAccountUser, videos.length]);

  // Update URL when view state changes
  useEffect(() => {
    const currentView = searchParams.get('view');
    const currentCalendarView = searchParams.get('calendarView');

    // Only update if values have actually changed
    if (
      currentView !== view ||
      currentCalendarView !== calendarView
    ) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', view);
      params.set('calendarView', calendarView);
      // Remove calendarType param if it exists (cleanup from old version)
      params.delete('calendarType');

      const newUrl = `${pathname}?${params.toString()}`;
      // history.replaceState (which Next syncs into useSearchParams) instead of
      // router.replace: a router navigation on mount dropped the session
      // server action that was still in flight, leaving the list loading forever
      window.history.replaceState(window.history.state, '', newUrl);
    }
  }, [view, calendarView, pathname, searchParams]);

  // Redirect if not authenticated or no channels
  useEffect(() => {
    if (!auth.user) {
      router.push(`/${locale}`);
      return;
    }

    // Only redirect if we've confirmed user has loaded and has no channels
    if (multiAccountUser && !multiAccountLoading) {
      const userChannels = multiAccountUser.channels || [];
      if (userChannels.length === 0) {
        router.push(`/${locale}`);
      }
    }
  }, [auth.user, multiAccountUser, multiAccountLoading, router, locale]);

  // Fetch scheduled videos using single API call
  const fetchScheduledVideos = async () => {
    logger.debug('[fetchScheduledVideos] Starting fetch', {
      hasAuth: !!auth.user,
      hasMultiAccount: !!multiAccountUser
    });

    // Clear any previous errors at the start
    setError(null);

    if (!auth.user) {
      logger.debug('[fetchScheduledVideos] No auth user, stopping');
      setFetchLoading(false);
      return;
    }

    // Wait for multiAccountUser to load before fetching
    if (!multiAccountUser) {
      logger.debug('[fetchScheduledVideos] Waiting for multiAccountUser to load');
      return;
    }

    try {
      logger.debug('[fetchScheduledVideos] Setting fetchLoading = true');
      setFetchLoading(true);

      // Get all channels the user owns
      const userChannels = multiAccountUser.channels || [];
      const channelIds = userChannels.map(ch => ch.id);

      logger.debug('[fetchScheduledVideos] User channels:', channelIds);

      if (channelIds.length === 0) {
        // User has no channels, show empty state
        logger.debug('[fetchScheduledVideos] No channels, showing empty state');
        setVideos([]);
        setFetchLoading(false);
        return;
      }

      // Use single searchVideos call with schedule filtering
      logger.debug('[fetchScheduledVideos] Calling searchVideos API...');
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
          // Use first channel ID (auth header requires a valid channel ID, not user ID)
          channelId: channelIds[0],
        }
      );

      logger.debug('[fetchScheduledVideos] API response:', {
        hasResult: !!result,
        dataLength: result?.data?.length || 0
      });

      // Handle null result or missing data gracefully
      if (!result || !result.data) {
        logger.debug('[fetchScheduledVideos] No data returned, setting empty array');
        setVideos([]);
      } else {
        setVideos(result.data);
        logger.debug('[fetchScheduledVideos] Videos updated successfully');
      }
    } catch (err) {
      logger.error('[fetchScheduledVideos] Error fetching scheduled videos:', err);
      setError(t.schedule?.errorFetchingScheduled ?? t.errors.genericError);
    } finally {
      logger.debug('[fetchScheduledVideos] Setting fetchLoading = false');
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
            {t.schedule?.signInToViewScheduled ?? t.errors.unauthorized}
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
    <div data-testid="scheduled-videos-page" className="container mx-auto px-4 md:px-6 lg:px-8 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t.schedule?.myScheduledVideos ?? 'My Scheduled Videos'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.schedule?.manageScheduledVideos ?? t.schedule?.scheduledVideos}
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
            onViewTypeChange={setCalendarView}
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
          viewType={calendarView}
          currentDate={currentDate}
          onNavigate={handleCalendarNavigate}
          onEventClick={handleEventClick}
          isLoading={calendarLoading}
          error={error ? new Error(error) : null}
        />
      )}
    </div>
  );
}
