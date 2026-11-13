/**
 * Error reporting (videos admin "Errors" page). Every app reports what went
 * wrong to admin-api POST /internal/errors; admin-api groups the events by
 * fingerprint in its D1 (REPORTS_DB) and admin-web lists the groups.
 *
 * Users never see raw errors: they see a friendly page with a short reference
 * (ERR-XXXX-XXXX) that is stored with the event, so support can find it.
 */

/** Apps that report errors (admin "App" filter). */
export const ERROR_APPS = ['web', 'admin-web', 'api-videos', 'admin-api', 'processor', 'scheduler', 'websocket', 'cost-monitor', 'short-links', 'auth', 'status'] as const;
export type ErrorApp = (typeof ERROR_APPS)[number];

/**
 * What kind of failure an event is.
 * - boundary: a React error boundary caught a render error (the user saw the error page)
 * - unhandled: window "error" / an uncaught exception in a Worker
 * - rejection: an unhandled promise rejection
 * - chunk: a script chunk failed to load (ChunkLoadError)
 * - skew: the page and the server are on different deployments (failed server action, missing chunk after a deploy)
 * - fetch: a request to our API failed (network error or 5xx) where the UI handled it
 * - http: a Worker answered 5xx
 * - player / upload: reported by the video player overlay and the upload flow
 * - action: a "needs action" item (failed job, dead-lettered message, email not sent, AI step failed,
 *   admin job failed): listed on the Errors page with a link to the item and, when given, a Retry button
 */
export const ERROR_KINDS = ['boundary', 'unhandled', 'rejection', 'chunk', 'skew', 'fetch', 'http', 'player', 'upload', 'action', 'caught'] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Admin workflow status of a group. */
export const ERROR_STATUSES = ['new', 'acknowledged', 'resolved', 'ignored'] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

/** One occurrence as sent by a reporter (client or server). Everything here is scrubbed again on ingest. */
export interface ErrorEventInput {
  app: ErrorApp;
  kind: ErrorKind;
  /** Reference shown to the user (ERR-XXXX-XXXX); also identifies the event. */
  ref: string;
  /** Error class name: TypeError, ChunkLoadError, ... */
  name?: string;
  message: string;
  stack?: string;
  /** Path the error happened on (ids are normalised on ingest). */
  route?: string;
  method?: string;
  /** HTTP status for kind "http" / "fetch". */
  status?: number;
  /** Build of the app (git sha baked at build time). */
  release?: string;
  /** Cloudflare Worker version id that served the page or request. */
  workerVersion?: string;
  environment?: string;
  locale?: string;
  theme?: string;
  /** Signed-in account id (usr_...). Anything else is dropped on ingest. */
  userId?: string;
  /** cf-ray / X-Request-Id of the failed request. */
  requestId?: string;
  /** ISO time it happened (defaults to the time it was received). */
  occurredAt?: string;
  /** Occurrences folded into this event by the reporter's dedupe (default 1). */
  count?: number;
  /** True when the user was shown an error screen with this reference (never sampled out). */
  shown?: boolean;
  /** True for the release E2E's controlled errors: never alerts. */
  test?: boolean;
  /** Small, non-personal context (component, upload phase, player error code, ...). */
  extra?: Record<string, string | number | boolean | null>;
  /** Set for kind "action": the item that needs an admin. */
  action?: NeedsActionInput;
}

/** Where a needs-action item comes from (Errors page "Source" column). */
export const NEEDS_ACTION_SOURCES = ['queue', 'dlq', 'processing', 'email', 'ai', 'admin-job', 'scheduler', 'upload', 'ops', 'status', 'other'] as const;
export type NeedsActionSource = (typeof NEEDS_ACTION_SOURCES)[number];

/**
 * What the Retry button does. Only admin-api runs it, and only what it is
 * built to run (admin-api src/lib/errors-actions.ts):
 * - builtin: a handler in admin-api (e.g. "contact-email" re-sends a contact message's mail)
 * - service: POST to an allowlisted path of a Worker admin-api has a service binding to,
 *   with the internal API key (e.g. processor /dlq/replay)
 * Retry specs sent from a browser are dropped.
 */
export type NeedsActionRetry =
  | { kind: 'builtin'; handler: string; args?: Record<string, string> }
  | { kind: 'service'; service: string; path: string; body?: Record<string, unknown> };

export interface NeedsActionInput {
  /** Stable id of the item, e.g. "dlq:<message id>" or "contact-email:<message id>". The same key updates one item. */
  key: string;
  source: NeedsActionSource;
  /** Short admin-facing title: "Video processing stalled", "Contact acknowledgement not sent". */
  title: string;
  itemType?: string;
  itemId?: string;
  /** Link to the item: an admin-web path ("/contact/abc") or an https URL on alummahnow.net. */
  itemUrl?: string;
  retry?: NeedsActionRetry;
  /** Retry button label (default "Retry"). */
  retryLabel?: string;
}

export const NEEDS_ACTION_STATUSES = ['open', 'retrying', 'resolved', 'dismissed'] as const;
export type NeedsActionStatus = (typeof NEEDS_ACTION_STATUSES)[number];

/** Body of POST /internal/errors (and of the apps' same-origin /api/errors routes). */
export interface ErrorReportBatch {
  events?: ErrorEventInput[];
  /** Needs-action items the feature fixed itself (by key): marked resolved. */
  resolved?: { key: string }[];
}

export const ERROR_LIMITS = {
  maxEventsPerBatch: 20,
  maxBodyBytes: 64 * 1024,
  messageMax: 1000,
  stackMax: 8000,
  routeMax: 300,
  extraKeys: 12,
  extraValueMax: 200,
} as const;
