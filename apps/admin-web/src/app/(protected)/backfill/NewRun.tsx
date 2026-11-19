'use client';

/** Pick a scope and ask for the estimate; nothing is copied or transcoded until the admin presses Start. */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BACKFILL_LIMITS, parseBackfillScope, type BackfillScope, type BackfillScopeKind } from '@al-ummah/shared-types';
import { createBackfillRun } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { useFormats } from './useFormats';
import { Autocomplete } from '@/components/search/Autocomplete';
import { logger } from '@/lib/logger-client';
import { DateField } from '@/components/DateField';


const KINDS: { kind: BackfillScopeKind; label: MessageKey; hint: MessageKey }[] = [
  { kind: 'all', label: 'mediaBackfill.scopeAll', hint: 'mediaBackfill.scopeAllHint' },
  { kind: 'channel', label: 'mediaBackfill.scopeChannel', hint: 'mediaBackfill.scopeChannelHint' },
  { kind: 'dates', label: 'mediaBackfill.scopeDates', hint: 'mediaBackfill.scopeDatesHint' },
  { kind: 'videos', label: 'mediaBackfill.scopeVideos', hint: 'mediaBackfill.scopeVideosHint' },
];

export function NewRun() {
  const { t } = useLanguage();
  const f = useFormats();
  const router = useRouter();
  const [kind, setKind] = useState<BackfillScopeKind>('all');
  const [channelId, setChannelId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [videoIds, setVideoIds] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { from: useId(), to: useId(), videos: useId(), missing: useId(), legend: useId() };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft: BackfillScope = {
      kind,
      onlyMissing,
      ...(kind === 'channel' ? { channelId: channelId.trim() } : {}),
      ...(kind === 'dates' ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : {}),
      ...(kind === 'videos' ? { videoIds: videoIds.split(/[\s,]+/).filter(Boolean) } : {}),
    };
    const parsed = parseBackfillScope(draft);
    if (!parsed.ok) {
      setError(t('mediaBackfill.scopeInvalid', { reason: 'error' in parsed ? parsed.error : '' }));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createBackfillRun(parsed.scope);
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] new run failed', { status: res.status, kind });
      setError(t('mediaBackfill.createFailed', { reason: res.error }));
      return;
    }
    router.push(`/backfill?run=${encodeURIComponent(res.data.run.id)}`);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className={cardClass} aria-labelledby="backfill-new-title" data-testid="backfill-new">
      <h2 id="backfill-new-title" className="text-xl font-semibold text-fg">{t('mediaBackfill.newTitle')}</h2>
      <p className="text-sm text-fg-muted mt-1 mb-4">{t('mediaBackfill.newHint')}</p>
      {error && <ErrorAlert testId="backfill-new-error">{error}</ErrorAlert>}
      <fieldset aria-describedby={ids.legend}>
        <legend className="text-sm font-medium text-fg mb-2">{t('mediaBackfill.scope')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.kind} className={`flex gap-3 rounded border p-3 cursor-pointer ${kind === k.kind ? 'border-accent bg-surface-2' : 'border-border'}`}>
              <input type="radio" name="backfill-scope" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="mt-1 h-4 w-4" data-testid={`backfill-scope-${k.kind}`} />
              <span>
                <span className="block font-medium text-fg">{t(k.label)}</span>
                <span className="block text-xs text-fg-muted">{t(k.hint)}</span>
              </span>
            </label>
          ))}
        </div>
        <p id={ids.legend} className="sr-only">{t('mediaBackfill.newHint')}</p>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {kind === 'channel' && (
          <div className="sm:col-span-2">
            <Autocomplete kind="channel" mode="pick" label={t('mediaBackfill.channelId')} defaultValue={channelId} onChange={(id) => setChannelId(id)} testId="backfill-channel" />
          </div>
        )}
        {kind === 'dates' && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.from} className="text-sm font-medium text-fg">{t('mediaBackfill.from')}</label>
              <DateField id={ids.from} value={from} onChange={(iso) => setFrom(iso ?? '')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.to} className="text-sm font-medium text-fg">{t('mediaBackfill.to')}</label>
              <DateField id={ids.to} value={to} onChange={(iso) => setTo(iso ?? '')} />
            </div>
          </>
        )}
        {kind === 'videos' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={ids.videos} className="text-sm font-medium text-fg">{t('mediaBackfill.videoIds')}</label>
            <textarea id={ids.videos} rows={4} value={videoIds} onChange={(e) => setVideoIds(e.target.value)} className={`${fieldClass} font-mono text-sm`} dir="ltr" required data-testid="backfill-video-ids" />
            <p className="text-xs text-fg-muted">{t('mediaBackfill.videoIdsHint', { max: f.integer(BACKFILL_LIMITS.maxVideoIds) })}</p>
          </div>
        )}
      </div>

      <label htmlFor={ids.missing} className="mt-4 flex items-start gap-3">
        <input id={ids.missing} type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="mt-1 h-4 w-4" data-testid="backfill-only-missing" />
        <span>
          <span className="block text-sm font-medium text-fg">{t('mediaBackfill.onlyMissing')}</span>
          <span className="block text-xs text-fg-muted">{t('mediaBackfill.onlyMissingHint')}</span>
        </span>
      </label>

      <button type="submit" disabled={busy} className={`${primaryButtonClass} mt-5`} data-testid="backfill-estimate-button">{busy ? t('mediaBackfill.estimatingShort') : t('mediaBackfill.estimate')}</button>
    </form>
  );
}
