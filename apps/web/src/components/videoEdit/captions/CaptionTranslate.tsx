'use client';

/**
 * Translate a caption draft (AUN-CAPTIONS §3.3): the target languages, the caption-minutes cost
 * before confirming (one video length per language), each language's running translation with its
 * step and Cancel, and why one failed with the minutes given back. Quran is never
 * machine-translated: confirmed ayat show in the channel's chosen Quran Foundation translation.
 * Never automatic: the creator asks for it, and checks each translated draft before publishing.
 */
import React, { useId, useState } from 'react';
import { BookOpen, Languages, Loader2, X } from 'lucide-react';
import { FEATURE_OFF_CODE, captionMinutesCanStart, isCaptionJobActive, type CaptionMinutesUsage, type CaptionsTranslations, fillTemplate, type TemplateParams } from '@al-ummah/shared-types';
import { reportError } from '@/lib/errors/reporter';
import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';
import { cancelCaptionJob, startCaptionTranslation, type CaptionJobView } from '@/lib/api/caption-drafts';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { jobStepText, visibleJobs, type CaptionMinutes } from './CaptionTranscribe';

/** The most target languages one request may ask for (api-videos MAX_TRANSLATION_TARGETS). */
export const MAX_TRANSLATION_LANGUAGES = 6;

export interface CaptionTranslateProps {
  videoId: string;
  sourceLanguage: string;
  /** Translate jobs of the video (any source) */
  jobs: CaptionJobView[];
  minutes: CaptionMinutes;
  draftLanguages: string[];
  t: CaptionsTranslations;
  lang: string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  label: (code: string) => string;
  reload: () => Promise<void>;
  onClose: () => void;
  /** The server answered 404 feature_off (translation switched off meanwhile): the features are read again */
  onFeatureOff?: () => void;
}

/** Fills {name} placeholders; numbers in the page's digits (locale-format). */
const fillIn = (lang: string, template: string, values: TemplateParams) => fillTemplate(lang === 'ar' ? 'ar' : 'en', template, values);

/** Running and failed translations, newest per target language. */
export function TranslationJobs({ videoId, jobs, t, lang = 'en', label, confirm, reload }: Pick<CaptionTranslateProps, 'videoId' | 'jobs' | 't' | 'label' | 'confirm' | 'reload'> & { lang?: string }) {
  const fill = (template: string, values: TemplateParams) => fillIn(lang, template, values);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = visibleJobs(jobs.filter((j) => j.kind === 'translate'));
  if (!shown.length && !notice) return null;

  const cancel = async (job: CaptionJobView) => {
    const yes = await confirm({ title: t.translate.cancelTitle, description: t.translate.cancelBody, confirmLabel: t.translate.cancelConfirm, cancelLabel: t.translate.keep, danger: true });
    if (!yes) return;
    setBusy(job.id);
    const res = await cancelCaptionJob(videoId, job.id);
    setBusy(null);
    if (!res.ok) {
      setNotice(res.error === 'job_finishing' ? t.jobs.finishing : t.jobs.cancelFailed);
      if (res.status >= 500 || res.status === 0) reportError(new Error(`caption translation cancel failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, jobId: job.id } });
    } else {
      setNotice(t.jobs.cancelled);
    }
    await reload();
  };

  return (
    <div data-testid="caption-translations" className="space-y-2">
      {notice && (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((job) =>
          job.status === 'failed' ? (
            <li key={job.id} data-testid="caption-translation-failed" data-language={job.language} className="space-y-1 text-sm">
              <p role="alert" className="text-[var(--fanous-color-error-text)]">
                {label(job.language)}: {t.jobs.failed[job.error ?? 'failed']}
              </p>
              {job.minutesReserved > 0 && !job.waived && <p className="text-xs text-muted-foreground">{fill(t.jobs.refunded, { minutes: job.minutesReserved })}</p>}
            </li>
          ) : (
            <li key={job.id} data-testid="caption-translation-job" data-language={job.language} data-status={job.status} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-ink">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {fill(t.jobs.chip, { language: label(job.language), step: jobStepText(t.jobs, job, lang) })}
                </span>
                <button
                  type="button"
                  data-testid="caption-translation-cancel"
                  onClick={() => void cancel(job)}
                  disabled={!!busy || job.status === 'postprocessing'}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {busy === job.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                  {t.jobs.cancel}
                </button>
              </div>
              {job.status === 'waiting_budget' && <p className="text-xs text-muted-foreground">{t.jobs.waitingBudgetHint}</p>}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** The Translate form for one source draft (opened from its row). */
export default function CaptionTranslate({ videoId, sourceLanguage, jobs, minutes, draftLanguages, t, lang, confirm, label, reload, onClose, onFeatureOff }: CaptionTranslateProps) {
  const fill = (template: string, values: TemplateParams) => fillIn(lang, template, values);
  const ids = useId();
  const tt = t.translate;
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<CaptionMinutes | null>(null);
  const { usage, minutesNeeded } = refusal ?? minutes;
  const running = new Set(jobs.filter((j) => j.kind === 'translate' && isCaptionJobActive(j.status)).map((j) => j.language));
  const targets = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLanguage);
  const total = minutesNeeded === null ? null : minutesNeeded * Math.max(1, chosen.length);
  const canStart = captionMinutesCanStart(usage);

  const costText = (needed: number) => {
    if (usage.unlimited) return fill(tt.costUnlimited, { minutes: needed });
    const remaining = usage.remaining ?? 0;
    return needed > remaining ? fill(tt.costOver, { minutes: needed, remaining, over: needed - remaining }) : fill(tt.cost, { minutes: needed, remaining });
  };

  const toggle = (code: string, on: boolean) => setChosen((list) => (on ? (list.length >= MAX_TRANSLATION_LANGUAGES ? list : [...list, code]) : list.filter((c) => c !== code)));

  const start = async (replace = false) => {
    if (!chosen.length || total === null) return;
    setNotice(null);
    const existing = chosen.filter((c) => draftLanguages.includes(c));
    if (!replace && existing.length) {
      const names = existing.map(label).join(lang === 'ar' ? '، ' : ', ');
      const yes = await confirm({ title: fill(tt.replaceTitle, { language: names }), description: `${fill(tt.replaceBody, { language: names })} ${costText(total)}`, confirmLabel: tt.replace, cancelLabel: tt.cancel, danger: true });
      if (!yes) return;
      replace = true;
    } else if (!replace) {
      const yes = await confirm({ title: tt.title, description: `${costText(total)} ${tt.quranNote}`, confirmLabel: tt.confirm, cancelLabel: tt.cancel, danger: false });
      if (!yes) return;
    }
    setBusy(true);
    const res = await startCaptionTranslation(videoId, sourceLanguage, chosen, replace);
    setBusy(false);
    if (!res.ok) {
      if (res.status === 404 && res.error === FEATURE_OFF_CODE) {
        onFeatureOff?.();
        onClose();
      } else if (res.status === 402 && res.details?.usage) {
        setRefusal({ usage: res.details.usage as CaptionMinutesUsage, minutesNeeded });
        setNotice(tt.noMinutes);
      } else if (res.error === 'draft_exists' && !replace) {
        const language = typeof res.details?.language === 'string' ? label(res.details.language) : '';
        const yes = await confirm({ title: fill(tt.replaceTitle, { language }), description: fill(tt.replaceBody, { language }), confirmLabel: tt.replace, cancelLabel: tt.cancel, danger: true });
        if (yes) await start(true);
      } else {
        setNotice(res.error === 'video_not_ready' ? tt.notReady : tt.requestFailed);
        if (res.status >= 500 || res.status === 0) reportError(new Error(`caption translation failed: ${res.error}`), { shown: true, status: res.status, extra: { videoId, sourceLanguage } });
      }
      return;
    }
    setRefusal(null);
    setNotice(tt.started);
    setChosen([]);
    await reload();
  };

  return (
    <div data-testid="caption-translate" className="mt-3 space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Languages className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{tt.title}</p>
          <p className="max-w-prose text-xs text-muted-foreground">{fill(tt.body, { language: label(sourceLanguage) })}</p>
        </div>
      </div>
      <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {tt.quranNote}
      </p>
      <fieldset disabled={busy}>
        <legend className="text-xs font-medium text-foreground">{tt.languagesLabel}</legend>
        <p id={`${ids}-limit`} className="text-xs text-muted-foreground">
          {fill(tt.limit, { count: MAX_TRANSLATION_LANGUAGES })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2" aria-describedby={`${ids}-limit`}>
          {targets.map((l) => {
            const on = chosen.includes(l.code);
            const disabled = running.has(l.code) || (!on && chosen.length >= MAX_TRANSLATION_LANGUAGES);
            return (
              <label
                key={l.code}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${on ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border bg-background text-foreground'} has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring`}
              >
                <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={(e) => toggle(l.code, e.target.checked)} data-testid={`caption-translate-lang-${l.code}`} />
                <span lang={l.code} dir="auto">
                  {lang === 'ar' ? l.nameAr : l.name}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p data-testid="caption-translate-cost" className="text-xs text-muted-foreground">
        {minutesNeeded === null ? tt.notReady : chosen.length ? costText(total ?? 0) : null}
      </p>
      {notice && (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="caption-translate-action"
          onClick={() => void start()}
          disabled={busy || !chosen.length || minutesNeeded === null || !canStart}
          className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {tt.confirm}
        </button>
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted">
          {tt.cancel}
        </button>
      </div>
      {!canStart && <p className="text-xs text-[var(--fanous-color-error-text)]">{tt.noMinutes}</p>}
    </div>
  );
}
