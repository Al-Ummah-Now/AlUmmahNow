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
  objects: Array<{ key: string }>;
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: R2PutOptions) => Promise<void>;
  get: (key: string) => Promise<R2Object | null>;
  list: (options?: R2ListOptions) => Promise<R2Objects>;
}

// D1 types are imported from @al-ummah/shared-types above

export interface QueueEnvironment {
  MESSAGE_QUEUE: {
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  DLQ?: { // Optional - might not be configured in all environments
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  MESSAGES_BUCKET: R2Bucket;
  community_posts: R2Bucket;
  REPORTS_DB: D1Database;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
}