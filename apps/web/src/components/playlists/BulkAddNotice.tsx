'use client';

/**
 * What happened to a bulk add, in plain words, and what happens next:
 *
 *   done    → "Added 12 videos to Tafsir." (+ skipped counts)
 *   queued  → progress while the background job runs; then "All videos are
 *             now in Tafsir." or, when the job failed, "Our team has been
 *             notified" with Retry (the job is also on the admin Errors page)
 *   failed  → the request itself failed: Retry re-sends the same ids
 *             (adds are idempotent, so a retry never adds a video twice)
 *
 * Raw errors never reach the user; failures go to the error reporter.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import type { PlaylistAddJobStatus, PlaylistBulkAddResult } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { addVideosToPlaylist, getPlaylistAddJob, retryPlaylistAddJob } from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';
import { counted, fill } from './text';
import { NOTICE } from './styles';

/** The outcome a notice shows: the API's answer, or a request that got none. */
export type BulkAddOutcome =
  | { kind: 'result'; result: PlaylistBulkAddResult }
  | { kind: 'request-failed'; status: number | null; ref?: string };

interface Props {
  playlistId: string;
  playlistTitle: string;
  channelId: string;
  outcome: BulkAddOutcome;
  /** The ids that were sent (Retry re-sends them). */
  videoIds: string[];
  /** Called when the playlist changed (an add finished), so the page can reload it. */
  onChanged?: () => void;
  /** "Created, but the videos could not be added yet" wording. */
  justCreated?: boolean;
  pollMs?: number;
}

const ACTIVE = new Set(['queued', 'running', 'retrying']);

export default function BulkAddNotice({ playlistId, playlistTitle, channelId, outcome: initial, videoIds, onChanged, justCreated, pollMs = 2500 }: Props) {
  const { t } = useLanguage();
  const p = t.playlistTools;
  const [outcome, setOutcome] = useState<BulkAddOutcome>(initial);
  const [job, setJob] = useState<PlaylistAddJobStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => setOutcome(initial), [initial]);

  const result = outcome.kind === 'result' ? outcome.result : null;
  const jobId = result?.status === 'queued' || result?.status === 'failed' ? result.jobId : undefined;

  // Follow the background job until it ends
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      const answer = await getPlaylistAddJob(playlistId, jobId, { channelId });
      if (stopped) return;
      if (answer.ok) {
        setJob(answer.data);
        if (!ACTIVE.has(answer.data.status)) {
          if (answer.data.status === 'succeeded') changed.current?.();
          else reportError(new Error('Background playlist add failed'), { shown: true, extra: { step: 'playlist-bulk-add-job', playlistId, jobId, processed: answer.data.processed, total: answer.data.total } });
          return;
        }
      }
      timer = window.setTimeout(poll, pollMs);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, playlistId, channelId, pollMs]);

  useEffect(() => {
    if (result?.status === 'done' && result.added > 0) changed.current?.();
    if (outcome.kind === 'request-failed') {
      // The page already reported it; nothing else to do here
    }
  }, [result, outcome.kind]);

  const retry = async () => {
    setRetrying(true);
    try {
      if (job?.status === 'failed' && jobId) {
        const answer = await retryPlaylistAddJob(playlistId, jobId, { channelId });
        if (answer.ok) setJob(answer.data);
        else setOutcome({ kind: 'request-failed', status: answer.status, ref: reportError(new Error('Retrying the playlist add job failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-bulk-add-retry', playlistId, jobId } }) });
      } else {
        const answer = await addVideosToPlaylist(playlistId, videoIds, { channelId });
        if (answer.ok) {
          setJob(null);
          setOutcome({ kind: 'result', result: answer.data });
        } else {
          setOutcome({ kind: 'request-failed', status: answer.status, ref: reportError(new Error('Retrying the playlist add failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-bulk-add-retry', playlistId, count: videoIds.length } }) });
        }
      }
    } finally {
      setRetrying(false);
    }
  };

  const title = playlistTitle;
  let tone: keyof typeof NOTICE = 'success';
  let icon = <CheckCircle2 className="h-5 w-5 flex-none" aria-hidden="true" />;
  const lines: string[] = [];
  let canRetry = false;
  let progress: { done: number; total: number } | null = null;

  if (outcome.kind === 'request-failed') {
    tone = 'error';
    icon = <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />;
    lines.push(outcome.status === 403 ? fill(p.addForbidden, { title }) : justCreated ? fill(p.createdAddFailed, { title }) : fill(p.addFailed, { title }));
    canRetry = outcome.status !== 403;
    if (outcome.ref) lines.push(fill(p.errorRef, { ref: outcome.ref }));
  } else if (result) {
    if (result.added > 0) lines.push(counted(result.added, p.addDoneOne, p.addDoneOther, { title }));
    else if (result.pending === 0 && result.alreadyInPlaylist > 0 && result.notInChannel === 0) lines.push(fill(p.addNothingNew, { title }));
    if (result.alreadyInPlaylist > 0 && result.added + result.pending > 0) lines.push(fill(p.skippedAlready, { count: result.alreadyInPlaylist }));
    if (result.notInChannel > 0) lines.push(fill(p.skippedUnavailable, { count: result.notInChannel }));

    if (result.status === 'failed' && (!job || job.status === 'failed')) {
      tone = 'error';
      icon = <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />;
      lines.push(justCreated && result.added === 0 ? fill(p.createdAddFailed, { title }) : fill(p.addJobFailed, { title }));
      canRetry = true;
    } else if (result.status === 'queued' || job) {
      const status = job?.status ?? 'queued';
      if (ACTIVE.has(status)) {
        tone = 'info';
        icon = <Loader2 className="h-5 w-5 flex-none animate-spin motion-reduce:animate-none" aria-hidden="true" />;
        lines.push(fill(p.addQueued, { count: job?.total ?? result.pending, title }));
        progress = { done: job?.processed ?? 0, total: job?.total ?? result.pending };
      } else if (status === 'succeeded') {
        lines.push(fill(p.addFinished, { title }));
        if (job && job.notInChannel > 0) lines.push(fill(p.skippedUnavailable, { count: job.notInChannel }));
      } else {
        tone = 'error';
        icon = <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />;
        lines.push(fill(p.addJobFailed, { title }));
        canRetry = true;
      }
    }
  }

  // A new playlist created without videos
  if (lines.length === 0 && justCreated) lines.push(fill(p.createdPlaylist, { title }));

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE[tone]}`}
      data-testid="bulk-add-notice"
      data-tone={tone}
    >
      {icon}
      <div className="min-w-0 flex-1 space-y-1">
        {lines.map((line, i) => <p key={i} className={i === 0 ? 'font-medium' : ''}>{line}</p>)}
        {progress && (
          <div className="pt-1">
            <div className="pl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={fill(p.addProgress, progress)}>
              <span style={{ inlineSize: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 text-xs">{fill(p.addProgress, progress)}</p>
          </div>
        )}
      </div>
      {canRetry && (
        <button type="button" className="b b-secondary b-sm flex-none" onClick={retry} disabled={retrying} data-testid="bulk-add-retry">
          {retrying ? p.adding : p.retry}
        </button>
      )}
    </div>
  );
}
