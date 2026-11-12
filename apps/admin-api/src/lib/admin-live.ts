/**
 * Live updates for the videos admin (docs/admin/LIVE_OPS.md Part B): hints on
 * admin:<topic> channels that make open admin pages refetch. Never throws and
 * never delays the response (runs in waitUntil when there is a request).
 */
import { publishAdminLive, type AdminLiveEnv, type AdminLiveEvent, type AdminLiveTopic } from '@al-ummah/shared-types';
import type { IngestOutcome } from './errors-store';

interface ContextLike {
  env: unknown;
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
}

/** Publishes from a request: after the response, inside waitUntil. */
export function publishAdminLiveInBackground(c: ContextLike, topic: AdminLiveTopic, events: AdminLiveEvent | AdminLiveEvent[]): void {
  const task = publishAdminLive(c.env as AdminLiveEnv, topic, events);
  try {
    c.executionCtx?.waitUntil(task);
  } catch {
    // app.request() in tests and the Node dev server have no execution context; the task still runs
  }
}

/** admin:errors events of an ingest: one per new (non-test) group, then a refresh hint. */
export function errorLiveEvents(outcome: Pick<IngestOutcome, 'accepted' | 'created' | 'reopened'>, resolved: number): AdminLiveEvent[] {
  const events: AdminLiveEvent[] = outcome.created
    .filter((g) => !g.test)
    .map((g) => ({ kind: 'error', key: `group:${g.id}`, groupId: g.id, isNew: true, errorKind: g.kind, app: g.app, environment: g.environment }));
  if (outcome.accepted > 0 || outcome.reopened.length > 0 || resolved > 0) events.push({ kind: 'changed', key: 'changed' });
  return events;
}
