'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChannelAuditEntry } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { loadTeamActivity } from '@/lib/channels/team';
import type { AppTranslations } from '@/lib/i18n';
import { relativeTime } from '@/lib/notifications/render';

const DELETED_USER_ID = 'deleted-user';

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/** One activity row in the reader's language; role codes become role names. */
export function activityLine(entry: ChannelAuditEntry, t: AppTranslations): string {
  const tr = t.channelRoles;
  const person = (id: string | undefined, name: string | undefined) =>
    id === DELETED_USER_ID ? tr.deletedAccount : name || tr.someone;
  const params = {
    actor: person(entry.actorId, entry.actorName),
    target: person(entry.targetUserId, entry.targetName),
    role: entry.newRole ? tr.roles[entry.newRole] : '',
    oldRole: entry.oldRole ? tr.roles[entry.oldRole] : '',
  };
  // An email invitation has no target account: the address is never shown in the log
  const key = entry.action === 'invite_sent' && !entry.targetUserId ? 'invite_sent_email' : entry.action;
  return fill(tr.activity[key as keyof typeof tr.activity] ?? tr.activity.channel_edited, params);
}

const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

/** The Team page's Activity tab: newest first, "Show more" pages with the cursor. */
export default function TeamActivity({ channelId }: { channelId: string }) {
  const { t, lang } = useLanguage();
  const tr = t.channelRoles;
  const [entries, setEntries] = useState<ChannelAuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (from: string | null) => {
    setLoading(true);
    setError(false);
    try {
      const page = await loadTeamActivity(channelId, from);
      setEntries((prev) => (from && prev ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(null); }, [load]);

  return (
    <section className="c p-4 sm:p-6" aria-labelledby="team-activity-title" data-testid="team-activity">
      <h2 id="team-activity-title" className="mb-4 text-lg font-semibold text-[var(--fanous-color-text-primary)]">{tr.tabActivity}</h2>
      {entries && entries.length > 0 && (
        <ol className="divide-y divide-[var(--fanous-color-divider)]" data-testid="team-activity-list">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3" data-testid="team-activity-entry" data-action={entry.action}>
              <span className="min-w-0 text-sm text-[var(--fanous-color-text-primary)]" dir="auto">{activityLine(entry, t)}</span>
              <time dateTime={entry.createdAt} className="shrink-0 text-xs text-[var(--fanous-color-text-muted)]">{relativeTime(entry.createdAt, t, lang)}</time>
            </li>
          ))}
        </ol>
      )}
      {entries && entries.length === 0 && !loading && <p className="text-sm text-[var(--fanous-color-text-secondary)]">{tr.noActivity}</p>}
      {loading && <p className="mt-2 text-sm text-[var(--fanous-color-text-secondary)]" role="status">{tr.activityLoading}</p>}
      {error && (
        <div className="mt-2 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-[var(--fanous-color-error-text)]">{tr.errors.loadFailed}</p>
          <button type="button" onClick={() => void load(entries?.length ? cursor : null)} className={`${BUTTON} b-primary`}>{t.common.retry}</button>
        </div>
      )}
      {cursor && !loading && !error && (
        <button type="button" onClick={() => void load(cursor)} className={`${BUTTON} b-secondary mt-3`} data-testid="team-activity-more">{tr.loadMore}</button>
      )}
    </section>
  );
}
