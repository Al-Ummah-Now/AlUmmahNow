/**
 * WebSocket Message Types
 * Re-exports shared types and adds server-specific validation
 */

import { z } from 'zod';

// Re-export shared message types (using export type for isolatedModules compatibility)
export type {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  NotificationData,
  NotificationType,
  ChatMessage,
  WebSocketChannelType,
  PublishEvent,
  PublishEventType,
  ConnectionStatus,
  ConnectionState,
} from '@al-ummah/shared-types';

// Type alias for backwards compatibility
export type { WebSocketChannelType as ChannelType } from '@al-ummah/shared-types';

// Zod schema for validating client messages (server-side only)
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal('subscribe'),
    channel: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    channel: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('message'),
    channel: z.string().min(1).max(100),
    data: z.any(),
  }),
  z.object({
    type: z.literal('ping'),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('heartbeat'),
    timestamp: z.number(),
  }),
]);
