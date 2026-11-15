/**
 * The run's objects in the R2 buckets that keep copies of queue messages: the processor's message
 * archive and the legacy-restore backups. They hold personal data, so they are never allowed
 * through; the local teardown deletes them (cleanup.ts).
 *
 * A message sent in the run's last seconds (a report dismissed as the last spec ends) is archived
 * after the processor's batch, so after the teardown's one sweep: the wait for the erasure deletes
 * these hits from each leftover scan too, by the key the scan found.
 */
export const ARCHIVE_BUCKETS = ['al-ummah-now-messages', 'admin-backups'] as const;

export function archiveHits(hits: { store: string; location: string }[]): { bucket: string; key: string }[] {
  const out = new Map<string, { bucket: string; key: string }>();
  for (const hit of hits) {
    const bucket = ARCHIVE_BUCKETS.find((b) => hit.store === `r2:${b}`);
    if (bucket && hit.location) out.set(`${bucket}/${hit.location}`, { bucket, key: hit.location });
  }
  return [...out.values()];
}
