/**
 * Video Analytics API Route
 *
 * Temporary stub endpoint for video analytics tracking.
 * This endpoint receives analytics events from the CustomVideoPlayer component.
 *
 * In production, this should forward events to the analytics service or database.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Log analytics event in development with detailed error information
    if (process.env.NODE_ENV === 'development') {
      const events = body.events || [];
      const errorEvents = events.filter((e: { eventType: string }) => e.eventType === 'error');

      console.log('[Analytics] Video event:', {
        timestamp: new Date().toISOString(),
        ...body
      });

      // Log detailed error information
      if (errorEvents.length > 0) {
        errorEvents.forEach((event: { data?: unknown }) => {
          console.error('[Analytics] ERROR DETAILS:', JSON.stringify(event.data, null, 2));
        });
      }
    }

    // In production, this should:
    // 1. Validate the event data
    // 2. Forward to analytics service (e.g., processor queue, analytics API)
    // 3. Store in database or analytics platform

    return NextResponse.json({
      success: true,
      message: 'Analytics event received'
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

export async function GET(request: NextRequest) {
  // Stub for fetching analytics data
  return NextResponse.json({
    success: true,
    message: 'Analytics endpoint available',
    note: 'Use POST to send analytics events'
  });
}
