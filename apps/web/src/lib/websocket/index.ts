// WebSocket manager and utilities
export { WebSocketManager } from './WebSocketManager';
export { WebSocketProvider, useWebSocket, useWebSocketSubscription } from './WebSocketProvider';

// Export types
export type {
  WebSocketConfig,
  WebSocketConnectionState,
  WebSocketMessage,
  WebSocketEventType,
  CommentEvent,
  LikeEvent,
  ViewCountEvent,
  NotificationEvent,
  PresenceEvent
} from '../../interfaces/websocket';