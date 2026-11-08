import Link from 'next/link';
import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui';

export default async function HomePage() {
  const session = await getAdminSession();
  const { t } = await getI18n();

  return (
    <PublicShell>
      <div className="text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-fg mb-4">{t('common.appName')}</h1>
        <p className="text-xl text-fg-muted mb-8">{t('common.adminPanel')}</p>

        {session ? (
          <div className="space-y-4">
            <p className="text-fg-muted" data-testid="welcome">
              {t('home.welcome', { email: session.user.email })}
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/dashboard" className={primaryButtonClass}>
                {t('common.goToDashboard')}
              </Link>
              <form action="/api/logout" method="POST">
                <button type="submit" className={secondaryButtonClass}>
                  {t('common.logout')}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-fg-muted mb-6">{t('home.pleaseLogin')}</p>
            {/* Plain anchor: /login redirects off-site to the auth server */}
            <a href="/login" className={primaryButtonClass}>
              {t('common.login')}
            </a>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
