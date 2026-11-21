import type { CsamAccessLogEntry } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { type MessageKey, type Translator } from '@/i18n/translate';
import { logDetailText } from './model';
import { UserName } from '@/components/audit/UserName';

import { LocalTime } from '@/components/LocalTime';
/** A CSAM access log (append-only in admin-api): who did what, when, with the details logged. */
export function AccessLog({ entries, t }: { entries: CsamAccessLogEntry[]; t: Translator; locale: Locale }) {
  if (!entries.length) return <p className="text-fg-muted">{t('csamPage.log.empty')}</p>;
  const action = (e: CsamAccessLogEntry) => t(`csamPage.log.actions.${e.action.replace(/\./g, '_')}` as MessageKey);
  return (
    <>
      {/* Phones: one entry per item instead of a four-column table */}
      <ul className="sm:hidden divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="py-2 text-sm">
            <p className="text-fg font-medium">{action(e)}</p>
            <p className="text-xs text-fg-muted">
              <LocalTime value={e.createdAt} withTime /> • <UserName id={e.actorId} showEmail={false} />
            </p>
            {logDetailText(e.detail) && (
              <p className="text-xs text-fg-muted break-words"><bdi dir="ltr">{logDetailText(e.detail)}</bdi></p>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('csamPage.log.title')}</caption>
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.log.colWhen')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.log.colWho')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.log.colAction')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.log.colDetail')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border align-top" data-testid="csam-log-row" data-action={e.action}>
                <td className="p-2 whitespace-nowrap text-fg-muted"><LocalTime value={e.createdAt} withTime /></td>
                <td className="p-2"><UserName id={e.actorId} /></td>
                <td className="p-2">{action(e)}</td>
                <td className="p-2 text-fg-muted break-words">{logDetailText(e.detail) ? <bdi dir="ltr">{logDetailText(e.detail)}</bdi> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
