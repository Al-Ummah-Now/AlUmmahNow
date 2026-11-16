'use client';

/**
 * Studio's Audio tracks panel (wiki AUN-MULTI-AUDIO §Studio), below Subtitles in the video editor:
 * one row per track (language, name, type, default, status, edit, delete), Add audio track (upload
 * a file or pick a track found in the video's file) and how many the plan allows, as a plain fact.
 * While extra audio tracks are off for the channel (GET /api/me/features `audioTracks`: not in the
 * owner's plan, or not set up) there is no Add and no count; with no tracks, no panel at all.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUDIO_TRACK_LANGUAGES, type AudioTracksTranslations, formatNumber, formatCountNoun } from '@al-ummah/shared-types';
import { AlertTriangle, AudioLines, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useFeatures } from '@/hooks/useFeatures';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reportError } from '@/lib/errors/reporter';
import {
  chunkSender,
  completeAudioTrack,
  deleteAudioTrack,
  listAudioTracks,
  retryAudioTrack,
  updateAudioTrack,
  uploadAudioFile,
  type AudioTracksView,
  type StudioAudioTrack,
} from '@/lib/api/audio-tracks';
import AudioTrackDialog, { type AudioTrackDialogResult } from './AudioTrackDialog';
import { addLimitMessage, languageName, stateTone, trackStatusText, uploadPercent } from './audio-track-model';

export interface AudioTracksPanelProps {
  videoId: string;
  /** The video's language when it is one language: the original audio's first choice */
  spokenLanguage?: string;
  /** The video's channel: extra tracks follow its owner's plan */
  channelId?: string;
}

/** Uploads running in this tab: bytes stored, file size */
type LocalUploads = Record<string, { stored: number; total: number; failed?: boolean }>;

const TONE_CLASS: Record<ReturnType<typeof stateTone>, string> = {
  neutral: 'bg-muted text-foreground',
  progress: 'bg-brand-soft text-brand-ink',
  good: 'border border-current text-[var(--fanous-color-success-text)]',
  bad: 'border border-current text-[var(--fanous-color-error-text)]',
};

export default function AudioTracksPanel({ videoId, spokenLanguage, channelId }: AudioTracksPanelProps) {
  const { t, lang } = useLanguage();
  const { features } = useFeatures(channelId);
  const on = features.audioTracks;
  const ta = t.audioTracks as AudioTracksTranslations;
  const reasons = (t.studio?.videos?.review?.reasons ?? {}) as Record<string, string>;
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<AudioTracksView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialogFor, setDialogFor] = useState<'add' | StudioAudioTrack | null>(null);
  const [uploads, setUploads] = useState<LocalUploads>({});
  const abort = useRef({ aborted: false });

  const load = useCallback(async () => {
    const res = await listAudioTracks(videoId);
    if (!res.ok) {
      // A video the account cannot edit, or an API without tracks: the panel stays hidden
      if (res.status === 403 || res.status === 404) setView(null);
      else {
        setFailed(true);
        if (res.status === 0 || res.status >= 500) reportError(new Error(`audio tracks load failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId } });
      }
      return;
    }
    setFailed(false);
    setView(res.data);
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flag = abort.current;
    // Strict mode mounts twice: a remount clears the flag the first cleanup set
    flag.aborted = false;
    return () => {
      flag.aborted = true;
    };
  }, []);

  // Check back while something is on its way (processing, review, the package, a file check)
  const waiting =
    !!view &&
    (view.detecting ||
      view.package.status === 'building' ||
      view.tracks.some((tr) => tr.state === 'processing' || tr.state === 'checking' || (tr.state === 'uploading' && uploads[tr.id] && !uploads[tr.id]!.failed)));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const fail = (text: string, what: string, status: number, error: string, extra: Record<string, unknown> = {}) => {
    setNotice({ text, error: true });
    if (status === 0 || status >= 500) reportError(new Error(`audio track ${what} failed: ${error}`), { shown: true, status, extra: { videoId, ...extra } });
  };

  const sendFile = async (track: StudioAudioTrack, file: File, start: number) => {
    setUploads((u) => ({ ...u, [track.id]: { stored: start, total: file.size } }));
    const res = await uploadAudioFile(file, start, chunkSender(videoId, track.id), (stored) => setUploads((u) => ({ ...u, [track.id]: { stored, total: file.size } })), {
      signal: abort.current,
    });
    if (abort.current.aborted) return;
    if (!res.ok) {
      setUploads((u) => ({ ...u, [track.id]: { stored: res.stored, total: file.size, failed: true } }));
      fail(ta.uploadFailed, 'upload', res.error === 'network' ? 0 : 500, res.error, { trackId: track.id });
      return;
    }
    const done = await completeAudioTrack(videoId, track.id);
    setUploads((u) => {
      const { [track.id]: _gone, ...rest } = u;
      return rest;
    });
    if (!done.ok) fail(ta.uploadFailed, 'complete', done.status, done.error, { trackId: track.id });
    await load();
  };

  const onDialogDone = async (result: AudioTrackDialogResult) => {
    setDialogFor(null);
    if (result.type === 'added') {
      setNotice({ text: ta.added });
      await load();
      if (result.file) await sendFile(result.track, result.file, 0);
    } else if (result.type === 'saved') {
      setNotice({ text: ta.saved });
      await load();
    }
  };

  const resume = async (track: StudioAudioTrack, file: File | undefined) => {
    if (!file) return;
    if (file.size !== track.bytes) {
      setNotice({ text: ta.resume, error: true });
      return;
    }
    setNotice(null);
    await sendFile(track, file, track.uploadedBytes ?? 0);
  };

  const makeDefault = async (track: StudioAudioTrack) => {
    setBusy(`default-${track.id}`);
    setNotice(null);
    const res = await updateAudioTrack(videoId, track.id, { isDefault: true });
    setBusy(null);
    if (!res.ok) return fail(ta.saveFailed, 'default', res.status, res.error, { trackId: track.id });
    await load();
  };

  const retry = async (track: StudioAudioTrack) => {
    setBusy(`retry-${track.id}`);
    setNotice(null);
    const res = await retryAudioTrack(videoId, track.id);
    setBusy(null);
    if (!res.ok) return fail(ta.retryFailed, 'retry', res.status, res.error, { trackId: track.id });
    await load();
  };

  const remove = async (track: StudioAudioTrack) => {
    const yes = await confirm({ title: ta.deleteTitle, description: ta.deleteBody.replace('{label}', track.label), confirmLabel: ta.delete, cancelLabel: ta.cancel, danger: true });
    if (!yes) return;
    setBusy(`delete-${track.id}`);
    setNotice(null);
    const res = await deleteAudioTrack(videoId, track.id);
    setBusy(null);
    if (!res.ok) return fail(ta.deleteFailed, 'delete', res.status, res.error, { trackId: track.id });
    setNotice({ text: ta.deleted });
    await load();
  };

  const limitText = useMemo(() => (view ? addLimitMessage(view, ta, lang) : null), [view, ta, lang]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]">
        {ta.loadFailed}
      </p>
    );
  }
  if (!view) return <>{dialog}</>;
  // Off for this channel: nothing to add, so no panel unless tracks are already there to manage
  if (!on && view.tracks.length === 0) return <>{dialog}</>;

  const canAdd = view.ready && !limitText;
  const usage = view.limit.unlimited
    ? ta.usedUnlimited.replace('{used}', formatNumber(lang, view.limit.used))
    : ta.used.replace('{used}', formatNumber(lang, view.limit.used)).replace('{allowedTracks}', formatCountNoun(lang, view.limit.allowed, 'audioTrack'));

  return (
    <section aria-labelledby={`audio-tracks-${videoId}`} data-testid="audio-tracks" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 id={`audio-tracks-${videoId}`} className="flex items-center gap-2 text-lg font-semibold text-foreground md:text-xl">
            <AudioLines className="h-5 w-5 md:h-6 md:w-6" aria-hidden />
            {ta.title}
          </h3>
          <p className="text-xs text-muted-foreground md:text-sm">{ta.hint}</p>
          {on && (view.limit.unlimited || view.limit.allowed > 0) && (
            <p data-testid="audio-tracks-usage" className="text-xs font-medium text-foreground">
              {usage}
            </p>
          )}
        </div>
        {on && (
        <button
          type="button"
          data-testid="audio-track-add"
          onClick={() => setDialogFor('add')}
          disabled={!canAdd || !!busy}
          aria-describedby={!canAdd ? `audio-tracks-why-${videoId}` : undefined}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {ta.add}
        </button>
        )}
      </div>

      {on && (!view.ready || limitText) && (
        <p id={`audio-tracks-why-${videoId}`} data-testid="audio-tracks-limit" className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-foreground">
          {!view.ready ? ta.notReady : limitText}
        </p>
      )}

      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={`text-sm ${notice.error ? 'text-[var(--fanous-color-error-text)]' : 'text-foreground'}`}>
          {notice.text}
        </p>
      )}

      {view.package.status === 'building' && (
        <p role="status" data-testid="audio-tracks-updating" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {ta.updating}
        </p>
      )}

      {/* Only an invitation when a track can be added; otherwise the notice above explains why not */}
      {view.tracks.length === 0 && on && canAdd && (
        <p data-testid="audio-tracks-empty" className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {ta.empty}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3" aria-label={ta.title}>
        {view.tracks.map((track) => {
          const local = uploads[track.id];
          const percent = uploadPercent(track, local);
          const status = trackStatusText(track, ta, reasons, percent, t.studio?.videos?.review?.rejected, lang);
          const stalled = track.state === 'uploading' && (!local || local.failed);
          const meta = AUDIO_TRACK_LANGUAGES.find((l) => l.code === track.language);
          return (
            <li
              key={track.id}
              data-testid="audio-track"
              data-track-id={track.id}
              data-state={track.state}
              data-default={track.isDefault ? 'true' : 'false'}
              className={`rounded-xl border bg-card p-4 shadow-sm ${track.isDefault ? 'border-brand-edge' : 'border-border'}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-foreground" lang={track.language} dir={meta?.dir ?? 'auto'}>
                      {track.label}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{ta.kinds[track.kind]}</span>
                    <span data-testid="audio-track-status" className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[stateTone(track.state)]}`}>
                      {track.state === 'processing' || track.state === 'checking' ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          {status.label}
                        </span>
                      ) : (
                        status.label
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{languageName(track.language, lang)}</p>
                  {track.state === 'uploading' && percent !== null && (
                    <div
                      role="progressbar"
                      aria-label={status.label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border"
                    >
                      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  {status.detail && (
                    <p className="flex items-start gap-1 text-xs text-[var(--fanous-color-error-text)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {status.detail}
                    </p>
                  )}
                  {stalled && (
                    <p className="text-xs text-foreground">
                      <label className="cursor-pointer underline underline-offset-2" htmlFor={`audio-resume-${track.id}`}>
                        {ta.resume}
                      </label>
                      <input
                        id={`audio-resume-${track.id}`}
                        type="file"
                        accept="audio/*,video/mp4,video/webm"
                        className="sr-only"
                        data-testid="audio-track-resume"
                        onChange={(e) => void resume(track, e.target.files?.[0])}
                      />
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm ${
                      track.isDefault ? 'border-brand-edge bg-brand-soft text-brand-ink' : 'border-border bg-background text-foreground'
                    } ${track.state !== 'ready' && !track.isDefault ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}
                  >
                    <input
                      type="radio"
                      name={`audio-default-${videoId}`}
                      data-testid="audio-track-default"
                      checked={track.isDefault}
                      disabled={track.state !== 'ready' || !!busy}
                      onChange={() => void makeDefault(track)}
                      className="h-4 w-4 accent-[var(--fanous-color-brand,currentColor)]"
                    />
                    {busy === `default-${track.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {ta.isDefault}
                  </label>
                  {track.state === 'failed' && (
                    <button
                      type="button"
                      data-testid="audio-track-retry"
                      onClick={() => void retry(track)}
                      disabled={!!busy}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {busy === `retry-${track.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                      {ta.retry}
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="audio-track-edit"
                    onClick={() => setDialogFor(track)}
                    disabled={!!busy}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    {ta.edit}
                  </button>
                  {track.source !== 'original' && (
                    <button
                      type="button"
                      data-testid="audio-track-delete"
                      onClick={() => void remove(track)}
                      disabled={!!busy}
                      aria-label={`${ta.delete}: ${track.label}`}
                      title={ta.delete}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-[var(--fanous-color-error-text)] hover:bg-muted disabled:opacity-50"
                    >
                      {busy === `delete-${track.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {dialogFor && (
        <AudioTrackDialog
          videoId={videoId}
          track={dialogFor === 'add' ? null : dialogFor}
          view={view}
          t={ta}
          lang={lang}
          spokenLanguage={spokenLanguage}
          onDone={(r) => void onDialogDone(r)}
          onClose={() => setDialogFor(null)}
          onDetect={load}
        />
      )}
      {dialog}
    </section>
  );
}
