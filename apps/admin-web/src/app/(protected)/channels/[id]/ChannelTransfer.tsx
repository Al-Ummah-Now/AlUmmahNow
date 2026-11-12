'use client';

/**
 * Transfer a channel's ownership (super admins only; admin-api checks it too).
 *
 * The admin finds the new owner with the user picker (email, name, @handle or
 * id), confirms in the app's own dialog by typing the channel's @handle or the
 * new owner's email, and then follows the queued job here until it succeeds
 * (the page refreshes and shows the new owner) or fails (its error is shown).
 * Outcomes are shown in this section, next to the button that caused them.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminJob, AdminUserSearchItem } from '@/lib/api/content-types';
import { readJob, searchTransferCandidates, transferChannel } from '@/lib/api/content';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { JobStatusChip } from '@/components/content/jobs';
import { SectionCard } from '@/components/content/parts';
import { UserPicker } from '@/components/content/UserPicker';
import { bidiIsolate, transferConfirmValues, userName } from '@/components/content/userPickerModel';
import { logger } from '@/lib/logger-client';
import { useAdminLive } from '@/lib/live/useAdminLive';

/** How often the started transfer's job is re-read while the live socket is down, and how long it is followed at most. */
const POLL_MS = 2000;
const POLL_LIMIT_MS = 5 * 60 * 1000;

interface Props {
  channel: { id: string; name: string; handle: string | null; ownerId: string | null; videos: number; playlists: number };
}

interface Followed {
  job: AdminJob;
  to: AdminUserSearchItem;
  /** The job could not be read (still queued as far as we know). */
  unknown?: boolean;
}

const done = (job: AdminJob) => job.status === 'succeeded' || job.status === 'failed';

export function ChannelTransfer({ channel }: Props) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { run, busy, error, message, setError } = useContentAction();
  const [target, setTarget] = useState<AdminUserSearchItem | null>(null);
  const [followed, setFollowed] = useState<Followed | null>(null);

  const search = useCallback(
    (q: string) => searchTransferCandidates(channel.id, q, channel.ownerId ? [channel.ownerId] : []),
    [channel.id, channel.ownerId],
  );

  // Follow the started job until it finishes, then show the new owner: re-read
  // it when admin:jobs says it changed (polled only while the live socket is down)
  const jobId = followed && !done(followed.job) ? followed.job.id : null;
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  const readFollowed = useCallback(async () => {
    if (!jobId) return;
    const result = await readJob(jobId).catch(() => null);
    if (!result?.ok) {
      logger.warn('[ChannelTransfer] Job status read failed', { jobId, status: result?.status });
      setFollowed((f) => (f && f.job.id === jobId ? { ...f, unknown: true } : f));
      return;
    }
    setFollowed((f) => (f && f.job.id === jobId ? { ...f, job: result.data, unknown: false } : f));
    if (done(result.data)) {
      if (result.data.status === 'failed') logger.warn('[ChannelTransfer] Transfer job failed', { jobId, error: result.data.lastError });
      router.refresh();
    }
  }, [jobId, router]);
  useAdminLive(
    ['jobs'],
    (update) => {
      if (update.resync || update.events.some((e) => e.id === jobId)) void readFollowed();
    },
    { poll: () => void readFollowed(), pollMs: POLL_MS, enabled: !!jobId && gaveUp !== jobId, catchUpOnFirstLive: true },
  );
  useEffect(() => {
    if (!jobId) return;
    const timer = window.setTimeout(() => {
      setGaveUp(jobId);
      setFollowed((f) => (f ? { ...f, unknown: true } : f));
    }, POLL_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [jobId]);

  async function confirm() {
    if (!target) {
      setError(t('channels.transferPickFirst'));
      return;
    }
    const to = target;
    const result = await run('transfer', () => transferChannel(channel.id, to.id));
    if (result?.job) {
      setFollowed({ job: result.job, to });
      setTarget(null);
    }
  }

  const name = target ? userName(target) : '';
  const email = target?.email ?? '';
  const confirmValues = target ? transferConfirmValues(channel.handle, target.email) : [];
  const iso = (value: string) => bidiIsolate(value, locale);

  return (
    <SectionCard title={t('channels.transferTitle')} id={`${ids}-transfer`} testId="channel-transfer">
      <p className="text-sm text-fg-muted mb-3">{t('channels.transferHint')}</p>
      <ActionFeedback error={error} message={message} testId="channel-transfer-feedback" />
      {followed && <TransferStatus followed={followed} />}
      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="flex-1 min-w-0">
          <UserPicker
            label={t('channels.newOwner')}
            hint={t('channels.newOwnerHint')}
            search={search}
            value={target}
            onChange={(user) => {
              setTarget(user);
              setError(null);
            }}
            disabled={!!busy}
            testId="channel-transfer-owner"
          />
        </div>
        <div className="sm:mb-5">
          <ConfirmButton
            label={t('channels.transfer')}
            title={t('channels.transferConfirm', { name: iso(name), email: email ? iso(email) : t('channels.pickerNoEmail') })}
            body={t('channels.transferBody', {
              channel: iso(channel.name || channel.id),
              name: iso(name),
              videos: formatNumber(channel.videos, locale),
              playlists: formatNumber(channel.playlists, locale),
            })}
            confirmLabel={t('channels.transfer')}
            typeToConfirm={confirmValues}
            typeToConfirmLabel={
              channel.handle
                ? t('channels.transferTypeToConfirm', { handle: iso(`@${channel.handle}`), email: email ? iso(email) : t('channels.pickerNoEmail') })
                : t('channels.transferTypeToConfirmNoHandle', { email: iso(email) })
            }
            danger
            disabled={!!busy || !target || confirmValues.length === 0}
            busy={busy === 'transfer'}
            testId="channel-transfer-submit"
            onConfirm={confirm}
          />
        </div>
      </div>
    </SectionCard>
  );
}

function TransferStatus({ followed }: { followed: Followed }) {
  const { t, locale } = useLanguage();
  const { job, to, unknown } = followed;
  const result = (job.result ?? {}) as { videos?: number; playlists?: number };
  const key = (unknown && !done(job) ? 'channels.transferStatus.unknown' : `channels.transferStatus.${job.status}`) as MessageKey;
  const text = t(key, {
    name: userName(to),
    error: job.lastError || t('content.none'),
    videos: formatNumber(Number(result.videos) || 0, locale),
    playlists: formatNumber(Number(result.playlists) || 0, locale),
  });
  const tone = job.status === 'failed' ? 'border-danger-border bg-danger-bg text-danger-fg' : job.status === 'succeeded' ? 'border-border bg-surface-2 text-success-fg' : 'border-border bg-surface-2 text-fg';
  return (
    <div
      role={job.status === 'failed' ? 'alert' : 'status'}
      aria-live="polite"
      className={`mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm ${tone}`}
      data-testid="channel-transfer-status"
      data-status={job.status}
      data-job-id={job.id}
    >
      <JobStatusChip job={job} />
      <span dir="auto">{text}</span>
    </div>
  );
}
