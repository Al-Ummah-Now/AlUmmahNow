'use client';

/**
 * The caption draft editor (AUN-CAPTIONS §3.3): cues beside the video, text edits, ±0.1 s nudges,
 * merge and split, find and replace, undo/redo, Quran spans to confirm, autosave over the loaded
 * version, and Publish. Drafts are never shown to viewers until published.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ChevronsLeft, ChevronsRight, Loader2, Merge, Play, Redo2, Replace, Scissors, Search, Trash2, Undo2 } from 'lucide-react';
import { RTL_CAPTION_LANGUAGES, type CaptionCue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reportError } from '@/lib/errors/reporter';
import { getCaptionDraft, publishCaptionDraft, saveCaptionDraft, type CaptionDraftSummary } from '@/lib/api/caption-drafts';
import QuranSpanCard from './QuranSpanCard';
import {
  NUDGE_MS,
  acceptAllConfident,
  acceptSpan,
  commit,
  confidentCount,
  countMatches,
  deleteCue,
  formatCueTime,
  initHistory,
  mergeNext,
  nudge,
  redo,
  rejectSpan,
  replaceAll,
  setSpanRange,
  setSpeechText,
  splitCue,
  undo,
  type History,
} from './editor-state';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

export interface CaptionDraftEditorProps {
  videoId: string;
  language: string;
  languageLabel: string;
  videoUrl?: string;
  posterUrl?: string;
  open: boolean;
  onClose: () => void;
  /** After a save or publish: the list refreshes its summary */
  onChanged: (summary?: CaptionDraftSummary) => void;
}

const AUTOSAVE_MS = 1200;

export default function CaptionDraftEditor({ videoId, language, languageLabel, videoUrl, posterUrl, open, onClose, onChanged }: CaptionDraftEditorProps) {
  const { t, lang } = useLanguage();
  const tc = t.captions;
  const { confirm, dialog } = useConfirm();
  const [history, setHistory] = useState<History | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const version = useRef(0);
  const savedCues = useRef<CaptionCue[] | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const lastEditKey = useRef<string | undefined>(undefined);
  const caret = useRef<{ id: string; seg: number; pos: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const historyRef = useRef<History | null>(null);
  historyRef.current = history;
  const rtl = RTL_CAPTION_LANGUAGES.has(language);

  const load = useCallback(async () => {
    setLoadError(false);
    setHistory(null);
    const res = await getCaptionDraft(videoId, language);
    if (!res.ok) {
      setLoadError(true);
      return;
    }
    version.current = res.data.version;
    savedCues.current = res.data.cues;
    setHistory(initHistory(res.data.cues));
    setSaveState('saved');
  }, [videoId, language]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const cues = history?.present ?? null;

  /** Saves the current cues over the loaded version. Resolves true when nothing is left unsaved. */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const current = historyRef.current?.present;
    if (!current || current === savedCues.current) return true;
    const run = (async () => {
      setSaveState('saving');
      const res = await saveCaptionDraft(videoId, language, version.current, current);
      if (res.ok) {
        version.current = res.data.version;
        savedCues.current = current;
        setSaveState(historyRef.current?.present === current ? 'saved' : 'unsaved');
        onChanged(res.data);
        return true;
      }
      if (res.status === 409 && res.error === 'draft_conflict') {
        setSaveState('conflict');
        return false;
      }
      setSaveState('error');
      reportError(new Error(`caption draft save failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, language } });
      return false;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, [videoId, language, onChanged]);

  // Autosave a moment after the last edit
  useEffect(() => {
    if (!cues || cues === savedCues.current || saveState === 'conflict') return;
    setSaveState((s) => (s === 'saving' ? s : 'unsaved'));
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [cues, save, saveState]);

  const edit = useCallback((f: (c: CaptionCue[]) => CaptionCue[], coalesceKey?: string) => {
    setHistory((h) => {
      if (!h) return h;
      const next = f(h.present);
      const out = commit(h, next, coalesceKey ? { key: coalesceKey, last: lastEditKey.current } : undefined);
      lastEditKey.current = coalesceKey;
      return out;
    });
  }, []);

  const doUndo = () => {
    lastEditKey.current = undefined;
    setHistory((h) => (h ? undo(h) : h));
  };
  const doRedo = () => {
    lastEditKey.current = undefined;
    setHistory((h) => (h ? redo(h) : h));
  };

  // Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z outside text fields (text fields keep their own undo)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Follow playback: the cue under the playhead is highlighted
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cues) return;
    const onTime = () => {
      const ms = v.currentTime * 1000;
      const hit = cues.find((c) => ms >= c.startMs && ms < c.endMs);
      setActiveId(hit?.id ?? null);
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [cues]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    void v.play().catch(() => undefined);
  };

  const confident = useMemo(() => (cues ? confidentCount(cues) : 0), [cues]);
  const matches = useMemo(() => (cues ? countMatches(cues, find) : 0), [cues, find]);

  const doReplaceAll = () => {
    if (!cues) return;
    const { count } = replaceAll(cues, find, replaceWith);
    if (!count) return;
    edit((c) => replaceAll(c, find, replaceWith).cues);
    setNotice(tc.editor.replaced.replace('{count}', String(count)));
  };

  const publish = async () => {
    setPublishing(true);
    setNotice(null);
    try {
      if (!(await save())) return;
      let res = await publishCaptionDraft(videoId, language, version.current);
      if (!res.ok && res.error === 'replaces_upload') {
        const yes = await confirm({
          title: tc.replaceUploadTitle,
          description: tc.replaceUploadBody.replace('{language}', languageLabel),
          confirmLabel: tc.replace,
          cancelLabel: t.common?.cancel ?? tc.quran.cancel,
          danger: true,
        });
        if (!yes) return;
        res = await publishCaptionDraft(videoId, language, version.current, true);
      }
      if (!res.ok) {
        if (res.error === 'draft_conflict') setSaveState('conflict');
        else {
          setNotice(tc.publishFailed);
          reportError(new Error(`caption draft publish failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, language } });
        }
        return;
      }
      setNotice(tc.published);
      onChanged(res.data.draft);
    } finally {
      setPublishing(false);
    }
  };

  const close = async () => {
    await save();
    onClose();
  };

  const saveLabel =
    saveState === 'saving' ? tc.editor.saving : saveState === 'unsaved' ? tc.editor.unsaved : saveState === 'error' ? tc.editor.saveFailed : saveState === 'conflict' ? tc.conflict : tc.editor.saved;

  const iconBtn =
    'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && void close()}>
      <DialogContent
        data-testid="caption-editor"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-6xl sm:rounded-xl bg-background text-foreground"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 pe-14">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{tc.editor.title.replace('{language}', languageLabel)}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{tc.editor.banner}</DialogDescription>
          </div>
          <span
            role="status"
            aria-live="polite"
            data-testid="caption-save-state"
            data-state={saveState}
            className={`text-xs ${saveState === 'error' || saveState === 'conflict' ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`}
          >
            {saveLabel}
          </span>
          {saveState === 'error' && (
            <button type="button" className={iconBtn} onClick={() => void save()}>
              {tc.editor.retry}
            </button>
          )}
          {saveState === 'conflict' && (
            <button type="button" className={iconBtn} onClick={() => void load()}>
              {tc.reload}
            </button>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <button type="button" className={iconBtn} onClick={doUndo} disabled={!history?.past.length} aria-label={tc.editor.undo} title={tc.editor.undo}>
              <Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </button>
            <button type="button" className={iconBtn} onClick={doRedo} disabled={!history?.future.length} aria-label={tc.editor.redo} title={tc.editor.redo}>
              <Redo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </button>
            <button
              type="button"
              data-testid="caption-confirm-all"
              className={`${iconBtn} border-brand-edge text-brand-ink`}
              onClick={() => edit(acceptAllConfident)}
              disabled={!confident}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {tc.editor.confirmAll.replace('{count}', String(confident))}
            </button>
            <button
              type="button"
              data-testid="caption-publish"
              onClick={() => void publish()}
              disabled={publishing || !cues || saveState === 'conflict'}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {publishing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {tc.editor.publishSaved}
            </button>
          </div>
          {notice && (
            <p role="status" className="basis-full text-sm text-foreground">
              {notice}
            </p>
          )}
        </header>

        {loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-foreground">{tc.loadFailed}</p>
            <button type="button" className={iconBtn} onClick={() => void load()}>
              {tc.editor.retry}
            </button>
          </div>
        ) : !cues ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <aside className="border-b border-border p-4 md:border-b-0 md:border-e space-y-3 md:overflow-y-auto">
              {videoUrl && (
                <video ref={videoRef} src={videoUrl} poster={posterUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-muted" />
              )}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Search className="h-3.5 w-3.5" aria-hidden />
                  {tc.editor.find}
                  {find && <span className="ms-auto text-muted-foreground tabular-nums">{matches}</span>}
                </label>
                <input value={find} onChange={(e) => setFind(e.target.value)} dir="auto" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" aria-label={tc.editor.find} />
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Replace className="h-3.5 w-3.5" aria-hidden />
                  {tc.editor.replaceWith}
                </label>
                <input value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} dir="auto" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" aria-label={tc.editor.replaceWith} />
                <button type="button" className={`${iconBtn} w-full`} onClick={doReplaceAll} disabled={!matches}>
                  {tc.editor.replaceAll}
                </button>
              </div>
            </aside>

            <ol aria-label={tc.editor.cueList} className="min-h-0 overflow-y-auto p-4 space-y-3" data-testid="caption-cues">
              {cues.length === 0 && <li className="text-sm text-muted-foreground">{tc.editor.empty}</li>}
              {cues.map((cue, i) => (
                <li
                  key={cue.id}
                  data-testid="caption-cue"
                  data-cue-id={cue.id}
                  aria-current={activeId === cue.id ? 'true' : undefined}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 140px' }}
                  className={`rounded-xl border p-3 space-y-2 transition-colors ${activeId === cue.id ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => seek(cue.startMs)}
                      disabled={!videoUrl}
                      aria-label={tc.editor.playFrom.replace('{time}', formatCueTime(cue.startMs))}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-2 font-mono text-xs tabular-nums text-foreground hover:bg-muted/70"
                      dir="ltr"
                    >
                      <Play className="h-3 w-3" aria-hidden />
                      {formatCueTime(cue.startMs)} → {formatCueTime(cue.endMs)}
                    </button>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">{tc.editor.start}</span>
                      <button type="button" className={iconBtn} aria-label={tc.editor.startEarlier} title={tc.editor.startEarlier} onClick={() => edit((c) => nudge(c, cue.id, 'start', -NUDGE_MS))}>
                        <ChevronsLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </button>
                      <button type="button" className={iconBtn} aria-label={tc.editor.startLater} title={tc.editor.startLater} onClick={() => edit((c) => nudge(c, cue.id, 'start', NUDGE_MS))}>
                        <ChevronsRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </button>
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">{tc.editor.end}</span>
                      <button type="button" className={iconBtn} aria-label={tc.editor.endEarlier} title={tc.editor.endEarlier} onClick={() => edit((c) => nudge(c, cue.id, 'end', -NUDGE_MS))}>
                        <ChevronsLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </button>
                      <button type="button" className={iconBtn} aria-label={tc.editor.endLater} title={tc.editor.endLater} onClick={() => edit((c) => nudge(c, cue.id, 'end', NUDGE_MS))}>
                        <ChevronsRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </button>
                    </span>
                    <span className="ms-auto inline-flex gap-1.5">
                      <button
                        type="button"
                        className={iconBtn}
                        aria-label={tc.editor.split}
                        title={tc.editor.split}
                        onClick={() => {
                          const at = caret.current;
                          if (at && at.id === cue.id) edit((c) => splitCue(c, cue.id, at.seg, at.pos));
                        }}
                      >
                        <Scissors className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" className={iconBtn} aria-label={tc.editor.mergeNext} title={tc.editor.mergeNext} disabled={i === cues.length - 1} onClick={() => edit((c) => mergeNext(c, cue.id))}>
                        <Merge className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" className={`${iconBtn} text-[var(--fanous-color-error-text)]`} aria-label={tc.editor.deleteCue} title={tc.editor.deleteCue} onClick={() => edit((c) => deleteCue(c, cue.id))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  </div>
                  {cue.segments.map((seg, s) =>
                    seg.type === 'speech' ? (
                      <textarea
                        key={`s${s}`}
                        value={seg.text}
                        dir={rtl ? 'rtl' : 'auto'}
                        lang={language}
                        rows={Math.min(4, Math.max(1, Math.ceil(seg.text.length / 60)))}
                        aria-label={tc.editor.cueText}
                        onChange={(e) => edit((c) => setSpeechText(c, cue.id, s, e.target.value), `${cue.id}:${s}`)}
                        onSelect={(e) => {
                          caret.current = { id: cue.id, seg: s, pos: (e.target as HTMLTextAreaElement).selectionStart };
                        }}
                        onBlur={() => {
                          lastEditKey.current = undefined;
                        }}
                        className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    ) : (
                      <QuranSpanCard
                        key={`q${s}`}
                        segment={seg}
                        t={tc.quran}
                        lang={lang}
                        onAccept={() => edit((c) => acceptSpan(c, cue.id, s))}
                        onReject={() => edit((c) => rejectSpan(c, cue.id, s))}
                        onRange={(range) => edit((c) => setSpanRange(c, cue.id, s, range))}
                      />
                    ),
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
