// Import shared types from @al-ummah/shared-types
import {
  MessageType,
  ProcessingResult,
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
} from '@al-ummah/shared-types';

// Re-export for use throughout processor
export { MessageType };
export type {
  ProcessingResult,
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
};

// Processor-specific message type (based on shared QueueMessage)
export interface AlUmmahMessage {
  id: string;
  type: MessageType;
  timestamp: number | string; // API sends number (Date.now()), allow both for flexibility
  payload: Record<string, unknown>;
  retryCount?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  failureReason?: string;
  failedAt?: string;
}

export interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2Object {
  key: string;
  body: ReadableStream;
  bodyUsed: boolean;
  json: <T = unknown>() => Promise<T>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface R2ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface R2Objects {
  objects: Array<{ key: string; uploaded?: Date | string }>;
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: R2PutOptions) => Promise<void>;
  get: (key: string) => Promise<R2Object | null>;
  list: (options?: R2ListOptions) => Promise<R2Objects>;
  delete?: (key: string | string[]) => Promise<void>;
}

// D1 types are imported from @al-ummah/shared-types above

export interface QueueEnvironment {
  /** Producer to the processor's own queue (PushDispatch, Epic 9.4). Optional: push is skipped when unbound. */
  MESSAGE_QUEUE?: {
    send: (message: AlUmmahMessage) => Promise<void>;
    /** Up to 100 messages (256 KB) in one subrequest (SCALABILITY-AUDIT PR-7). */
    sendBatch?: (messages: Array<{ body: AlUmmahMessage }>) => Promise<void>;
  };
  DLQ?: { // Optional - might not be configured in all environments
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  MESSAGES_BUCKET: R2Bucket;
  /**
   * Which queue messages are archived to MESSAGES_BUCKET: "all" (default), "client-analytics"
   * (only ClientAnalyticsEvent, whose archive is its only store) or "off". Nothing reads the
   * archive of the other types; QA/stage use "client-analytics" (~180k R2 writes a day on QA).
   */
  MESSAGE_ARCHIVE?: string;
  community_posts: R2Bucket;
  REPORTS_DB: D1Database;
  /** Notification center + library indexes (Epic 29). Optional: features are skipped when unbound. */
  NOTIFICATIONS_DB?: D1Database;
  /** D1 search index shared with api-videos (Story 29.9); optional, sync is skipped when unbound */
  SEARCH_DB?: D1Database;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  /** Base URL of the websocket-server (realtime broadcasts are skipped when unset) */
  WEBSOCKET_URL?: string;
  /** Secrets Store binding (or plain string in local dev) for websocket-server /broadcast */
  INTERNAL_API_KEY?: string | { get: () => Promise<string> };
  /** admin-api error ingest (Errors page): crashes and dead letters are reported there */
  ERRORS_INGEST_URL?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string };
  /** Workers AI binding (Epic 28 moderation). Optional: scans are skipped when unbound. */
  AI?: { run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
  /** Env-level kill switch for AI moderation ("false" = off). */
  AI_MODERATION_ENABLED?: string;
  /** Default daily Workers AI neuron cap for moderation (D1 moderation_config overrides). */
  AI_MODERATION_DAILY_NEURON_CAP?: string;
  /** AI Gateway id; when set every Workers AI call goes through it. */
  AI_GATEWAY_ID?: string;
  /** Video JSON (api-videos' bucket): AI category suggestions read the text and write `category` (src/categorize). */
  videos?: unknown;
  /** Caption WebVTT files (api-videos' bucket), read for category suggestions. */
  subtitles?: unknown;
  /** Env kill switch for AI category suggestions ("false" = off). */
  AI_CATEGORIZE_ENABLED?: string;
  /** Default daily neuron cap for category suggestions (D1 moderation_config 'categorize' overrides). */
  AI_CATEGORIZE_DAILY_NEURON_CAP?: string;
  /** "true" on QA/stage only: E2E texts with [e2e-category:<value>] are answered without a model call. */
  CATEGORY_AI_TEST_HOOK?: string;
}