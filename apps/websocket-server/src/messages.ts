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

export const ChannelSchema = z.string().max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*(?::[A-Za-z0-9][A-Za-z0-9_.-]*)*$/);

export const MAX_BROADCAST_ITEMS = 1000;
const BroadcastItemSchema = z.object({ channel: ChannelSchema, message: z.unknown().refine(Boolean) });
export const BroadcastBatchSchema = z.array(BroadcastItemSchema).min(1).max(MAX_BROADCAST_ITEMS);

export function parseBroadcastItems(body: unknown) {
  if (body && typeof body === 'object' && 'items' in body) return BroadcastBatchSchema.safeParse(body.items);
  return BroadcastBatchSchema.safeParse([body]);
}

// Zod schema for validating client messages (server-side only)
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),
    token: z.string().min(1).max(16_384),
  }),
  z.object({
    type: z.literal('subscribe'),
    channel: ChannelSchema,
  }),
  z.object({
    type: z.literal('unsubscribe'),
    channel: ChannelSchema,
  }),
  z.object({
    type: z.literal('message'),
    channel: ChannelSchema,
    data: z.unknown().refine((value) => value !== undefined),
  }),
  z.object({
    type: z.literal('ping'),
    timestamp: z.number().finite(),
  }),
  z.object({
    type: z.literal('heartbeat'),
    timestamp: z.number().finite(),
  }),
]);
