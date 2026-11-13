/**
 * The archive copy of a queue message (#1177): person ids pseudonymised, free text dropped
 * (@al-ummah/shared-types archive-privacy), stamped with the privacy version. Erasure messages
 * archive the erased marker, never the id they erase.
 */
import { ARCHIVE_PRIVACY_VERSION, collectArchiveUserIds, scrubArchiveRecord } from '@al-ummah/shared-types';
import { archivePseudonyms } from '../erasure/archive-subjects';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';

const ERASURE_TYPES = new Set<MessageType>([MessageType.UserDataErased, MessageType.ContactDataErase]);

export async function archiveRecord<T extends Record<string, unknown>>(
  message: AlUmmahMessage,
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB'>,
  extra: T
): Promise<Record<string, unknown>> {
  const record = { ...message, ...extra };
  const erased = ERASURE_TYPES.has(message.type);
  const pseudonyms = erased ? new Map<string, string>() : await archivePseudonyms(env.NOTIFICATIONS_DB, collectArchiveUserIds(record));
  return { ...scrubArchiveRecord(record, { pseudonyms, erased }), privacy: ARCHIVE_PRIVACY_VERSION };
}
