'use client';

/**
 * Add or edit an audio track (wiki AUN-MULTI-AUDIO §Studio). Adding: the source (upload a file, or
 * a track found in the video's own file), language, name in the player, type and "play first".
 * Editing: language, name and type. Not a <form>: the panel sits inside the video editor's form.
 */
import React, { useId, useState } from 'react';
import { AUDIO_TRACK_LANGUAGES, apiErrorMessage, defaultAudioTrackLabel, detectedStreamLanguage, AUDIO_LABEL_MAX, type AudioTrackKind, type AudioTrackLanguage, type AudioTracksTranslations, fillTemplate } from '@al-ummah/shared-types';
import { Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCreatorTermsPrompt } from '@/components/legal/useCreatorTermsPrompt';
import { reportError } from '@/lib/errors/reporter';
import { addAudioTrack, detectAudioStreams, updateAudioTrack, type AudioTracksView, type StudioAudioTrack } from '@/lib/api/audio-tracks';
import { addLimitMessage, fileProblem, languageName, maxFileSize, streamText } from './audio-track-model';

import { metaSeparator } from '@/lib/i18n/meta-separator';
export type AudioTrackDialogResult = { type: 'added'; track: StudioAudioTrack; file?: File } | { type: 'saved'; track: StudioAudioTrack };

export interface AudioTrackDialogProps {
  videoId: string;
  /** null: add a track */
  track: StudioAudioTrack | null;
  view: AudioTracksView;
  t: AudioTracksTranslations;
  lang: string;
  /** The video's language: the original audio's first choice */
  spokenLanguage?: string;
  onDone: (result: AudioTrackDialogResult) => void;
  onClose: () => void;
  /** A file check was requested: reload the panel's view */
  onDetect: () => Promise<void> | void;
}

const EXTRA_KINDS: AudioTrackKind[] = ['dub', 'commentary', 'description'];
const field = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60';
const isLanguage = (v: string | undefined): v is AudioTrackLanguage => !!v && AUDIO_TRACK_LANGUAGES.some((l) => l.code === v);

export default function AudioTrackDialog({ videoId, track, view, t, lang, spokenLanguage, onDone, onClose, onDetect }: AudioTrackDialogProps) {
  const ids = useId();
  const editing = !!track;
  const isOriginal = track?.source === 'original';
  const hasOriginalRow = view.tracks.some((x) => x.source === 'original');
  // The first stream is the video's own audio (the original); the others can become tracks
  const streams = (view.detected ?? []).filter((s) => s.index > 0);
  const firstFree = AUDIO_TRACK_LANGUAGES.find((l) => !view.tracks.some((x) => x.language === l.code && x.kind === 'dub'))?.code ?? 'en';

  const [source, setSource] = useState<'upload' | 'source_stream'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [streamIndex, setStreamIndex] = useState<number | null>(null);
  const [language, setLanguage] = useState<AudioTrackLanguage>(track?.language ?? firstFree);
  const [label, setLabel] = useState(track?.label ?? defaultAudioTrackLabel(firstFree));
  const [labelEdited, setLabelEdited] = useState(editing);
  const [kind, setKind] = useState<AudioTrackKind>(track?.kind ?? 'dub');
  const [makeDefault, setMakeDefault] = useState(false);
  const [originalLanguage, setOriginalLanguage] = useState<AudioTrackLanguage>(isLanguage(spokenLanguage) ? spokenLanguage : 'ar');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = useCreatorTermsPrompt(() => submit());

  const pickLanguage = (code: AudioTrackLanguage) => {
    setLanguage(code);
    if (!labelEdited) setLabel(defaultAudioTrackLabel(code));
  };

  const pickStream = (value: string) => {
    const index = value === '' ? null : Number(value);
    setStreamIndex(index);
    const s = streams.find((x) => x.index === index);
    const detectedLang = detectedStreamLanguage(s?.language);
    if (detectedLang) pickLanguage(detectedLang);
    if (s?.title && !labelEdited) setLabel(s.title.slice(0, AUDIO_LABEL_MAX));
  };

  const pickFile = (f: File | undefined) => {
    setFile(f ?? null);
    setFileError(f ? fileProblem(f, t, lang) : null);
  };

  const look = async () => {
    setLooking(true);
    setError(null);
    const res = await detectAudioStreams(videoId);
    setLooking(false);
    if (!res.ok) {
      setError(t.lookFailed);
      if (res.status === 0 || res.status >= 500) reportError(new Error(`audio stream check failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId } });
      return;
    }
    await onDetect();
  };

  const trimmed = label.trim();
  const ready =
    !busy &&
    trimmed.length > 0 &&
    trimmed.length <= AUDIO_LABEL_MAX &&
    (editing || (source === 'upload' ? !!file && !fileError : streamIndex !== null));

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const res = editing
      ? await updateAudioTrack(videoId, track!.id, { language, label: trimmed, ...(isOriginal ? {} : { kind }) })
      : await addAudioTrack(videoId, {
          language,
          label: trimmed,
          kind,
          isDefault: makeDefault,
          ...(!hasOriginalRow ? { originalLanguage } : {}),
          source:
            source === 'upload'
              ? { type: 'upload', bytes: file!.size, fileName: file!.name.slice(0, 200), ...(file!.type ? { contentType: file!.type.slice(0, 100) } : {}) }
              : { type: 'source_stream', streamIndex: streamIndex! },
        } as never);
    setBusy(false);
    if (!res.ok) {
      if (res.status === 403 && (res.details?.code === 'terms_required' || res.error === 'terms_required')) {
        setError(apiErrorMessage('terms_required', 403, lang === 'ar' ? 'ar' : 'en'));
        terms.refused();
      } else if (res.status === 402) {
        const d = res.details as { limit?: number; used?: number } | undefined;
        setError(addLimitMessage({ limit: { allowed: d?.limit ?? view.limit.allowed, used: d?.used ?? view.limit.used, unlimited: false } }, t, lang) ?? t.saveFailed);
      } else if (res.error === 'duplicate_track') setError(t.duplicate);
      else {
        setError(t.saveFailed);
        if (res.status === 0 || res.status >= 500) reportError(new Error(`audio track save failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId } });
      }
      return;
    }
    const saved = (res.data as { track: StudioAudioTrack }).track;
    if (editing) onDone({ type: 'saved', track: saved });
    else onDone({ type: 'added', track: saved, ...(source === 'upload' && file ? { file } : {}) });
  };

  const langOptions = AUDIO_TRACK_LANGUAGES.map((l) => (
    <option key={l.code} value={l.code}>
      {languageName(l.code, lang)}
      {languageName(l.code, lang) !== l.name ? `${metaSeparator(lang, '·')}${l.name}` : ''}
    </option>
  ));

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="audio-track-dialog" className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <div className="space-y-1 pe-8">
          <DialogTitle className="text-lg font-semibold text-foreground">{editing ? t.form.editTitle : t.form.addTitle}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t.hint}</DialogDescription>
        </div>

        <div className="space-y-4">
          {!editing && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-foreground">{t.form.source}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(['upload', 'source_stream'] as const).map((s) => (
                  <label
                    key={s}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      source === s ? 'border-brand-edge bg-brand-soft text-brand-ink' : 'border-border bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    <input type="radio" name={`${ids}-source`} value={s} checked={source === s} onChange={() => setSource(s)} data-testid={`audio-source-${s}`} className="h-4 w-4" />
                    {s === 'upload' ? t.form.sourceUpload : t.form.sourceStream}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {!editing && source === 'upload' && (
            <div className="space-y-1">
              <label htmlFor={`${ids}-file`} className="text-sm font-medium text-foreground">
                {t.form.file}
              </label>
              <input
                id={`${ids}-file`}
                type="file"
                accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.mp4,.webm,audio/*"
                data-testid="audio-track-file"
                aria-describedby={`${ids}-file-hint`}
                aria-invalid={!!fileError}
                onChange={(e) => pickFile(e.target.files?.[0])}
                className="block w-full text-sm text-foreground file:me-3 file:h-10 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:text-sm file:text-foreground hover:file:bg-muted"
              />
              <p id={`${ids}-file-hint`} className={`text-xs ${fileError ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`}>
                {fileError ?? fillTemplate(lang, t.form.fileHint, { size: maxFileSize(lang) })}
              </p>
            </div>
          )}

          {!editing && source === 'source_stream' && (
            <div className="space-y-2">
              {streams.length > 0 && (
                <div className="space-y-1">
                  <label htmlFor={`${ids}-stream`} className="text-sm font-medium text-foreground">
                    {t.form.sourceStream}
                  </label>
                  <select id={`${ids}-stream`} data-testid="audio-track-stream" value={streamIndex ?? ''} onChange={(e) => pickStream(e.target.value)} className={field}>
                    <option value="">{t.form.pickStream}</option>
                    {streams.map((s) => (
                      <option key={s.index} value={s.index}>
                        {streamText(s, t, lang)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {view.detecting || looking ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t.form.looking}
                </p>
              ) : (
                <>
                  {view.detected !== null && streams.length === 0 && <p className="text-sm text-muted-foreground">{t.form.noneFound}</p>}
                  {streams.length === 0 && (
                    <button
                      type="button"
                      data-testid="audio-track-look"
                      onClick={() => void look()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
                    >
                      <Search className="h-4 w-4" aria-hidden />
                      {t.form.look}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {!editing && !hasOriginalRow && (
            <div className="space-y-1">
              <label htmlFor={`${ids}-orig`} className="text-sm font-medium text-foreground">
                {t.form.originalLanguage}
              </label>
              <select id={`${ids}-orig`} data-testid="audio-track-original-language" value={originalLanguage} onChange={(e) => setOriginalLanguage(e.target.value as AudioTrackLanguage)} className={field}>
                {langOptions}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${ids}-lang`} className="text-sm font-medium text-foreground">
                {t.form.language}
              </label>
              <select id={`${ids}-lang`} data-testid="audio-track-language" value={language} onChange={(e) => pickLanguage(e.target.value as AudioTrackLanguage)} className={field}>
                {langOptions}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${ids}-kind`} className="text-sm font-medium text-foreground">
                {t.form.kind}
              </label>
              <select id={`${ids}-kind`} data-testid="audio-track-kind" value={kind} disabled={isOriginal} onChange={(e) => setKind(e.target.value as AudioTrackKind)} className={field}>
                {(isOriginal ? (['original'] as AudioTrackKind[]) : EXTRA_KINDS).map((k) => (
                  <option key={k} value={k}>
                    {t.kinds[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${ids}-label`} className="text-sm font-medium text-foreground">
              {t.form.label}
            </label>
            <input
              id={`${ids}-label`}
              data-testid="audio-track-label"
              value={label}
              maxLength={AUDIO_LABEL_MAX}
              lang={language}
              dir={AUDIO_TRACK_LANGUAGES.find((l) => l.code === language)?.dir ?? 'auto'}
              aria-describedby={`${ids}-label-hint`}
              onChange={(e) => {
                setLabel(e.target.value);
                setLabelEdited(true);
              }}
              className={field}
            />
            <p id={`${ids}-label-hint`} className="text-xs text-muted-foreground">
              {t.form.labelHint}
            </p>
          </div>

          {!editing && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
              <input type="checkbox" data-testid="audio-track-make-default" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4" />
              {t.form.makeDefault}
            </label>
          )}

          {error && (
            <div role="alert" data-testid="audio-track-error" data-code={terms.needed ? 'terms_required' : undefined} className="flex flex-wrap items-center gap-2 text-sm text-[var(--fanous-color-error-text)]">
              <span>{error}</span>
              {terms.reviewLink('audio-track-review-terms')}
            </div>
          )}
        </div>

        {terms.dialog}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm text-foreground hover:bg-muted disabled:opacity-50">
            {t.cancel}
          </button>
          <button
            type="button"
            data-testid="audio-track-submit"
            onClick={() => void submit()}
            disabled={!ready}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editing ? t.save : t.form.submit}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
