import { logger } from '@/lib/logger-client';
/**
 * Video Analytics API Route
 *
 * Receives analytics events from the CustomVideoPlayer component and forwards
 * them to the API Videos service for processing.
 *
 * Architecture:
 * - Web App (VideoAnalytics) → POST /api/analytics/video → API Videos /api/videos/{id}/view → Queue → Processor
 */

import { NextRequest, NextResponse } from 'next/server';
import { watchTimeReports, type WatchTimeEvent } from '@/lib/video/watch-time';
import { viewContextFromBatch } from '@/lib/embed/view-context';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events = body.events || [];
    // Embed frames tag their views (docs/embeds §6); anything invalid counts as a watch-page view
    const viewContext = viewContextFromBatch(body.context);

    // Log analytics event in development with detailed error information
    if (process.env.NODE_ENV === 'development') {
      const errorEvents = events.filter((e: { eventType: string }) => e.eventType === 'error');

      logger.debug('[Analytics] Video event batch:', {
        timestamp: new Date().toISOString(),
        eventCount: events.length,
        events: events.map((e: { eventType: string }) => e.eventType)
      });

      // Log detailed error information
      if (errorEvents.length > 0) {
        errorEvents.forEach((event: { data?: unknown }) => {
          logger.error('[Analytics] ERROR DETAILS:', JSON.stringify(event.data, null, 2));
        });
      }
    }

    // Forward 'ready' events to API Videos as video views
    // Only track 'ready' to count each video load as one view (not every play/pause)
    const readyEvents = events.filter((e: { eventType: string }) => e.eventType === 'ready');

    if (readyEvents.length > 0) {
      const apiUrl = process.env.API_URL || '';

      // Process each ready event (though there should typically be only one per batch)
      for (const event of readyEvents) {
        const videoId = event.videoId;

        if (!videoId) {
          logger.warn('[Analytics] Ready event missing videoId:', event);
          continue;
        }

        try {
          const viewEndpoint = `${apiUrl}/api/videos/${videoId}/view`;

          const response = await fetch(viewEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              watchTime: 0, // Initial view, no watch time yet
              referrer: viewContext.source === 'embed' ? 'embed' : 'direct',
              deviceType: 'desktop',
              ...viewContext,
            }),
          });

          if (!response.ok) {
            logger.error(`[Analytics] Failed to forward view to API: ${response.status} ${response.statusText}`);
          } else if (process.env.NODE_ENV === 'development') {
            const result = await response.json();
            logger.debug('[Analytics] View tracked successfully:', result);
          }
        } catch (forwardError) {
          logger.error('[Analytics] Error forwarding to API:', forwardError);
          // Don't fail the request if forwarding fails
        }
      }
    }

    // #235: played-seconds reports → POST /api/videos/:id/watch-time
    const watchTime = await forwardWatchTime(events);

    return NextResponse.json({
      success: true,
      message: 'Analytics event received',
      processed: {
        total: events.length,
        views: readyEvents.length,
        watchTime,
      }
    });
  } catch (error) {
    logger.error('[Analytics] Error processing video event:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/** Forward watch-time reports; returns how many api-videos accepted. Never throws. */
async function forwardWatchTime(events: WatchTimeEvent[]): Promise<number> {
  const reports = watchTimeReports(events);
  if (reports.length === 0) return 0;
  const apiUrl = process.env.API_URL || '';
  const results = await Promise.all(
    reports.map(async ({ videoId, sessionId, seconds }) => {
      try {
        const response = await fetch(`${apiUrl}/api/videos/${encodeURIComponent(videoId)}/watch-time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds, sessionId }),
        });
        if (!response.ok) logger.warn(`[Analytics] watch-time not accepted: ${response.status}`, { videoId });
        return response.ok;
      } catch (error) {
        logger.error('[Analytics] Error forwarding watch time:', error);
        return false;
      }
    })
  );
  return results.filter(Boolean).length;
}

export async function GET() {
  // Stub for fetching analytics data
  return NextResponse.json({
    success: true,
    message: 'Analytics endpoint available',
    note: 'Use POST to send analytics events'
  });
}
