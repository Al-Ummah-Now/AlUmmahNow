import Link from '@/components/AppLink';
import { getAdminSession } from '@/lib/auth';
import { canManageEmails } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { listEmailTemplates, type TemplateSummary } from '@/lib/api/email-templates';
import { getNames } from '@/lib/api/audit';
import { formatNumber } from '@al-ummah/shared-types';
import { slugOfTemplate } from './templates';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { Sep } from '@/components/Sep';
export const dynamic = 'force-dynamic';

/**
 * Settings › Emails: the system emails whose wording admins edit (shared-types email-templates.ts).
 * Only the creator invite today; the others are tracked in the issue linked from the wiki page.
 */
export default async function EmailsPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageEmails(session?.user.role)) return <ErrorAlert testId="emails-no-access">{t('emailTemplates.noAccess')}</ErrorAlert>;

  let items: TemplateSummary[] = [];
  let failed = false;
  try {
    items = await listEmailTemplates();
  } catch (error) {
    logger.error('[emails] Failed to load the templates', { error: error instanceof Error ? error.message : String(error) });
    failed = true;
  }
  const names = await getNames({ users: items.map((i) => i.updatedBy).filter((u) => u !== 'system') });
  const who = (id: string) => {
    const u = names.users[id];
    return u?.name || u?.email || t('emailTemplates.unknownPerson');
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl" data-testid="emails-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-fg">{t('emailTemplates.title')}</h1>
        <p className="text-fg-muted">{t('emailTemplates.intro')}</p>
      </header>
      {failed ? <ErrorAlert testId="emails-load-failed">{t('emailTemplates.loadFailed')}</ErrorAlert> : null}
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.key} className={`${cardClass} flex flex-col sm:flex-row sm:items-center gap-4`} data-testid={`emails-item-${item.key}`}>
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-fg">{t(`emailTemplates.keys.${item.key}` as MessageKey)}</h2>
              <p className="text-sm text-fg-muted">{t(`emailTemplates.keyHelp.${item.key}` as MessageKey)}</p>
              <p className="text-sm text-fg-muted">
                {t('emailTemplates.version', { version: formatNumber(locale, item.version) })}
                <Sep />
                {item.updatedBy === 'system' ? t('emailTemplates.savedBySystem') : fillNodes(t('emailTemplates.savedBy', { name: who(item.updatedBy) }), { date: <LocalTime value={item.updatedAt} withTime /> })}
              </p>
            </div>
            <div className="flex justify-end">
              <Link href={`/settings/emails/${slugOfTemplate(item.key)}`} className={secondaryButtonClass} data-testid={`emails-edit-${item.key}`}>
                {t('emailTemplates.edit')}
                <span className="sr-only"> {t(`emailTemplates.keys.${item.key}` as MessageKey)}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
