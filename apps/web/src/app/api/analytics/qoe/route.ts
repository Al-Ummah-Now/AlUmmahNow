/**
 * Play-session quality beacon (epic #687): the player posts here (same origin,
 * so navigator.sendBeacon works without CORS) and this forwards to
 * api-videos POST /api/videos/:id/qoe with the viewer's country.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger-client';

const ID = /^[A-Za-z0-9-]{8,64}$/;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as ({ videoId?: unknown } & Record<string, unknown>) | null;
    const videoId = typeof body?.videoId === 'string' ? body.videoId : '';
    if (!body || !ID.test(videoId)) return NextResponse.json({ success: false }, { status: 400 });
    const { videoId: _omit, ...report } = body;
    void _omit;
    const country = request.headers.get('cf-ipcountry') || undefined;
    const res = await fetch(`${process.env.API_URL || ''}/api/videos/${encodeURIComponent(videoId)}/qoe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...report, ...(country && /^[A-Z]{2}$/.test(country) ? { country } : {}) }),
    });
    return NextResponse.json({ success: res.ok }, { status: res.ok ? 202 : res.status === 429 ? 429 : 400 });
  } catch (error) {
    logger.warn('[QoE] Forward failed', error);
    return NextResponse.json({ success: false }, { status: 502 });
  }
}
