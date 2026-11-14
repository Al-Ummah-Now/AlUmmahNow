'use client';

/**
 * Transcribe on request (AUN-CAPTIONS §3.1): the caption minutes meter, the spoken language
 * (from the video's language), the cost line before confirming, each language's running job with
 * its step and Cancel, and why a job failed with the minutes given back. A 402 or a cost above
 * what is left shows the plan's minutes and the contact path instead of starting anything.
 * CaptionDraftsPanel loads the jobs and minutes and polls while a job runs.
 */
import React, { useId, useState } from 'react';
import { AlertTriangle, AudioLines, Loader2, X } from 'lucide-react';
import { isCaptionJobActive, type CaptionMinutesUsage, type CaptionsTranslations } from '@al-ummah/shared-types';
import { reportError } from '@/lib/errors/reporter';
import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';
import { cancelCaptionJob, startCaptionJob, type CaptionJobView } from '@/lib/api/caption-drafts';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';

export interface CaptionMinutes {
  usage: CaptionMinutesUsage;
  minutesNeeded: number | null;
}

export interface CaptionTranscribeProps {
  videoId: string;
  /** The video's language, when it is one language (the picker's first choice) */
  spokenLanguage?: string;
  jobs: CaptionJobView[];
  minutes: CaptionMinutes;
  draftLanguages: string[];
  t: CaptionsTranslations['jobs'];
  lang: string;
  cancelLabel: string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  label: (code: string) => string;
  /** Something changed: jobs, minutes and drafts reload */
  reload: () => Promise<void>;
}

/** The newest job of each language, when it is running or failed (a ready job is its draft; a cancelled one is gone). */
export function visibleJobs(jobs: CaptionJobView[]): CaptionJobView[] {
  const seen = new Set<string>();
  const out: CaptionJobView[] = [];
  for (const job of jobs) {
    if (seen.has(job.language)) continue;
    seen.add(job.language);
    if (isCaptionJobActive(job.status) || job.status === 'failed') out.push(job);
  }
  return out;
}

export function jobStepText(t: CaptionsTranslations['jobs'], job: CaptionJobView): string {
  switch (job.status) {
    case 'transcribing':
      return job.progress && job.progress.total > 0 ? t.step.transcribing.replace('{done}', String(job.progress.done)).replace('{total}', String(job.progress.total)) : t.step.transcribingStart;
    case 'queued':
    case 'waiting_budget':
    case 'extracting':
    case 'postprocessing':
      return t.step[job.status];
    default:
      return '';
  }
}

const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);

export default function CaptionTranscribe({ videoId, spokenLanguage, jobs, minutes, draftLanguages, t, lang, cancelLabel, confirm, label, reload }: CaptionTranscribeProps) {
  const languageId = useId();
  const [language, setLanguage] = useState(spokenLanguage && SUPPORTED_LANGUAGES.some((l) => l.code === spokenLanguage) ? spokenLanguage : 'ar');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set by a 402: the server's view of the minutes wins over the loaded one */
  const [refusal, setRefusal] = useState<CaptionMinutes | null>(null);

  const { usage, minutesNeeded } = refusal ?? minutes;
  const resets = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(usage.resetsAt));
  const shown = visibleJobs(jobs);
  /** One job at a time: while one runs, its chip replaces the form */
  const running = shown.some((j) => isCaptionJobActive(j.status));
  const retry = shown.some((j) => j.language === language && j.status === 'failed');
  const noPlan = !usage.unlimited && usage.via === 'none' && (usage.remaining ?? 0) <= 0;
  const short = !usage.unlimited && !noPlan && minutesNeeded !== null && usage.remaining !== null && minutesNeeded > usage.remaining;

  const report = (what: string, status: number, error: string) => {
    if (status >= 500 || status === 0) reportError(new Error(`caption job ${what} failed: ${error}`), { shown: true, status, extra: { videoId, language } });
  };

  const start = async (code: string, replace = false) => {
    setNotice(null);
    if (minutesNeeded === null) return;
    if (!replace && draftLanguages.includes(code)) {
      const yes = await confirm({ title: t.replaceTitle, description: fill(t.replaceBody, { language: label(code) }), confirmLabel: t.action, cancelLabel, danger: true });
      if (!yes) return;
      replace = true;
    } else {
      const description = usage.unlimited ? fill(t.costUnlimited, { minutes: minutesNeeded }) : fill(t.cost, { minutes: minutesNeeded, remaining: usage.remaining ?? 0 });
      const yes = await confirm({ title: t.confirmTitle, description, confirmLabel: t.action, cancelLabel, danger: false });
      if (!yes) return;
    }
    setBusy(`start-${code}`);
    const res = await startCaptionJob(videoId, code, replace);
    setBusy(null);
    if (!res.ok) {
      if (res.status === 402 && res.details?.usage) {
        setRefusal({ usage: res.details.usage as CaptionMinutesUsage, minutesNeeded: typeof res.details.minutesNeeded === 'number' ? res.details.minutesNeeded : minutesNeeded });
      } else if (res.error === 'draft_exists' && !replace) {
        // A draft appeared since the list loaded
        const yes = await confirm({ title: t.replaceTitle, description: fill(t.replaceBody, { language: label(code) }), confirmLabel: t.action, cancelLabel, danger: true });
        if (yes) await start(code, true);
        else await reload();
      } else {
        setNotice(res.error === 'video_not_ready' ? t.notReady : res.status === 503 ? t.paused : t.requestFailed);
        report('start', res.status, res.error);
      }
      return;
    }
    setRefusal(null);
    await reload();
  };

  const cancel = async (job: CaptionJobView) => {
    const yes = await confirm({ title: t.cancelTitle, description: t.cancelBody, confirmLabel: t.cancelConfirm, cancelLabel: t.keep, danger: true });
    if (!yes) return;
    setNotice(null);
    setBusy(`cancel-${job.id}`);
    const res = await cancelCaptionJob(videoId, job.id);
    setBusy(null);
    if (!res.ok) {
      setNotice(res.error === 'job_finishing' ? t.finishing : t.cancelFailed);
      report('cancel', res.status, res.error);
    } else {
      setNotice(t.cancelled);
    }
    await reload();
  };

  return (
    <div data-testid="caption-transcribe" className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AudioLines className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-foreground">{t.title}</h4>
          <p className="max-w-prose text-xs text-muted-foreground">{t.body}</p>
        </div>
      </div>

      <div data-testid="caption-minutes" className="space-y-1">
        <p className="text-xs font-medium text-foreground">
          {usage.unlimited ? t.meterUnlimited : fill(t.meter, { used: usage.monthUsed, limit: usage.monthLimit ?? 0, date: resets })}
          {!usage.unlimited && usage.packsRemaining > 0 && <span className="text-muted-foreground"> · {fill(t.meterPacks, { count: usage.packsRemaining })}</span>}
        </p>
        {!usage.unlimited && usage.monthLimit ? (
          <div
            role="meter"
            aria-label={t.meterLabel}
            aria-valuemin={0}
            aria-valuemax={usage.monthLimit}
            aria-valuenow={Math.min(usage.monthUsed, usage.monthLimit)}
            className="h-2 max-w-md overflow-hidden rounded-full bg-muted-foreground/25"
          >
            <div
              className={`h-full rounded-full ${(usage.remaining ?? 1) <= 0 ? 'bg-[var(--fanous-color-error-fill)]' : usage.warning ? 'bg-brand-ink' : 'bg-brand'}`}
              style={{ width: `${Math.min(100, (usage.monthUsed / usage.monthLimit) * 100)}%` }}
            />
          </div>
        ) : null}
        {usage.warning && !usage.unlimited && (
          <p data-testid="caption-minutes-warning" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t.meterWarning}
          </p>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((job) =>
            job.status === 'failed' ? (
              <li key={job.id} role="alert" data-testid="caption-job-failed" data-language={job.language} className="space-y-1 text-sm">
                <p className="text-[var(--fanous-color-error-text)]">
                  {label(job.language)}: {t.failed[job.error ?? 'failed']}
                </p>
                {job.minutesReserved > 0 && !job.waived && <p className="text-xs text-muted-foreground">{fill(t.refunded, { minutes: job.minutesReserved })}</p>}
              </li>
            ) : (
              <li key={job.id} data-testid="caption-job" data-language={job.language} data-status={job.status} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-ink">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {fill(t.chip, { language: label(job.language), step: jobStepText(t, job) })}
                  </span>
                  <button
                    type="button"
                    data-testid="caption-job-cancel"
                    onClick={() => void cancel(job)}
                    disabled={!!busy || job.status === 'postprocessing'}
                    className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {busy === `cancel-${job.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                    {t.cancel}
                  </button>
                </div>
                {job.status === 'waiting_budget' && <p className="text-xs text-muted-foreground">{t.waitingBudgetHint}</p>}
              </li>
            ),
          )}
        </ul>
      )}

      {noPlan || short ? (
        <div data-testid="caption-minutes-short" className="space-y-1 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
          <p>{noPlan ? t.noPlan : fill(t.notEnough, { minutes: minutesNeeded ?? 0, remaining: usage.remaining ?? 0, date: resets })}</p>
          <a href={`/${lang === 'ar' ? 'ar' : 'en'}/contact`} className="font-medium text-brand-ink underline underline-offset-2 hover:no-underline">
            {t.contact}
          </a>
        </div>
      ) : running ? null : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={languageId} className="text-xs font-medium text-foreground">
                {t.languageLabel}
              </label>
              <select id={languageId} value={language} onChange={(e) => setLanguage(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {lang === 'ar' ? l.nameAr : l.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              data-testid="caption-transcribe-action"
              onClick={() => void start(language)}
              disabled={!!busy || minutesNeeded === null}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
            >
              {busy?.startsWith('start-') && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {retry ? t.tryAgain : t.action}
            </button>
          </div>
          <p data-testid="caption-transcribe-cost" className="text-xs text-muted-foreground">
            {minutesNeeded === null ? t.notReady : usage.unlimited ? fill(t.costUnlimited, { minutes: minutesNeeded }) : fill(t.cost, { minutes: minutesNeeded, remaining: usage.remaining ?? 0 })}
          </p>
        </div>
      )}
    </div>
  );
}
