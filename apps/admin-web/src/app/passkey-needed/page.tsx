import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { PasskeyNeeded } from '@/components/PasskeyNeeded';
import { DEFAULT_RETURN_PATH, loginPath, safeReturnPath } from '@/lib/login-flow';
import { adminSetupUrl, formatPasskeyDeadline, passkeyNeededPath, passkeySignInPath, sessionPasskeyGate } from '@/lib/passkeys';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ return?: string; reason?: string }>;
}

/**
 * "Passkey needed" (wiki AUTH-PASSKEYS): a staff sign-in without a passkey after
 * the deadline (requireAdminRole), or a high-risk action admin-api refused for
 * want of one (`passkey_required`, reason=step_up). Not an error page.
 */
export default async function PasskeyNeededPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.return) ?? DEFAULT_RETURN_PATH;
  const session = await getAdminSession();
  if (!session) redirect(loginPath(passkeyNeededPath(returnTo, params.reason === 'step_up' ? 'step_up' : undefined)));

  const gate = sessionPasskeyGate(session.accessToken);
  const stepUp = params.reason === 'step_up';
  // Nothing to ask for: the deadline is not reached and no action asked for a passkey
  if (gate.state !== 'blocked' && !stepUp) redirect(returnTo);

  const { t, locale } = await getI18n();
  const h = await headers();
  const host = h.get('host') ?? 'localhost';
  const origin = `${host.includes('localhost') ? 'http' : 'https'}://${host}`;
  const issuer = process.env.Issuer;

  return (
    <PublicShell>
      <PasskeyNeeded
        title={gate.state === 'blocked' ? t('passkeys.neededTitle') : t('passkeys.stepUpTitle')}
        body={gate.state === 'blocked' ? t('passkeys.neededBody', { date: formatPasskeyDeadline(gate.deadline, locale) }) : t('passkeys.stepUpBody')}
        why={t('passkeys.why')}
        email={t('common.signedInAs', { email: session.user.email })}
        setupUrl={issuer ? adminSetupUrl(issuer, origin, returnTo) : null}
        signInPath={passkeySignInPath(returnTo)}
        backPath={gate.state === 'blocked' ? null : returnTo}
        labels={{ add: t('passkeys.add'), signIn: t('passkeys.signIn'), back: t('passkeys.back'), logout: t('common.logout') }}
      />
    </PublicShell>
  );
}
