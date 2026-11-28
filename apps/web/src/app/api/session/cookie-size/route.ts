import { NextResponse, type NextRequest } from 'next/server';
import { SessionManager } from '@/lib/auth/session-manager';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return new NextResponse(null, { status: 404, headers: NO_STORE });

  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return new NextResponse(null, { status: 403, headers: NO_STORE });

  const sizeInfo = await SessionManager.getCookieSizeInfo();
  return NextResponse.json(sizeInfo, { headers: NO_STORE });
}
