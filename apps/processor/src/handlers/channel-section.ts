import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { Logger } from '@al-ummah/logger';
import { writeArchiveEntry } from '../erasure/archive-titles';
import { ARCHIVE_PRIVACY_VERSION, ARCHIVE_TITLES_VERSION } from '@al-ummah/shared-types';

// Interface for channel section payloads
interface ChannelSectionPayload {
  channelId: string;
  sectionId: string;
  userId: string;
  sectionType?: string;
  position?: number;
  title?: string;
  videoIds?: string[];
  metadata?: Record<string, unknown>;
}

export async function handleChannelSectionEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  logger.debug(`Processing channel section message: ${MessageType[message.type]}`, message.payload);

  const payload = message.payload as unknown as ChannelSectionPayload;
  const { channelId, sectionId, userId, sectionType, position, title } = payload;

  // Validate required fields. A reorder moves the channel's sections as a whole: api-videos sends
  // { channelId, userId, sectionCount } without a sectionId (every reorder dead-lettered before)
  const isReorder = message.type === MessageType.ChannelSectionReorder;
  if (!channelId || !userId || (!sectionId && !isReorder)) {
    throw new Error('Channel section message missing required fields: channelId, sectionId, userId');
  }

  // Save to R2 with structured path for analytics
  await saveChannelSectionAnalytics(message, env, logger);

  // Process specific channel section events
  switch (message.type) {
    case MessageType.ChannelSectionCreate:
      logger.debug(`Channel section ${sectionId} created for channel ${channelId} by user ${userId}`, {
        sectionType,
        position,
        title,
      });
      // Track section creation metrics
      await trackSectionCreation(payload, env, logger);
      break;

    case MessageType.ChannelSectionUpdate:
      logger.debug(`Channel section ${sectionId} updated for channel ${channelId} by user ${userId}`, {
        sectionType,
        position,
        title,
      });
      // Track section update patterns
      await trackSectionUpdate(payload, env, logger);
      break;

    case MessageType.ChannelSectionDelete:
      logger.debug(`Channel section ${sectionId} deleted from channel ${channelId} by user ${userId}`);
      // Track section deletion analytics
      await trackSectionDeletion(payload, env, logger);
      break;

    case MessageType.ChannelSectionReorder:
      logger.debug(`Channel sections reordered for channel ${channelId} by user ${userId}`, {
        position,
      });
      // Track reordering patterns (which sections are moved most frequently)
      await trackSectionReorder(payload, env, logger);
      break;

    case MessageType.ChannelSectionView:
      logger.debug(`Channel section ${sectionId} viewed on channel ${channelId} by user ${userId}`, {
        sectionType,
      });
      // Track section view metrics for popularity analysis
      await trackSectionView(payload, env, logger);
      break;

    default:
      logger.warn(`Unexpected channel section message type: ${message.type}`);
  }
}

async function saveChannelSectionAnalytics(
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

    // Create structured key for channel section analytics
    const key = `channel-sections/${year}/${month}/${day}/${timestamp}-${message.id}.json`;

    // Analytics metadata; person ids pseudonymised like the main archive (#1177)
    await writeArchiveEntry(
      env,
      key,
      message,
      {
        typeName: MessageType[message.type],
        timestampISO: messageDate.toISOString(),
        analytics: {
          category: 'channel_sections',
          eventType: MessageType[message.type],
        },
      },
      {
        messageType: MessageType[message.type],
        messageId: message.id,
        privacy: ARCHIVE_PRIVACY_VERSION,
        titles: ARCHIVE_TITLES_VERSION,
        channelId: (message.payload as unknown as ChannelSectionPayload).channelId,
        ...((message.payload as unknown as ChannelSectionPayload).sectionId ? { sectionId: (message.payload as unknown as ChannelSectionPayload).sectionId } : {}),
      }
    );

    logger.debug(`Channel section analytics saved to R2 with key: ${key}`);
  } catch (error) {
    logger.error(`Failed to save channel section analytics for message ${message.id}`, error);
    throw new Error(`R2 save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function trackSectionCreation(
  payload: ChannelSectionPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track metrics for section creation
  const metrics = {
    channelId: payload.channelId,
    sectionType: payload.sectionType,
    position: payload.position,
    timestamp: new Date().toISOString(),
    event: 'section_created',
  };

  const key = `analytics/sections/creation/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Section creation metrics tracked for channel ${payload.channelId}`);
}

async function trackSectionUpdate(
  payload: ChannelSectionPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track update patterns
  const metrics = {
    channelId: payload.channelId,
    sectionId: payload.sectionId,
    sectionType: payload.sectionType,
    timestamp: new Date().toISOString(),
    event: 'section_updated',
  };

  const key = `analytics/sections/updates/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Section update metrics tracked for section ${payload.sectionId}`);
}

async function trackSectionDeletion(
  payload: ChannelSectionPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track deletion metrics
  const metrics = {
    channelId: payload.channelId,
    sectionId: payload.sectionId,
    timestamp: new Date().toISOString(),
    event: 'section_deleted',
  };

  const key = `analytics/sections/deletions/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Section deletion tracked for section ${payload.sectionId}`);
}

async function trackSectionReorder(
  payload: ChannelSectionPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track reordering patterns
  const metrics = {
    channelId: payload.channelId,
    sectionId: payload.sectionId,
    newPosition: payload.position,
    timestamp: new Date().toISOString(),
    event: 'sections_reordered',
  };

  const key = `analytics/sections/reorders/${payload.channelId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Section reorder tracked for channel ${payload.channelId}`);
}

async function trackSectionView(
  payload: ChannelSectionPayload,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  // Track view metrics for popularity analysis
  const metrics = {
    channelId: payload.channelId,
    sectionId: payload.sectionId,
    sectionType: payload.sectionType,
    // No viewer id: a count per section is all this metric is for (#1177)
    timestamp: new Date().toISOString(),
    event: 'section_viewed',
  };

  const key = `analytics/sections/views/${payload.channelId}/${payload.sectionId}/${Date.now()}.json`;
  await env.MESSAGES_BUCKET.put(key, JSON.stringify(metrics), {
    httpMetadata: { contentType: 'application/json' },
  });

  logger.debug(`Section view tracked for section ${payload.sectionId}`);
}