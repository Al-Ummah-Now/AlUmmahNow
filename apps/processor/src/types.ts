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
}

// Types for our queue messages
export interface AlUmmahMessage {
  id: string;
  type: MessageType;
  timestamp: string;
  data: Record<string, unknown>;
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

export interface QueueEnvironment {
  MESSAGE_QUEUE: {
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  DLQ: {
    send: (message: AlUmmahMessage) => Promise<void>;
  };
  MESSAGES_BUCKET: {
    put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => Promise<void>;
  };
  ENVIRONMENT: string;
  LOG_LEVEL: string;
}