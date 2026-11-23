/**
 * Server-side error reporting for caught web auth/infrastructure failures (#302).
 *
 * Uses the same @al-ummah/shared-types `reportServerError('web', ...)` pipeline
 * as src/instrumentation.ts so caught errors that matter reach the admin Errors
 * page. Never throws and never includes raw tokens or cookies.
 */
import { reportServerError } from '@al-ummah/shared-types';

/** Next.js throws internal control-flow errors with these digests; never log or report them. */
const NEXT_CONTROL_FLOW_PREFIXES = [
  'NEXT_REDIRECT',
  'NEXT_NOT_FOUND',
  'NEXT_HTTP_ERROR_FALLBACK',
  'DYNAMIC_SERVER_USAGE',
  'NEXT_PRERENDER_INTERRUPTED',
];

export function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === 'string' && NEXT_CONTROL_FLOW_PREFIXES.some((p) => digest === p || digest.startsWith(`${p};`))) {
    return true;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'DYNAMIC_SERVER_USAGE';
}

/**
 * Thrown when reading the server-side auth session fails due to an infrastructure
 * or runtime error rather than a genuinely signed-out user (#302).
 * Carries `reported: true` once logged/reported so outer helpers do not double-report.
 */
export class SessionInfrastructureError extends Error {
  readonly reported: boolean;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown, reported = true) {
    super(message);
    this.name = 'SessionInfrastructureError';
    this.cause = cause;
    this.reported = reported;
  }
}

export function safeErrorMeta(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message || 'Unknown error' };
  }
  return { name: typeof error, message: String(error) };
}

export interface ServerReportOptions {
  route: string;
  kind?: 'caught' | 'http' | 'unhandled';
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * Reports a caught server-side web error to the admin Errors page.
 * Safe in Workers, next dev, and unit tests; never throws.
 */
export async function reportWebServerError(error: unknown, opts: ServerReportOptions): Promise<string> {
  try {
    let env: Record<string, unknown> = {};
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const cf = await getCloudflareContext({ async: true });
      env = (cf.env as unknown as Record<string, unknown>) ?? {};
      ctx = cf.ctx as unknown as { waitUntil(p: Promise<unknown>): void } | undefined;
    } catch {
      // next dev / tests: fall back to process.env when configured
    }

    const ingestUrl = (env.ERRORS_INGEST_URL as string | undefined) ?? process.env.ERRORS_INGEST_URL;
    const apiKey = (env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined) ?? process.env.INTERNAL_API_KEY;
    if (!ingestUrl || !apiKey) return '';

    return reportServerError(
      'web',
      {
        ERRORS_INGEST_URL: ingestUrl,
        INTERNAL_API_KEY: apiKey,
        ENVIRONMENT: (env.NEXTJS_ENV as string | undefined) ?? process.env.NEXTJS_ENV,
        CF_VERSION_METADATA: env.CF_VERSION_METADATA as { id?: string } | undefined,
      },
      ctx,
      error,
      {
        kind: opts.kind ?? 'caught',
        route: opts.route,
        release: process.env.NEXT_PUBLIC_RELEASE,
        extra: opts.extra,
      },
    );
  } catch {
    return '';
  }
}
