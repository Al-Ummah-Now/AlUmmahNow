import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth';
import { handleRefresh } from '@/lib/refresh-handler';
import { refreshVerified } from '@/lib/verified-refresh';

/** GET /api/auth/refresh?next=/path (lib/refresh-handler.ts) */
export function GET(request: NextRequest) {
  return handleRefresh(request, (issuer, refreshToken) => refreshVerified(issuer, refreshToken, { verify: verifyAccessToken }));
}
