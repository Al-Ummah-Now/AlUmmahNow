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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events = body.events || [];

    // Log analytics event in development with detailed error information
    if (process.env.NODE_ENV === 'development') {
      const errorEvents = events.filter((e: { eventType: string }) => e.eventType === 'error');

      console.log('[Analytics] Video event batch:', {
        timestamp: new Date().toISOString(),
        eventCount: events.length,
        events: events.map((e: { eventType: string }) => e.eventType)
      });

      // Log detailed error information
      if (errorEvents.length > 0) {
        errorEvents.forEach((event: { data?: unknown }) => {
          console.error('[Analytics] ERROR DETAILS:', JSON.stringify(event.data, null, 2));
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
          console.warn('[Analytics] Ready event missing videoId:', event);
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
              referrer: 'direct',
              deviceType: 'desktop',
            }),
          });

          if (!response.ok) {
            console.error('[Analytics] Failed to forward view to API:', response.status, response.statusText);
          } else if (process.env.NODE_ENV === 'development') {
            const result = await response.json();
            console.log('[Analytics] View tracked successfully:', result);
          }
        } catch (forwardError) {
          console.error('[Analytics] Error forwarding to API:', forwardError);
          // Don't fail the request if forwarding fails
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Analytics event received',
      processed: {
        total: events.length,
        views: readyEvents.length
      }
    });
  } catch (error) {
    console.error('[Analytics] Error processing video event:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Stub for fetching analytics data
  return NextResponse.json({
    success: true,
    message: 'Analytics endpoint available',
    note: 'Use POST to send analytics events'
  });
}
