import { redirect } from 'next/navigation';
import { headers as getHeaders } from 'next/headers';
import { isAuthenticated, getAuthClient } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { ErrorAlert, primaryButtonClass } from '@/components/ui';
import type { MessageKey } from '@/i18n/translate';
import { loginDecision, parsePrompt, withLoginParams } from '@/lib/login-flow';

interface PageProps {
  searchParams: Promise<{ error?: string; return?: string; prompt?: string }>;
}

const KNOWN_ERRORS = ['no_code', 'exchange_failed', 'verification_failed', 'auth_failed', 'unauthorized'] as const;

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;

  if (params.error) {
    const { t } = await getI18n();
    const errorKey: MessageKey = (KNOWN_ERRORS as readonly string[]).includes(params.error)
      ? (`login.errors.${params.error}` as MessageKey)
      : 'login.errors.unknown';

    return (
      <PublicShell>
        <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-fg">{t('common.appName')}</h1>
            <p className="text-fg-muted mt-2">{t('common.adminPanel')}</p>
          </div>

          <ErrorAlert testId="login-error">{t(errorKey)}</ErrorAlert>

          <a href="/login" className={`${primaryButtonClass} block w-full`}>
            {t('login.tryAgain')}
          </a>

          <p className="text-fg-subtle text-sm text-center mt-6">{t('login.onlyStaff')}</p>
        </div>
      </PublicShell>
    );
  }

  // Already signed in (and no account change asked for): carry on. Otherwise
  // to the auth server. No prompt on the normal path: the auth server signs
  // the browser's active account in silently, or shows its form. prompt=none
  // (switching account) and prompt=login (adding one) come from the account menu.
  const decision = loginDecision({
    authenticated: await isAuthenticated(),
    prompt: parsePrompt(params.prompt),
    returnTo: params.return,
  });
  if (decision.kind === 'continue') {
    redirect(decision.to);
  }

  const headersData = await getHeaders();
  const host = headersData.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';

  const client = await getAuthClient();
  const { url } = await client.authorize(`${protocol}://${host}/api/callback`, 'code');

  redirect(withLoginParams(url, decision.prompt, decision.returnTo));
}
