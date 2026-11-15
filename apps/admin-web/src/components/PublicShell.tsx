import { appLinks, appUrlsFromIssuer } from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';
import { getAdminSession } from '@/lib/auth';
import { PreferencesControls } from './PreferencesControls';
import { AccountMenu } from './AccountMenu';
import { HeaderAppLinks, HeaderBrand, HeaderEnvBadge, HeaderSignIn } from './shell/HeaderParts';

/**
 * Layout for pages outside the authenticated area (login errors, access denied, passkey needed,
 * not found): the shared header (docs/design/NAV.md "Header": brand, env badge, Website / Videos,
 * language, light/dark, then the account or Sign in), content centred. On phones the header's app
 * links leave the bar, so the footer carries them.
 */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const issuer = process.env.Issuer;
  const session = await getAdminSession().catch(() => null);
  const sites = appLinks({ current: 'admin', lang: locale, urls: appUrlsFromIssuer(issuer) }).filter((a) => a.id === 'www' || a.id === 'videos');
  return (
    <div className="min-h-screen flex flex-col">
      <header className="shell-header aun-header">
        <HeaderBrand lang={locale} href="/" app={t('common.admin')} />
        <HeaderEnvBadge environment={process.env.NEXTJS_ENV} lang={locale} />
        <div className="aun-header-primary" />
        <div className="aun-header-tools">
          <HeaderAppLinks lang={locale} links={sites} />
          <PreferencesControls />
          {session && issuer ? (
            <AccountMenu issuer={issuer} currentEmail={session.user.email} roles={session.user.role ? [session.user.role] : []} />
          ) : (
            <HeaderSignIn lang={locale} href="/login" />
          )}
        </div>
      </header>
      <main id="main-content" className="flex-1 flex items-center justify-center px-4 pb-12">
        {children}
      </main>
      {sites.length > 0 && (
        <footer className="flex justify-center gap-4 px-4 pb-6 text-sm sm:hidden">
          {sites.map((s) => (
            <a key={s.id} href={s.href} className="text-link underline-offset-2 hover:underline">
              {s.id === 'www' ? t('accounts.appWww') : t('accounts.appVideos')}
            </a>
          ))}
        </footer>
      )}
    </div>
  );
}
