import type { NextRequest } from 'next/server';
import { getAuthClient } from '@/lib/auth';
import { subjects } from '@/interfaces/subjects';
import { logger } from '@/lib/logger';
import { handleCallback, type CallbackClient } from '@/lib/callback-handler';

/** OAuth callback: see lib/callback-handler.ts (state is checked before anything else). */
export async function GET(request: NextRequest) {
  return handleCallback(request, {
    getClient: async () => (await getAuthClient()) as unknown as CallbackClient,
    subjects,
    log: logger,
  });
}
