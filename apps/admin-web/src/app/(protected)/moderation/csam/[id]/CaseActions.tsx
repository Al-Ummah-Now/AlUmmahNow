'use client';

/**
 * A CSAM case's actions (docs/specs/CSAM-RESPONSE.md): the NCMEC CyberTipline checklist with each
 * report field pre-filled and copyable, "Reported" with the report id (the time is fixed once
 * recorded: it starts the retention clock), the legal hold, the takedown retry and the hand
 * mapping of a URL that did not resolve. Changes need a fresh sign-in (toResult sends the browser
 * through it and back here).
 */
import { useId, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useConfirm, useContentAction } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass, linkClass, primaryButtonClass } from '@/components/ui';
import { mapCsamCase, markCsamReported, retryCsamCase, setCsamLegalHold, type CsamHandMapping } from '@/lib/api/csam';
import { CopyButton } from '../CsamAdmin';
import { NCMEC_CYBERTIPLINE_URL, csamDownloadHref, csamFactsText, validReportId, type CsamFactId, type CsamFactRow } from '../model';

const labelClass = 'block text-sm font-medium text-fg mb-1';
const STEPS = ['open', 'type', 'fields', 'files', 'submit', 'record'] as const;

export function ReportChecklist({ caseId, rows, reported, canDownload, files }: { caseId: string; rows: CsamFactRow[]; reported: boolean; canDownload: boolean; files: string[] }) {
  const { t } = useLanguage();
  const id = useId();
  const label = (fact: CsamFactId) => t(`csamPage.facts.${fact}` as MessageKey);
  return (
    <section className={`${cardClass} ${reported ? '' : 'border-danger-border'}`} aria-labelledby={`${id}-title`} data-testid="csam-checklist" data-reported={reported ? 'true' : 'false'}>
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{t('csamPage.checklist.title')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t(reported ? 'csamPage.checklist.introReported' : 'csamPage.checklist.intro')}</p>
      <ol className="list-decimal ms-5 space-y-1 text-sm text-fg mb-4">
        {STEPS.map((step) => (
          <li key={step} data-testid={`csam-step-${step}`}>
            {step === 'open' ? (
              <>
                {t('csamPage.checklist.steps.open')}{' '}
                <a href={NCMEC_CYBERTIPLINE_URL} target="_blank" rel="noopener noreferrer" className={linkClass} data-testid="csam-cybertipline-link">
                  {t('csamPage.checklist.openForm')}
                </a>
              </>
            ) : (
              t(`csamPage.checklist.steps.${step}` as MessageKey)
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-fg">{t('csamPage.checklist.fieldsTitle')}</h3>
        <CopyButton value={csamFactsText(rows, label)} testId="csam-facts-copy-all" label={t('csamPage.checklist.copyAll')} />
      </div>
      <dl className="mb-4" data-testid="csam-facts">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-1 gap-1 py-2 border-t border-border sm:grid-cols-3 sm:items-center" data-testid="csam-fact" data-fact={r.id} data-filled={r.value ? 'true' : 'false'}>
            <dt className="text-sm text-fg-muted">{label(r.id)}</dt>
            <dd className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
              {r.value ? (
                <>
                  <span className="text-sm text-fg break-all" dir={r.ltr ? 'ltr' : undefined}>{r.value}</span>
                  <CopyButton value={r.value} testId={`csam-fact-copy-${r.id}`} />
                </>
              ) : (
                <span className="text-sm text-fg-subtle">{t(r.id === 'ipAddress' ? 'csamPage.checklist.notCollected' : 'csamPage.checklist.empty')}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {files.length > 0 && canDownload && (
        <div>
          <h3 className="font-semibold text-fg mb-1">{t('csamPage.checklist.filesTitle')}</h3>
          <ul className="space-y-1">
            {files.map((name) => (
              <li key={name} className="text-sm">
                <a href={csamDownloadHref(caseId, name)} className={linkClass} dir="ltr" rel="noreferrer">{name}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ReportedForm({ caseId, reportId, reportedAt, timeFixed }: { caseId: string; reportId: string | null; reportedAt: string | null; timeFixed: boolean }) {
  const { t, locale } = useLanguage();
  const id = useId();
  const { run, busy, error, message } = useContentAction();
  const [invalid, setInvalid] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const value = String(d.get('reportId') ?? '').trim();
    if (!validReportId(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const at = String(d.get('reportedAt') ?? '');
    await run('reported', () => markCsamReported(caseId, { reportId: value, ...(!timeFixed && at ? { reportedAt: new Date(at).toISOString() } : {}) }), {
      success: t(timeFixed ? 'csamPage.reported.corrected' : 'csamPage.reported.done'),
    });
  }

  return (
    <section className={cardClass} aria-labelledby={`${id}-title`} data-testid="csam-reported-form">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{t('csamPage.reported.title')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t(timeFixed ? 'csamPage.reported.fixedNote' : 'csamPage.reported.note')}</p>
      {reportedAt && reportId && (
        <p className="text-sm text-fg mb-3" data-testid="csam-reported-current">
          {t('csamPage.reported.current', { id: reportId, date: formatDate(reportedAt, locale, true) })}
        </p>
      )}
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 max-w-xl sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-rid`} className={labelClass}>{t('csamPage.reported.reportId')}</label>
          <input
            id={`${id}-rid`}
            name="reportId"
            required
            maxLength={64}
            pattern="[A-Za-z0-9\-]{3,64}"
            defaultValue={reportId ?? ''}
            dir="ltr"
            className={`${fieldClass} w-full`}
            aria-invalid={invalid}
            aria-describedby={`${id}-rid-hint`}
            data-testid="csam-report-id"
          />
          <p id={`${id}-rid-hint`} className={`text-xs mt-1 ${invalid ? 'text-danger-fg' : 'text-fg-muted'}`}>{t('csamPage.reported.reportIdHint')}</p>
        </div>
        {!timeFixed && (
          <div>
            <label htmlFor={`${id}-at`} className={labelClass}>{t('csamPage.reported.reportedAt')}</label>
            <input id={`${id}-at`} name="reportedAt" type="datetime-local" className={`${fieldClass} w-full`} aria-describedby={`${id}-at-hint`} data-testid="csam-reported-at" />
            <p id={`${id}-at-hint`} className="text-xs text-fg-muted mt-1">{t('csamPage.reported.reportedAtHint')}</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <ActionFeedback error={error} message={message} testId="csam-reported-feedback" />
          <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="csam-reported-submit">
            {busy ? t('content.working') : t(timeFixed ? 'csamPage.reported.correct' : 'csamPage.reported.submit')}
          </button>
        </div>
      </form>
    </section>
  );
}

export function HoldForm({ caseId, on, reason }: { caseId: string; on: boolean; reason: string | null }) {
  const { t } = useLanguage();
  const id = useId();
  const { run, busy, error, message } = useContentAction();
  return (
    <section className={cardClass} aria-labelledby={`${id}-title`} data-testid="csam-hold" data-on={on ? 'true' : 'false'}>
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{t('csamPage.hold.title')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t('csamPage.hold.note')}</p>
      {on && reason && <p className="text-sm text-fg mb-3" data-testid="csam-hold-reason">{t('csamPage.hold.current', { reason })}</p>}
      <ActionFeedback error={error} message={message} testId="csam-hold-feedback" />
      <ConfirmButton
        label={t(on ? 'csamPage.hold.lift' : 'csamPage.hold.set')}
        busy={busy !== null}
        title={t(on ? 'csamPage.hold.liftTitle' : 'csamPage.hold.setTitle')}
        body={t(on ? 'csamPage.hold.liftBody' : 'csamPage.hold.setBody')}
        confirmLabel={t(on ? 'csamPage.hold.lift' : 'csamPage.hold.set')}
        withReason
        reasonHint={t('csamPage.hold.reasonHint')}
        danger={on}
        testId="csam-hold-toggle"
        onConfirm={async (r) => {
          await run('hold', () => setCsamLegalHold(caseId, { on: !on, reason: (r ?? '').trim() }), { success: t(on ? 'csamPage.hold.lifted' : 'csamPage.hold.setDone') });
        }}
      />
    </section>
  );
}

export function RetryButton({ caseId }: { caseId: string }) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  return (
    <div className="mt-4" data-testid="csam-retry">
      <p className="text-sm text-fg-muted mb-2">{t('csamPage.retry.note')}</p>
      <ActionFeedback error={error} message={message} testId="csam-retry-feedback" />
      <button type="button" className={smallButtonClass} disabled={busy !== null} onClick={() => void run('retry', () => retryCsamCase(caseId), { success: t('csamPage.retry.done') })} data-testid="csam-retry-button">
        {busy ? t('content.working') : t('csamPage.retry.button')}
      </button>
    </div>
  );
}

type MapKind = CsamHandMapping['kind'];
const MAP_KINDS: MapKind[] = ['video', 'post', 'profile_image', 'channel_image'];

/** Builds the mapping from the form, or null when a field is missing. */
function mappingOf(kind: MapKind, d: FormData): CsamHandMapping | null {
  const v = (name: string) => String(d.get(name) ?? '').trim();
  if (kind === 'video') return v('videoId') ? { kind, videoId: v('videoId') } : null;
  if (kind === 'post') return v('channelId') && v('postId') ? { kind, channelId: v('channelId'), postId: v('postId') } : null;
  const field = v('field') === 'coverUrl' ? 'coverUrl' : 'avatarUrl';
  return v('ownerId') ? { kind, id: v('ownerId'), field } : null;
}

export function MapForm({ caseId }: { caseId: string }) {
  const { t } = useLanguage();
  const id = useId();
  const { run, busy, error, message } = useContentAction();
  const [kind, setKind] = useState<MapKind>('video');
  const { confirm, dialog } = useConfirm();

  const input = (name: string, labelKey: MessageKey) => (
    <div>
      <label htmlFor={`${id}-${name}`} className={labelClass}>{t(labelKey)}</label>
      <input id={`${id}-${name}`} name={name} required dir="ltr" maxLength={80} className={`${fieldClass} w-full`} data-testid={`csam-map-${name}`} />
    </div>
  );

  return (
    <section className={`${cardClass} border-danger-border`} aria-labelledby={`${id}-title`} data-testid="csam-map">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{t('csamPage.map.title')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t('csamPage.map.note')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const mapping = mappingOf(kind, new FormData(e.currentTarget));
          if (!mapping) return;
          // The mapping takes an item down and freezes an account: one more explicit confirmation
          const ok = await confirm({ title: t('csamPage.map.confirmTitle'), body: t('csamPage.map.confirm'), confirmLabel: t('csamPage.map.confirmYes'), danger: true, testId: 'csam-map-confirm' });
          if (ok) await run('map', () => mapCsamCase(caseId, mapping), { success: t('csamPage.map.done') });
        }}
        className="space-y-3 max-w-xl"
      >
        <fieldset>
          <legend className={labelClass}>{t('csamPage.map.kind')}</legend>
          <div className="flex flex-wrap gap-4">
            {MAP_KINDS.map((k) => (
              <label key={k} className="inline-flex items-center gap-2 text-sm text-fg">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} data-testid={`csam-map-kind-${k}`} />
                {t(`csamPage.map.kinds.${k}` as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
        {kind === 'video' && input('videoId', 'csamPage.map.videoId')}
        {kind === 'post' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {input('channelId', 'csamPage.map.channelId')}
            {input('postId', 'csamPage.map.postId')}
          </div>
        )}
        {(kind === 'profile_image' || kind === 'channel_image') && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {input('ownerId', kind === 'profile_image' ? 'csamPage.map.userId' : 'csamPage.map.channelId')}
            <div>
              <label htmlFor={`${id}-field`} className={labelClass}>{t('csamPage.map.field')}</label>
              <select id={`${id}-field`} name="field" className={`${fieldClass} w-full`} data-testid="csam-map-field">
                <option value="avatarUrl">{t('csamPage.map.avatar')}</option>
                <option value="coverUrl">{t('csamPage.map.cover')}</option>
              </select>
            </div>
          </div>
        )}
        <ActionFeedback error={error} message={message} testId="csam-map-feedback" />
        <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="csam-map-submit">
          {busy ? t('content.working') : t('csamPage.map.submit')}
        </button>
      </form>
      {dialog}
    </section>
  );
}

