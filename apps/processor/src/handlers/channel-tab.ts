import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { archiveRecord } from '../lib/archive-record';
import { ARCHIVE_PRIVACY_VERSION } from '@al-ummah/shared-types';

// Interface for channel tab payloads
interface ChannelTabPayload {
  channelId: string;
  tabId: string;
  userId: string;
  tabType?: string;
  tabName?: string;
  position?: number;
  isDefault?: boolean;
  previousTabId?: string;
  sessionDuration?: number;
  metadata?: Record<string, unknown>;
}

export async function handleChannelTabEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing channel tab message: ${MessageType[message.type]}`, message.payload);

  const payload = message.payload as unknown as ChannelTabPayload;
  const { channelId, tabId, userId, tabType, tabName, position, isDefault } = payload;

  // Validate required fields
  if (!channelId || !tabId || !userId) {
    throw new Error('Channel tab message missing required fields: channelId, tabId, userId');
  }

  // Save to R2 with structured path for analytics
  await saveChannelTabAnalytics(message, env, logger);

  // Process specific channel tab events
  switch (message.type) {
    case MessageType.ChannelTabCreate:
      logger.debug(`Channel tab ${tabId} created for channel ${channelId} by user ${userId}`, {
        tabType,
        tabName,
        position,
        isDefault,
      });
      // Track tab creation metrics
      await trackTabCreation(payload, env, logger);
      break;

    case MessageType.ChannelTabUpdate:
      logger.debug(`Channel tab ${tabId} updated for channel ${channelId} by user ${userId}`, {
        tabType,
        tabName,
        position,
      });
      // Track tab update patterns
      await trackTabUpdate(payload, env, logger);
      break;

    case MessageType.ChannelTabDelete:
      logger.debug(`Channel tab ${tabId} deleted from channel ${channelId} by user ${userId}`);
      // Track tab deletion analytics
      await trackTabDeletion(payload, env, logger);
      break;

    case MessageType.ChannelTabReorder:
      logger.debug(`Channel tabs reordered for channel ${channelId} by user ${userId}`, {
        position,
      });
      // Track reordering patterns
      await trackTabReorder(payload, env, logger);
      break;

    case MessageType.ChannelTabSwitch:
      logger.debug(`User ${userId} switched to tab ${tabId} on channel ${channelId}`, {
        tabType,
        tabName,
        previousTabId: payload.previousTabId,
        sessionDuration: payload.sessionDuration,
      });
      // Track tab switching behavior and popular tabs
      await trackTabSwitch(payload, env, logger);
      break;

    default:
      logger.warn(`Unexpected channel tab message type: ${message.type}`);
  }
}

async function saveChannelTabAnalytics(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  try {
    const messageDate = new Date(message.timestamp);
    const year = messageDate.getUTCFullYear();
    const month = String(messageDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(messageDate.getUTCDate()).padStart(2, '0');
    const timestamp = messageDate.getTime();

    // Create structured key for channel tab analytics
    const key = `channel-tabs/${year}/${month}/${day}/${timestamp}-${message.id}.json`;

    // Analytics metadata; person ids pseudonymised like the main archive (#1177)
    const enhancedMessage = await archiveRecord(message, env, {
      typeName: MessageType[message.type],
      timestampISO: messageDate.toISOString(),
      analytics: {
        category: 'channel_tabs',
        eventType: MessageType[message.type],
      },
    });

    // Save to R2
    await env.MESSAGES_BUCKET.put(key, JSON.stringify(enhancedMessage, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        messageType: MessageType[message.type],
        messageId: message.id,
        privacy: ARCHIVE_PRIVACY_VERSION,
        channelId: (message.payload as unknown as ChannelTabPayload).channelId,
        tabId: (message.payload as unknown as ChannelTabPayload).tabId,
      },
    });

    logger.debug(`Channel tab analytics saved to R2 with key: ${key}`);
  } catch (error) {
    logger.error(`Failed to save channel tab analytics for message ${message.id}`, error);
    throw new Error(`R2 save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function trackTabCreation(
  payload: ChannelTabPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track metrics for tab creation
  const metrics = {
    channelId: payload.channelId,
    tabId: payload.tabId,
    tabType: payload.tabType,
    tabName: payload.tabName,
    position: payload.position,
    isDefault: payload.isDefault,
    timestamp: new Date().toISOString(),
    event: 'tab_created',
  };

  const key = `analytics/tabs/creation/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Tab creation metrics tracked for channel ${payload.channelId}`);
}

async function trackTabUpdate(
  payload: ChannelTabPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track update patterns
  const metrics = {
    channelId: payload.channelId,
    tabId: payload.tabId,
    tabType: payload.tabType,
    tabName: payload.tabName,
    timestamp: new Date().toISOString(),
    event: 'tab_updated',
  };

  const key = `analytics/tabs/updates/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Tab update metrics tracked for tab ${payload.tabId}`);
}

async function trackTabDeletion(
  payload: ChannelTabPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track deletion metrics
  const metrics = {
    channelId: payload.channelId,
    tabId: payload.tabId,
    timestamp: new Date().toISOString(),
    event: 'tab_deleted',
  };

  const key = `analytics/tabs/deletions/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Tab deletion tracked for tab ${payload.tabId}`);
}

async function trackTabReorder(
  payload: ChannelTabPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track reordering patterns
  const metrics = {
    channelId: payload.channelId,
    tabId: payload.tabId,
    newPosition: payload.position,
    timestamp: new Date().toISOString(),
    event: 'tabs_reordered',
  };

  const key = `analytics/tabs/reorders/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Tab reorder tracked for channel ${payload.channelId}`);
}

async function trackTabSwitch(
  payload: ChannelTabPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track tab switching behavior and engagement metrics
  const metrics = {
    channelId: payload.channelId,
    tabId: payload.tabId,
    tabType: payload.tabType,
    tabName: payload.tabName,
    previousTabId: payload.previousTabId,
    sessionDuration: payload.sessionDuration, // Time spent on previous tab
    timestamp: new Date().toISOString(),
    event: 'tab_switched',
  };

  // Store in multiple paths for different analytics queries

  // 1. Track by channel and tab for popularity analysis
  const popularityKey = `analytics/tabs/popularity/${payload.channelId}/${payload.tabId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(popularityKey, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  // No per-user copy: the archive keeps no metric keyed by a person (#1177)

  // 3. Track session duration analytics if provided
  if (payload.sessionDuration && payload.previousTabId) {
    const sessionMetrics = {
      channelId: payload.channelId,
      tabId: payload.previousTabId,
      duration: payload.sessionDuration,
      timestamp: new Date().toISOString(),
      event: 'tab_session_ended',
    };

    const sessionKey = `analytics/tabs/sessions/${payload.channelId}/${payload.previousTabId}/${Date.now()}.json`;
    await env.MESSAGES_BUCKET.put(sessionKey, JSON.stringify(sessionMetrics), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  logger.debug(`Tab switch tracked for tab ${payload.tabId} on channel ${payload.channelId}`);
}