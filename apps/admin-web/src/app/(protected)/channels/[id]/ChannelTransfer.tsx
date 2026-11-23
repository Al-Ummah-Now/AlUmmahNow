'use client';

/**
 * Transfer a channel's ownership (super admins only; admin-api checks it too).
 *
 * The admin finds the new owner with the shared Autocomplete (email, name,
 * @handle or id; the channel's team before anything is typed; the current owner
 * never offered; banned users listed but not choosable), confirms in the app's own dialog by typing the channel's @handle or the
 * new owner's email, and then follows the queued job here until it succeeds
 * (the page refreshes and shows the new owner) or fails (its error is shown).
 * Outcomes are shown in this section, next to the button that caused them.
 */
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminJob, AdminUserSearchItem } from '@/lib/api/content-types';
import { readJob, searchTransferCandidates, transferChannel, type TransferOptions } from '@/lib/api/content';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { JobStatusChip } from '@/components/content/jobs';
import { SectionCard } from '@/components/content/parts';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import type { AutocompleteItem } from '@/components/search/autocomplete-model';
import { bidiIsolate, transferConfirmValues, transferItem, userName } from '@/components/content/transfer-model';
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

const done = (job: AdminJob) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';

export function ChannelTransfer({ channel }: Props) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { run, busy, error, message, setError } = useContentAction();
  const [target, setTarget] = useState<AdminUserSearchItem | null>(null);
  const [followed, setFollowed] = useState<Followed | null>(null);
  const [options, setOptions] = useState<TransferOptions>(NO_OPTIONS);

  // The transfer's own search (super admins only): the current owner left out, each user with
  // their channel count and role here; the full rows are kept for the confirm dialog
  const found = useRef(new Map<string, AdminUserSearchItem>());
  const source = useCallback<AutocompleteSource>(
    async (q) => {
      const result = await searchTransferCandidates(channel.id, q, channel.ownerId ? [channel.ownerId] : []);
      if (!result.ok) {
        logger.warn('[ChannelTransfer] Search failed', { status: result.status, code: result.code });
        throw new Error(`Transfer search answered ${result.status}`);
      }
      for (const user of result.data.items) found.current.set(user.id, user);
      return { items: result.data.items.map((user): AutocompleteItem => transferItem(user, t)), next: null };
    },
    [channel.id, channel.ownerId, t],
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

  async function confirm(reason: string) {
    if (!target) {
      setError(t('channels.transferPickFirst'));
      return;
    }
    const to = target;
    const result = await run('transfer', () => transferChannel(channel.id, to.id, reason, options));
    if (result?.job) {
      setFollowed({ job: result.job, to });
      setTarget(null);
      setOptions(NO_OPTIONS);
    }
  }

  // What the move changes besides the owner, in the dialog's own words (§3.4, §3.5)
  const consequences = [
    t(options.keepPreviousOwnerAsAdmin ? 'channels.transferKeepsOldOwner' : 'channels.transferOldOwnerLoses'),
    ...(options.keepContactEmail ? [] : [t('channels.transferClearsContact')]),
    t('channels.transferLiveKeys'),
  ];
  const toggle = (key: keyof TransferOptions) => (e: ChangeEvent<HTMLInputElement>) => setOptions((o) => ({ ...o, [key]: e.target.checked }));

  const name = target ? userName(target) : '';
  const email = target?.email ?? '';
  const confirmValues = target ? transferConfirmValues(channel.handle, target.email) : [];
  const iso = (value: string) => bidiIsolate(value, locale);

  return (
    <SectionCard title={t('channels.transferTitle')} id={`${ids}-transfer`} testId="channel-transfer">
      <p className="text-sm text-fg-muted mb-3">{t('channels.transferHint')}</p>
      <ActionFeedback error={error} message={message} testId="channel-transfer-feedback" />
      {followed && <TransferStatus followed={followed} />}
      <div className="flex flex-col items-start gap-3">
        <div className="w-full min-w-0">
          <Autocomplete
            // A started transfer empties the box for the next one
            key={followed?.job.id ?? 'new'}
            kind="user"
            mode="pick"
            label={t('channels.newOwner')}
            hint={t('channels.newOwnerHint')}
            placeholder={t('channels.newOwnerPlaceholder')}
            source={source}
            allowIds={false}
            showIds={false}
            chosen="card"
            changeLabel={t('channels.pickerChange')}
            showStatus
            messages={{
              recent: (count) => t('channels.pickerTeam', { count }),
              emptyList: t('channels.pickerNoTeam'),
              noMatches: (query) => t('channels.pickerEmpty', { query }),
              count: (count) => (count === 1 ? t('channels.pickerResultsOne') : t('channels.pickerResults', { count })),
            }}
            onChange={(id) => {
              setTarget(id ? (found.current.get(id) ?? null) : null);
              setError(null);
            }}
            disabled={!!busy}
            testId="channel-transfer-owner"
          />
        </div>
        <fieldset className="flex flex-col gap-2" disabled={!!busy}>
          <legend className="text-sm text-fg-muted mb-1">{t('channels.transferOptions')}</legend>
          <TransferOption id={`${ids}-keep-admin`} checked={options.keepPreviousOwnerAsAdmin} onChange={toggle('keepPreviousOwnerAsAdmin')} label={t('channels.transferKeepOldOwner')} testId="channel-transfer-keep-admin" />
          <TransferOption id={`${ids}-keep-contact`} checked={options.keepContactEmail} onChange={toggle('keepContactEmail')} label={t('channels.transferKeepContact')} testId="channel-transfer-keep-contact" />
        </fieldset>
        <div>
          <ConfirmButton
            label={t('channels.transfer')}
            title={t('channels.transferConfirm', { name: iso(name), email: email ? iso(email) : t('channels.pickerNoEmail') })}
            body={t('channels.transferBody', {
              channel: iso(channel.name || channel.id),
              name: iso(name),
              videos: formatNumber(channel.videos, locale),
              playlists: formatNumber(channel.playlists, locale),
            })}
            bullets={consequences}
            withReason
            reasonHint={t('channels.transferReasonHint')}
            reasonMinLength={10}
            reasonMaxLength={500}
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

const NO_OPTIONS: TransferOptions = { keepPreviousOwnerAsAdmin: false, keepContactEmail: false };

function TransferOption({ id, checked, onChange, label, testId }: { id: string; checked: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void; label: string; testId: string }) {
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 shrink-0" data-testid={testId} />
      <label htmlFor={id} className="text-sm text-fg">
        {label}
      </label>
    </div>
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
