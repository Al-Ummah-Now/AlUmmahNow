import { pushServiceWorkerSource } from '@/lib/push/service-worker';

// Built once per deploy: the script only changes with the code and the bundled strings
export const dynamic = 'force-static';

/** The Web Push service worker (lib/push/service-worker.ts), registered with scope /push/. */
export function GET(): Response {
  return new Response(pushServiceWorkerSource(), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      // Browsers re-check a worker at most daily anyway; no-cache keeps a fix from waiting longer
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
