/**
 * Context of one error event: what an admin needs to act on it without
 * Cloudflare access (videos admin Errors page, error detail). Ids only, never
 * names, emails, titles or bodies; scrubbed by the reporter and again on ingest.
 * Browser-safe (no Node imports): the request trail that fills it on the
 * Workers is in ./trail.ts.
 */
import { scrubText, scrubUrl } from './scrub';

export interface ErrorBreadcrumb {
  /** ISO time */
  at: string;
  /** navigation, fetch, queue, step, log, ... */
  kind: string;
  message: string;
}

export interface ErrorUpstream {
  /** Which call failed: a host ("video.bunnycdn.com") or a service name ("auth", "videos-api") */
  service: string;
  status?: number;
  /** Templated path of the call (ids replaced) */
  route?: string;
}

export interface ErrorJob {
  queue?: string;
  /** Queue message id, job id or cron name */
  id?: string;
  attempt?: number;
}

export interface ErrorContext {
  /** Worker script that served the request (derived on ingest when absent) */
  worker?: string;
  channelId?: string;
  videoId?: string;
  upstream?: ErrorUpstream;
  breadcrumbs?: ErrorBreadcrumb[];
  job?: ErrorJob;
}

export const CONTEXT_LIMITS = { breadcrumbs: 12, breadcrumbMessage: 160 } as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NAME = /^[A-Za-z0-9._:/@-]{1,100}$/;

const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : undefined);
const name = (v: unknown) => (typeof v === 'string' && NAME.test(v) ? v : undefined);
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);

function compact<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

/** Validates and scrubs an untrusted context. Undefined when nothing usable is left. */
export function scrubContext(raw: unknown): ErrorContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const up = c.upstream && typeof c.upstream === 'object' ? (c.upstream as Record<string, unknown>) : null;
  const job = c.job && typeof c.job === 'object' ? (c.job as Record<string, unknown>) : null;
  const crumbs = Array.isArray(c.breadcrumbs)
    ? c.breadcrumbs
        .slice(-CONTEXT_LIMITS.breadcrumbs)
        .map((b): ErrorBreadcrumb | null => {
          if (!b || typeof b !== 'object') return null;
          const x = b as Record<string, unknown>;
          const message = scrubText(typeof x.message === 'string' ? x.message : '', CONTEXT_LIMITS.breadcrumbMessage);
          const at = typeof x.at === 'string' && !Number.isNaN(Date.parse(x.at)) ? new Date(x.at).toISOString() : undefined;
          const kind = typeof x.kind === 'string' && /^[a-z][a-z0-9-]{0,19}$/.test(x.kind) ? x.kind : 'step';
          return message && at ? { at, kind, message } : null;
        })
        .filter((b): b is ErrorBreadcrumb => !!b)
    : [];
  return compact<ErrorContext>({
    worker: name(c.worker),
    channelId: id(c.channelId),
    videoId: id(c.videoId),
    upstream: up
      ? compact<ErrorUpstream>({
          service: name(up.service) ?? '',
          status: int(up.status, 999),
          route: typeof up.route === 'string' ? scrubUrl(up.route, 160).split('?')[0] || undefined : undefined,
        })
      : undefined,
    breadcrumbs: crumbs.length ? crumbs : undefined,
    job: job ? compact<ErrorJob>({ queue: name(job.queue), id: name(job.id), attempt: int(job.attempt, 1000) }) : undefined,
  }) as ErrorContext | undefined;
}

/** Drops an upstream without a service (scrubContext leaves service '' when it was invalid). */
export function finishContext(c: ErrorContext | undefined): ErrorContext | undefined {
  if (!c) return undefined;
  if (c.upstream && !c.upstream.service) delete c.upstream;
  return Object.keys(c).length ? c : undefined;
}

/**
 * Video and channel ids named in a request path: /api/videos/<id>, /video/<id>,
 * /shorts/<id>, /embed/<id>, /api/channels/<id>, /channel/<id>. Ids only.
 */
export function idsFromRoute(route: string | undefined): Pick<ErrorContext, 'videoId' | 'channelId'> {
  if (!route) return {};
  const path = route.split(/[?#]/)[0] ?? '';
  const video = /\/(?:api\/)?(?:videos?|watch|shorts|embed|live)\/([A-Za-z0-9_-]{6,64})(?:\/|$)/.exec(path)?.[1];
  const channel = /\/(?:api\/)?(?:channels?|studio\/channels?)\/([A-Za-z0-9_-]{6,64})(?:\/|$)/.exec(path)?.[1];
  const notWord = (v: string | undefined) => (v && !/^(upload|bulk|search|mine|status|initiate|me|new)$/.test(v) ? v : undefined);
  return compact({ videoId: notWord(video), channelId: notWord(channel) }) ?? {};
}

/** Worker script name of an app in an environment (deployed names, apps/* wrangler configs). */
export function workerNameFor(app: string, environment: string | undefined): string | undefined {
  const env = environment === 'production' ? '' : environment === 'stage' ? '-stage' : environment === 'qa' ? '-qa' : null;
  if (env === null) return undefined;
  const base: Record<string, string> = {
    web: environment === 'production' ? 'al-ummah-now-production' : environment === 'stage' ? 'al-ummah-now-stage' : 'al-ummah-web',
    'admin-web': 'al-ummah-admin-web',
    'api-videos': 'videos',
    'admin-api': 'al-ummah-admin-api',
    processor: 'al-ummah-now-processor',
    scheduler: 'al-ummah-scheduler',
    websocket: 'al-ummah-now-comms',
    'cost-monitor': 'al-ummah-cost-monitor',
    'short-links': 'al-ummah-now-short-links',
    status: 'al-ummah-status',
    auth: 'al-ummah-now-auth',
  };
  const b = base[app];
  if (!b) return undefined;
  return app === 'web' && environment !== 'qa' ? b : `${b}${env}`;
}

/** The job of a queue batch: its queue, first message id and highest attempt. */
export function batchJob(batch: { queue?: string; messages: readonly { id?: string; attempts?: number }[] }): ErrorJob {
  const attempts = batch.messages.map((m) => (typeof m.attempts === 'number' ? m.attempts : 0));
  const job: ErrorJob = {};
  if (batch.queue) job.queue = batch.queue;
  const first = batch.messages[0]?.id;
  if (first) job.id = first;
  if (attempts.length) job.attempt = Math.max(...attempts);
  return job;
}
