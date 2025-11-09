// Message type enum as provided by @meywd
export enum MessageType {
  ProfileCreate,
  ProfileUpdate,
  ProfileDelete,
  ProfileView,
  ChannelCreate,
  ChannelUpdate,
  ChannelDelete,
  ChannelView,
  Subscribe,
  Unsubscribe,
  VideoCreate,
  VideoEdit,
  VideoDelete,
  VideoView,
  VideoLike,
  VideoUnlike,
  VideoDislike,
  VideoUndislike,
  CommentCreate,
  CommentEdit,
  CommentDelete,
  CommentLike,
  CommentDislike,
  CommentUnlike,
  CommentUndislike,
  PlaylistEdit,
  PlaylistDelete,
  PlaylistAdd,
  PlaylistRemove,
  PlaylistCreate,
  PlaylistClone,
  WatchHistory,
}

// Types for our queue messages
export interface AlUmmahMessage {
  id: string;
  type: MessageType;
  timestamp: number | string; // API sends number (Date.now()), allow both
  payload: Record<string, unknown>; // API sends 'payload', not 'data'
  priority?: 'low' | 'normal' | 'high' | 'critical';
  retryCount?: number;
  failureReason?: string;
  failedAt?: string;
}

export interface ProcessingResult {
  success: boolean;
  error?: string;
  shouldRetry?: boolean;
  processedAt: string;
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

export interface QueueEnvironment {
  MESSAGE_QUEUE: {
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  DLQ?: { // Optional - might not be configured in all environments
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  MESSAGES_BUCKET: {
    put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: R2PutOptions) => Promise<void>;
  };
  ENVIRONMENT: string;
  LOG_LEVEL: string;
}