import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { AccountMenu } from '@/components/AccountMenu';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AccessDeniedPage() {
  const session = await getAdminSession();
  const { t } = await getI18n();

  return (
    <PublicShell>
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-danger-bg">
            <svg
              className="h-6 w-6 text-danger-fg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-extrabold text-fg">{t('accessDenied.title')}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t('accessDenied.noPermission')}</p>
          <p className="mt-2 text-sm text-fg-muted">{t('accessDenied.roleRequired')}</p>
        </div>

        {session && (
          <div className="mt-4 p-4 bg-surface border border-border rounded-md">
            <p className="text-sm text-fg-muted">{t('common.signedInAs', { email: session.user.email })}</p>
            {session.user.role && (
              <p className="text-sm text-fg-muted mt-1">
                {t('accessDenied.currentRole', { role: session.user.role })}
              </p>
            )}
          </div>
        )}

        {/* Another account of this browser may have the role: switch to it here */}
        {process.env.Issuer && (
          <div className="flex justify-center" data-testid="access-denied-accounts">
            <AccountMenu issuer={process.env.Issuer} currentEmail={session?.user.email} />
          </div>
        )}

        <div className="mt-6 space-y-3">
          <p className="text-sm text-fg-muted">{t('accessDenied.contactAdmin')}</p>

          <div className="flex flex-col gap-3">
            <form action="/api/logout" method="POST">
              <button type="submit" className={`${primaryButtonClass} w-full py-2`}>
                {t('common.logout')}
              </button>
            </form>

            <a
              href={process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://alummahnow.net'}
              className={`${secondaryButtonClass} py-2`}
            >
              {t('accessDenied.goToMainSite')}
            </a>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
