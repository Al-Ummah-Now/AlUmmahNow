/**
 * The archive copy of a queue message (#1177): person ids pseudonymised, free text dropped
 * (@al-ummah/shared-types archive-privacy), stamped with the privacy version. Erasure messages
 * archive the erased marker, never the id they erase. Titles of an erased owner's content are
 * placeholders already (#1254, erasure-privacy); the owners' subjects of the other titles come back
 * so the writer can index them (erasure/archive-titles.ts).
 */
import {
  ARCHIVE_ERASED_MARKER,
  ARCHIVE_PRIVACY_VERSION,
  archiveSubjectKey,
  archiveTitleOwnerIds,
  collectArchiveUserIds,
  eraseArchiveTitles,
  scrubArchiveRecord,
} from '@al-ummah/shared-types';
import { archivePseudonyms } from '../erasure/archive-subjects';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';

const ERASURE_TYPES = new Set<MessageType>([MessageType.UserDataErased, MessageType.ContactDataErase, MessageType.ArchiveTitlesErase]);

export interface ArchiveEntry {
  record: Record<string, unknown>;
  /** archive_subjects keys of the (not erased) owners of the titles the record keeps */
  titleSubjects: string[];
}

export async function archiveEntry<T extends Record<string, unknown>>(
  message: AlUmmahMessage,
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB'>,
  extra: T
): Promise<ArchiveEntry> {
  const record = { ...message, ...extra };
  const erased = ERASURE_TYPES.has(message.type);
  const owners = erased ? new Set<string>() : archiveTitleOwnerIds(record);
  const pseudonyms = erased
    ? new Map<string, string>()
    : await archivePseudonyms(env.NOTIFICATIONS_DB, [...collectArchiveUserIds(record), ...owners]);
  let scrubbed = scrubArchiveRecord(record, { pseudonyms, erased });
  const titleSubjects: string[] = [];
  if (owners.size) {
    const live = [...owners].filter((id) => pseudonyms.get(id) !== ARCHIVE_ERASED_MARKER);
    if (live.length < owners.size) scrubbed = eraseArchiveTitles(scrubbed);
    // Indexed only where an erasure can find it: with a secret store bound
    else if (env.NOTIFICATIONS_DB) for (const id of live) titleSubjects.push(await archiveSubjectKey(id));
  }
  return { record: { ...scrubbed, privacy: ARCHIVE_PRIVACY_VERSION }, titleSubjects };
}

export async function archiveRecord<T extends Record<string, unknown>>(
  message: AlUmmahMessage,
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB'>,
  extra: T
): Promise<Record<string, unknown>> {
  return (await archiveEntry(message, env, extra)).record;
}
