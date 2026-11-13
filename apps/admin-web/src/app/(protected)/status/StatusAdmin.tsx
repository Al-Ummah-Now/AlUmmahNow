'use client';

/**
 * The Status page's forms (docs/status-page/README.md): post an incident or a
 * scheduled maintenance (en + ar), add updates (resolving closes it), delete
 * (restorable for 30 days), restore, delete permanently. Every change goes
 * through admin-api /api/status (status:manage).
 */
import { useId, useState } from 'react';
import { INCIDENT_IMPACTS, INCIDENT_STATUSES, MAINTENANCE_STATUSES, STATUS_COMPONENTS, STATUS_TEXT_LIMITS } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { createIncident, deleteIncident, postIncidentUpdate, purgeIncident, restoreIncident } from '@/lib/api/status';
import type { StatusIncident } from '@/lib/api/status-types';

type Kind = 'incident' | 'maintenance';
const labelClass = 'block text-sm font-medium text-fg mb-1';

function TextPair({ prefix, kind, label, max, multiline, testId }: { prefix: string; kind: 'title' | 'body'; label: { en: string; ar: string }; max: number; multiline?: boolean; testId: string }) {
  const id = useId();
  const field = (lang: 'en' | 'ar') => {
    const props = {
      id: `${id}-${lang}`,
      name: `${prefix}${kind === 'title' ? 'Title' : 'Body'}${lang === 'en' ? 'En' : 'Ar'}`,
      required: true,
      maxLength: max,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      lang,
      className: `${fieldClass} w-full`,
      'data-testid': `${testId}-${lang}`,
    } as const;
    return (
      <div>
        <label htmlFor={props.id} className={labelClass}>{label[lang]}</label>
        {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" />}
      </div>
    );
  };
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{field('en')}{field('ar')}</div>;
}

export function NewIncidentForm() {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const [kind, setKind] = useState<Kind>('incident');
  const statuses = kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const components = d.getAll('components').map(String);
    if (!components.length) return;
    const local = (v: FormDataEntryValue | null) => (v ? new Date(String(v)).toISOString() : undefined);
    const done = await run(
      'create',
      () =>
        createIncident({
          kind,
          titleEn: String(d.get('newTitleEn') ?? ''),
          titleAr: String(d.get('newTitleAr') ?? ''),
          bodyEn: String(d.get('newBodyEn') ?? ''),
          bodyAr: String(d.get('newBodyAr') ?? ''),
          status: String(d.get('status') ?? ''),
          impact: kind === 'incident' ? String(d.get('impact') ?? '') : undefined,
          components,
          startsAt: local(d.get('startsAt')),
          endsAt: local(d.get('endsAt')),
        }),
      { success: t(kind === 'incident' ? 'statusPage.created' : 'statusPage.maintenanceCreated') },
    );
    if (done) form.reset();
  }

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="status-new-title" data-testid="status-new">
      <h2 id="status-new-title" className="text-lg font-semibold text-fg mb-3">{t('statusPage.new.title')}</h2>
      <form onSubmit={submit} className="space-y-4" data-testid="status-new-form">
        <fieldset>
          <legend className={labelClass}>{t('statusPage.new.kind')}</legend>
          <div className="flex flex-wrap gap-4">
            {(['incident', 'maintenance'] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2 text-fg">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} data-testid={`status-kind-${k}`} />
                {t(`statusPage.kinds.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <TextPair prefix="new" kind="title" label={{ en: t('statusPage.new.titleEn'), ar: t('statusPage.new.titleAr') }} max={STATUS_TEXT_LIMITS.title} testId="status-title" />
        <TextPair prefix="new" kind="body" label={{ en: t('statusPage.new.bodyEn'), ar: t('statusPage.new.bodyAr') }} max={STATUS_TEXT_LIMITS.body} multiline testId="status-body" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="status-status" className={labelClass}>{t('statusPage.new.status')}</label>
            <select id="status-status" name="status" className={`${fieldClass} w-full`} key={kind} data-testid="status-status">
              {statuses.map((s) => <option key={s} value={s}>{t(`statusPage.statuses.${s}` as MessageKey)}</option>)}
            </select>
          </div>
          {kind === 'incident' && (
            <div>
              <label htmlFor="status-impact" className={labelClass}>{t('statusPage.new.impact')}</label>
              <select id="status-impact" name="impact" defaultValue="partial" className={`${fieldClass} w-full`} data-testid="status-impact">
                {INCIDENT_IMPACTS.map((s) => <option key={s} value={s}>{t(`statusPage.impacts.${s}` as MessageKey)}</option>)}
              </select>
            </div>
          )}
        </div>
        {kind === 'maintenance' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="status-starts" className={labelClass}>{t('statusPage.new.startsAt')}</label>
              <input id="status-starts" name="startsAt" type="datetime-local" required className={`${fieldClass} w-full`} data-testid="status-starts" />
            </div>
            <div>
              <label htmlFor="status-ends" className={labelClass}>{t('statusPage.new.endsAt')}</label>
              <input id="status-ends" name="endsAt" type="datetime-local" required className={`${fieldClass} w-full`} data-testid="status-ends" />
            </div>
            <p className="text-sm text-fg-muted md:col-span-2">{t('statusPage.new.localTime')}</p>
          </div>
        )}
        <fieldset>
          <legend className={labelClass}>{t('statusPage.new.components')}</legend>
          <p className="text-sm text-fg-muted mb-2">{t('statusPage.new.componentsNote')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STATUS_COMPONENTS.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-2 text-fg">
                <input type="checkbox" name="components" value={c.id} data-testid={`status-component-${c.id}`} />
                {c[locale === 'ar' ? 'ar' : 'en']}
                {!c.public && <span className="text-xs text-fg-muted">({t('statusPage.adminOnly')})</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <ActionFeedback error={error} message={message} testId="status-new-feedback" />
        <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="status-new-submit">
          {busy === 'create' ? t('content.working') : t(kind === 'incident' ? 'statusPage.new.postIncident' : 'statusPage.new.schedule')}
        </button>
      </form>
    </section>
  );
}

function UpdateForm({ incident }: { incident: StatusIncident }) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const statuses = incident.kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const done = await run(
      `update:${incident.id}`,
      () =>
        postIncidentUpdate(incident.id, {
          status: String(d.get('status') ?? ''),
          bodyEn: String(d.get('updBodyEn') ?? ''),
          bodyAr: String(d.get('updBodyAr') ?? ''),
          ...(incident.kind === 'incident' ? { impact: String(d.get('impact') ?? incident.impact) } : {}),
        }),
      { success: t('statusPage.updated') },
    );
    if (done) form.reset();
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-border pt-4" data-testid={`status-update-form-${incident.id}`}>
      <h4 className="font-medium text-fg">{t('statusPage.update.title')}</h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`st-${incident.id}`} className={labelClass}>{t('statusPage.new.status')}</label>
          <select id={`st-${incident.id}`} name="status" defaultValue={incident.status} className={`${fieldClass} w-full`} data-testid="status-update-status">
            {statuses.map((s) => <option key={s} value={s}>{t(`statusPage.statuses.${s}` as MessageKey)}</option>)}
          </select>
        </div>
        {incident.kind === 'incident' && (
          <div>
            <label htmlFor={`im-${incident.id}`} className={labelClass}>{t('statusPage.new.impact')}</label>
            <select id={`im-${incident.id}`} name="impact" defaultValue={incident.impact} className={`${fieldClass} w-full`}>
              {INCIDENT_IMPACTS.map((s) => <option key={s} value={s}>{t(`statusPage.impacts.${s}` as MessageKey)}</option>)}
            </select>
          </div>
        )}
      </div>
      <TextPair prefix="upd" kind="body" label={{ en: t('statusPage.new.bodyEn'), ar: t('statusPage.new.bodyAr') }} max={STATUS_TEXT_LIMITS.body} multiline testId="status-update-body" />
      <ActionFeedback error={error} message={message} />
      <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="status-update-submit">
        {busy ? t('content.working') : t('statusPage.update.post')}
      </button>
    </form>
  );
}

export function IncidentCard({ incident, open }: { incident: StatusIncident; open: boolean }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const title = locale === 'ar' ? incident.titleAr : incident.titleEn;
  const names = incident.components.map((id) => STATUS_COMPONENTS.find((c) => c.id === id)?.[locale === 'ar' ? 'ar' : 'en'] ?? id);
  return (
    <article className={`${cardClass} mb-4`} data-testid="status-incident" data-id={incident.id} data-status={incident.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg" dir="auto">{title}</h3>
          <p className="text-sm text-fg-muted">
            {t(`statusPage.kinds.${incident.kind}`)} · {t(`statusPage.statuses.${incident.status}` as MessageKey)}
            {incident.kind === 'incident' && <> · {t(`statusPage.impacts.${incident.impact}` as MessageKey)}</>}
          </p>
          <p className="text-sm text-fg-muted">{t('statusPage.affected', { list: names.join(locale === 'ar' ? '، ' : ', ') })}</p>
          {incident.kind === 'maintenance' && incident.endsAt && (
            <p className="text-sm text-fg-muted">{t('statusPage.window', { from: formatDate(incident.startsAt, locale, true), to: formatDate(incident.endsAt, locale, true) })}</p>
          )}
        </div>
        <ConfirmButton
          label={t('statusPage.delete')}
          title={t('statusPage.deleteTitle', { name: title })}
          body={t('statusPage.deleteBody')}
          confirmLabel={t('statusPage.delete')}
          danger
          busy={busy === 'delete'}
          disabled={busy !== null}
          testId={`status-delete-${incident.id}`}
          onConfirm={() => run('delete', () => deleteIncident(incident.id), { success: t('statusPage.deleted') })}
        />
      </div>
      <ActionFeedback error={error} message={message} />
      <ol className="mt-3 space-y-2" aria-label={t('statusPage.updatesLabel')}>
        {(incident.updates ?? []).map((u) => (
          <li key={u.id} className="border-s-2 border-border ps-3">
            <p className="text-sm text-fg-muted">
              <strong className="text-fg">{t(`statusPage.statuses.${u.status}` as MessageKey)}</strong> · {formatDate(u.createdAt, locale, true)}
            </p>
            <p className="whitespace-pre-line text-fg" dir="auto">{locale === 'ar' ? u.bodyAr : u.bodyEn}</p>
          </li>
        ))}
      </ol>
      {open && <UpdateForm incident={incident} />}
    </article>
  );
}

export function DeletedIncidents({ items }: { items: StatusIncident[] }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  if (!items.length) return <p className="text-fg-muted" data-testid="status-deleted-empty">{t('statusPage.deletedEmpty')}</p>;
  return (
    <div>
      <ActionFeedback error={error} message={message} />
      <ul className="space-y-3">
        {items.map((i) => {
          const title = locale === 'ar' ? i.titleAr : i.titleEn;
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3" data-testid="status-deleted-row" data-id={i.id}>
              <div>
                <p className="font-medium text-fg" dir="auto">{title}</p>
                {i.purgeAfter && <p className="text-sm text-fg-muted">{t('statusPage.purgeAfter', { date: formatDate(i.purgeAfter, locale) })}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <ConfirmButton
                  label={t('statusPage.restore')}
                  title={t('statusPage.restoreTitle', { name: title })}
                  body={t('statusPage.restoreBody')}
                  confirmLabel={t('statusPage.restore')}
                  busy={busy === `restore:${i.id}`}
                  disabled={busy !== null}
                  testId={`status-restore-${i.id}`}
                  onConfirm={() => run(`restore:${i.id}`, () => restoreIncident(i.id), { success: t('statusPage.restored') })}
                />
                <ConfirmButton
                  label={t('statusPage.purge')}
                  title={t('statusPage.purgeTitle', { name: title })}
                  body={t('statusPage.purgeBody')}
                  confirmLabel={t('statusPage.purge')}
                  danger
                  busy={busy === `purge:${i.id}`}
                  disabled={busy !== null}
                  testId={`status-purge-${i.id}`}
                  onConfirm={() => run(`purge:${i.id}`, () => purgeIncident(i.id), { success: t('statusPage.purged') })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
