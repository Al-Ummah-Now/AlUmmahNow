import { notFound } from 'next/navigation';
import Link from '@/components/AppLink';
import { getAdminSession } from '@/lib/auth';
import { canManageEmails } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { getEmailTemplate } from '@/lib/api/email-templates';
import { getNames } from '@/lib/api/audit';
import type { EmailTemplateState } from '@al-ummah/shared-types';
import { templateOfSlug } from '../templates';
import { EmailTemplateEditor } from './EmailTemplateEditor';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Settings › Emails › one email: wording in en + ar, default videos, live preview, test send, history. */
export default async function EmailTemplatePage({ params }: PageProps) {
  const { t } = await getI18n();
  const session = await getAdminSession();
  if (!canManageEmails(session?.user.role)) return <ErrorAlert testId="emails-no-access">{t('emailTemplates.noAccess')}</ErrorAlert>;
  const key = templateOfSlug((await params).slug);
  if (!key) notFound();

  let state: EmailTemplateState | null = null;
  try {
    state = await getEmailTemplate(key);
  } catch (error) {
    logger.error('[emails] Failed to load the template', { key, error: error instanceof Error ? error.message : String(error) });
  }
  const names = state && state.updatedBy !== 'system' ? await getNames({ users: [state.updatedBy] }) : null;
  const updatedByName = state ? (names?.users[state.updatedBy]?.name || names?.users[state.updatedBy]?.email || null) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="email-template-page">
      <nav aria-label={t('nav.breadcrumbs')}>
        <Link href="/settings/emails" className={linkClass} data-testid="email-template-back">
          {t('emailTemplates.back')}
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-fg">{t(`emailTemplates.keys.${key}` as MessageKey)}</h1>
        <p className="text-fg-muted max-w-3xl">{t(`emailTemplates.keyHelp.${key}` as MessageKey)}</p>
      </header>
      {state ? (
        <EmailTemplateEditor initial={state} initialUpdatedByName={updatedByName} adminEmail={session?.user.email ?? ''} />
      ) : (
        <ErrorAlert testId="email-template-load-failed">{t('emailTemplates.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
