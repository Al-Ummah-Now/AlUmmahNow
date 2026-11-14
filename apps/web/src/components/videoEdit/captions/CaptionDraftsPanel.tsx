'use client';

/**
 * Caption drafts in Studio's Subtitles section (AUN-CAPTIONS §3.1): each language's draft with
 * where it came from, Quran suggestions left to check and whether it is published, with Edit,
 * Publish and Delete; while the video review's automatic transcript is available, the offer to use
 * it as a draft (#1296); and Transcribe on request with the caption minutes (CaptionTranscribe).
 * Renders nothing when there is none of these (no drafts, no transcript, minutes not readable).
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { isCaptionJobActive } from '@al-ummah/shared-types';
import { AudioLines, BookOpen, FilePenLine, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reportError } from '@/lib/errors/reporter';
import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';
import {
  claimReviewTranscript,
  deleteCaptionDraft,
  getCaptionMinutes,
  listCaptionDrafts,
  listCaptionJobs,
  publishCaptionDraft,
  type CaptionClaim,
  type CaptionDraftSummary,
  type CaptionJobView,
} from '@/lib/api/caption-drafts';
import CaptionDraftEditor from './CaptionDraftEditor';
import CaptionTranscribe, { type CaptionMinutes } from './CaptionTranscribe';

export interface CaptionDraftsPanelProps {
  videoId: string;
  videoUrl?: string;
  posterUrl?: string;
  /** A draft was published: the track list reloads */
  onPublished?: () => void;
  /** Bumped by the parent to reload (e.g. after a transcript was claimed) */
  refreshKey?: number;
  /** The video's language when it is one language: Transcribe's first choice */
  spokenLanguage?: string;
}

export default function CaptionDraftsPanel({ videoId, videoUrl, posterUrl, onPublished, refreshKey = 0, spokenLanguage }: CaptionDraftsPanelProps) {
  const { t, lang } = useLanguage();
  const tc = t.captions;
  const { confirm, dialog } = useConfirm();
  const [drafts, setDrafts] = useState<CaptionDraftSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [claims, setClaims] = useState<CaptionClaim[]>([]);
  const [transcript, setTranscript] = useState(false);
  const [claimLang, setClaimLang] = useState('ar');
  const claimLangId = useId();
  const [jobs, setJobs] = useState<CaptionJobView[]>([]);
  const [minutes, setMinutes] = useState<CaptionMinutes | null>(null);
  /** Jobs seen running, so the one that finishes says its draft is ready */
  const runningJobs = useRef(new Set<string>());
  /** The language whose transcription just finished */
  const [readyLanguage, setReadyLanguage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, jobsRes, minutesRes] = await Promise.all([listCaptionDrafts(videoId), listCaptionJobs(videoId), getCaptionMinutes(videoId)]);
    if (!res.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setDrafts(res.data.drafts);
    setClaims(res.data.claims ?? []);
    setTranscript(!!res.data.transcriptAvailable);
    // Without jobs or minutes (no access to transcription) the drafts still work
    if (jobsRes.ok) {
      const finished = jobsRes.data.jobs.find((j) => j.status === 'ready' && runningJobs.current.has(j.id));
      runningJobs.current = new Set(jobsRes.data.jobs.filter((j) => isCaptionJobActive(j.status)).map((j) => j.id));
      setJobs(jobsRes.data.jobs);
      if (finished) {
        setNotice(null);
        setReadyLanguage(finished.language);
      }
    }
    setMinutes(minutesRes.ok ? minutesRes.data : null);
  }, [videoId]);

  // While a draft is being prepared or transcribed, check back until it is there
  const preparing = claims.some((c) => c.status === 'queued') || jobs.some((j) => isCaptionJobActive(j.status));
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [preparing, load]);

  const claim = async (language: string, replace = false) => {
    setNotice(null);
    if (!replace && drafts?.some((d) => d.language === language)) {
      const yes = await confirm({
        title: tc.claim.replaceTitle,
        description: tc.claim.replaceBody.replace('{language}', label(language)),
        confirmLabel: tc.replace,
        cancelLabel: t.common?.cancel ?? tc.quran.cancel,
        danger: true,
      });
      if (!yes) return;
      replace = true;
    }
    setBusy(`claim-${language}`);
    const res = await claimReviewTranscript(videoId, language, replace);
    setBusy(null);
    if (!res.ok && res.error !== 'claim_pending') {
      if (res.error === 'transcript_not_found') setTranscript(false);
      setNotice(res.error === 'transcript_not_found' ? tc.claim.failed.transcript_gone : tc.claim.requestFailed);
      if (res.status >= 500 || res.status === 0) reportError(new Error(`caption claim failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, language } });
      return;
    }
    await load();
  };

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const label = (code: string) => {
    const l = SUPPORTED_LANGUAGES.find((x) => x.code === code);
    return l ? (lang === 'ar' ? l.nameAr : l.name) : code;
  };

  const upsert = (summary?: CaptionDraftSummary) => {
    if (!summary) return;
    setDrafts((d) => (d ? d.map((x) => (x.language === summary.language ? summary : x)) : d));
  };

  const publish = async (d: CaptionDraftSummary) => {
    setBusy(`publish-${d.language}`);
    setNotice(null);
    try {
      let res = await publishCaptionDraft(videoId, d.language, d.version);
      if (!res.ok && res.error === 'replaces_upload') {
        const yes = await confirm({
          title: tc.replaceUploadTitle,
          description: tc.replaceUploadBody.replace('{language}', label(d.language)),
          confirmLabel: tc.replace,
          cancelLabel: t.common?.cancel ?? tc.quran.cancel,
          danger: true,
        });
        if (!yes) return;
        res = await publishCaptionDraft(videoId, d.language, d.version, true);
      }
      if (!res.ok) {
        if (res.error === 'draft_conflict') {
          setNotice(tc.conflict);
          await load();
        } else {
          setNotice(tc.publishFailed);
          reportError(new Error(`caption draft publish failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, language: d.language } });
        }
        return;
      }
      upsert(res.data.draft);
      setNotice(tc.published);
      onPublished?.();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: CaptionDraftSummary) => {
    const yes = await confirm({ title: tc.deleteTitle, description: tc.deleteBody, confirmLabel: tc.deleteDraft, cancelLabel: t.common?.cancel ?? tc.quran.cancel, danger: true });
    if (!yes) return;
    setBusy(`delete-${d.language}`);
    const res = await deleteCaptionDraft(videoId, d.language);
    setBusy(null);
    if (!res.ok) {
      setNotice(tc.deleteFailed);
      reportError(new Error(`caption draft delete failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, language: d.language } });
      return;
    }
    setDrafts((list) => list?.filter((x) => x.language !== d.language) ?? null);
  };

  if (failed) return <p className="text-sm text-[var(--fanous-color-error-text)]">{tc.loadFailed}</p>;
  if (!drafts?.length && !transcript && !claims.length && !notice && !minutes) return <>{dialog}</>;

  return (
    <section aria-labelledby="caption-drafts-title" data-testid="caption-drafts" className="space-y-3">
      <div>
        <h4 id="caption-drafts-title" className="text-base font-semibold text-foreground">
          {tc.draftsTitle}
        </h4>
        <p className="text-xs text-muted-foreground">{tc.draftsHint}</p>
      </div>
      {notice ? (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      ) : (
        readyLanguage && (
          <p role="status" data-testid="caption-job-ready" className="text-sm text-foreground">
            {tc.jobs.ready.replace('{language}', label(readyLanguage))}
          </p>
        )
      )}
      {(transcript || claims.length > 0) && (
        <div data-testid="caption-claim" className="rounded-xl border border-dashed border-brand-edge bg-brand-soft p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AudioLines className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{tc.claim.title}</p>
              <p className="text-xs text-muted-foreground">{tc.claim.body}</p>
            </div>
          </div>
          {claims.map((c) =>
            c.status === 'queued' ? (
              <p key={c.language} role="status" data-testid="caption-claim-preparing" className="flex items-center gap-2 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {tc.claim.preparing.replace('{language}', label(c.language))}
              </p>
            ) : (
              <div key={c.language} role="alert" data-testid="caption-claim-failed" className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[var(--fanous-color-error-text)]">
                  {label(c.language)}: {tc.claim.failed[c.error ?? 'failed']}
                </span>
                {transcript && (
                  <button
                    type="button"
                    onClick={() => void claim(c.language, c.error === 'draft_exists')}
                    disabled={!!busy}
                    className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {c.error === 'draft_exists' ? tc.replace : tc.claim.tryAgain}
                  </button>
                )}
              </div>
            ),
          )}
          {transcript && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={claimLangId} className="text-xs font-medium text-foreground">
                  {tc.claim.languageLabel}
                </label>
                <select
                  id={claimLangId}
                  value={claimLang}
                  onChange={(e) => setClaimLang(e.target.value)}
                  className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {lang === 'ar' ? l.nameAr : l.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                data-testid="caption-claim-action"
                onClick={() => void claim(claimLang)}
                disabled={!!busy || claims.some((c) => c.language === claimLang && c.status === 'queued')}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
              >
                {busy?.startsWith('claim-') && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {tc.claim.action}
              </button>
            </div>
          )}
        </div>
      )}
      {minutes && (
        <CaptionTranscribe
          videoId={videoId}
          spokenLanguage={spokenLanguage}
          jobs={jobs}
          minutes={minutes}
          draftLanguages={(drafts ?? []).map((d) => d.language)}
          t={tc.jobs}
          lang={lang}
          cancelLabel={t.common?.cancel ?? tc.quran.cancel}
          confirm={confirm}
          label={label}
          reload={load}
        />
      )}
      <ul className="grid grid-cols-1 gap-3">
        {(drafts ?? []).map((d) => {
          const isPublished = d.track === 'machine' && d.publishedVersion !== undefined;
          const outdated = isPublished && d.publishedVersion !== d.version;
          const statusLabel = !isPublished ? tc.status.draft : outdated ? tc.status.outdated : tc.status.published;
          return (
            <li
              key={d.language}
              data-testid="caption-draft"
              data-language={d.language}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-foreground">{label(d.language)}</span>
                    <span
                      data-testid="caption-draft-status"
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        !isPublished ? 'bg-muted text-foreground' : outdated ? 'bg-brand-soft text-brand-ink' : 'border border-current text-[var(--fanous-color-success-text)]'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{tc.origin[d.origin]}</p>
                  {d.pendingQuran > 0 && (
                    <p className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink">
                      <BookOpen className="h-3.5 w-3.5" aria-hidden />
                      {tc.quranPending.replace('{count}', String(d.pendingQuran))}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="caption-draft-edit"
                    onClick={() => setEditing(d.language)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
                  >
                    <FilePenLine className="h-4 w-4" aria-hidden />
                    {tc.edit}
                  </button>
                  <button
                    type="button"
                    data-testid="caption-draft-publish"
                    onClick={() => void publish(d)}
                    disabled={!!busy || (isPublished && !outdated)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy === `publish-${d.language}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UploadCloud className="h-4 w-4" aria-hidden />}
                    {tc.publish}
                  </button>
                  <button
                    type="button"
                    data-testid="caption-draft-delete"
                    onClick={() => void remove(d)}
                    disabled={!!busy}
                    aria-label={tc.deleteDraft}
                    title={tc.deleteDraft}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-[var(--fanous-color-error-text)] hover:bg-muted disabled:opacity-50"
                  >
                    {busy === `delete-${d.language}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <CaptionDraftEditor
          videoId={videoId}
          language={editing}
          languageLabel={label(editing)}
          videoUrl={videoUrl}
          posterUrl={posterUrl}
          open
          onClose={() => {
            setEditing(null);
            void load();
          }}
          onChanged={(s) => {
            upsert(s);
            if (s?.publishedVersion === s?.version && s?.track === 'machine') onPublished?.();
          }}
        />
      )}
      {dialog}
    </section>
  );
}
