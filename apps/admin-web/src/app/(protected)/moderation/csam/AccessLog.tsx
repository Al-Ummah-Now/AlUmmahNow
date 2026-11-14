import type { CsamAccessLogEntry } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatDate, type MessageKey, type Translator } from '@/i18n/translate';

/** A CSAM access log (append-only in admin-api): who did what, when, with the details logged. */
export function AccessLog({ entries, t, locale }: { entries: CsamAccessLogEntry[]; t: Translator; locale: Locale }) {
  if (!entries.length) return <p className="text-fg-muted">{t('csamPage.log.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('csamPage.log.title')}</caption>
        <thead>
          <tr className="text-fg-muted">
            <th scope="col" className="p-2 text-start font-medium">{t('csamPage.log.colWhen')}</th>
            <th scope="col" className="p-2 text-start font-medium">{t('csamPage.log.colWho')}</th>
            <th scope="col" className="p-2 text-start font-medium">{t('csamPage.log.colAction')}</th>
            <th scope="col" className="p-2 text-start font-medium">{t('csamPage.log.colDetail')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-border align-top" data-testid="csam-log-row" data-action={e.action}>
              <td className="p-2 whitespace-nowrap text-fg-muted">{formatDate(e.createdAt, locale, true)}</td>
              <td className="p-2" dir="ltr">{e.actorId}</td>
              <td className="p-2">{t(`csamPage.log.actions.${e.action.replace(/\./g, '_')}` as MessageKey)}</td>
              <td className="p-2 text-fg-muted break-all font-mono text-xs" dir="ltr">{e.detail ? JSON.stringify(e.detail) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
