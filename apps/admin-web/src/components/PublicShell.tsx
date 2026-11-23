import { appLinks, appUrlsFromIssuer } from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';
import { getAdminSession } from '@/lib/auth';
import { PreferencesControls } from './PreferencesControls';
import { AccountMenu } from './AccountMenu';
import { HeaderAccount } from './HeaderAccount';
import { HeaderBrand, HeaderEnvBadge, HeaderSignIn } from './shell/HeaderParts';

/**
 * Layout for pages outside the authenticated area (login errors, access denied, passkey needed,
 * not found): the shared header (docs/design/NAV.md "Header": brand, env badge, language,
 * light/dark, then the account or Sign in), content centred. The header has no links to other
 * sites (owner, 2026-11-15), so the footer links Website and Videos at every width.
 */
/**
 * `top`: the content starts below the header at the page's own width (the error card, which places
 * itself like the videos site's: top-aligned, 16px from each edge on a phone), instead of centred in a
 * padded box (sign-in, access denied).
 */
export async function PublicShell({ children, top = false }: { children: React.ReactNode; top?: boolean }) {
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
          <PreferencesControls />
          {session && issuer ? (
            <AccountMenu issuer={issuer} currentEmail={session.user.email} roles={session.user.role ? [session.user.role] : []} />
          ) : issuer ? (
            // No admin session (signed out, or signed in without an admin role): Auth decides
            <HeaderAccount issuer={issuer} lang={locale} />
          ) : (
            <HeaderSignIn lang={locale} href="/login" />
          )}
        </div>
      </header>
      <main id="main-content" className={top ? 'flex-1 flex flex-col pb-12' : 'flex-1 flex items-center justify-center px-4 pb-12'}>
        {children}
      </main>
      {sites.length > 0 && (
        <footer className="flex justify-center gap-4 px-4 pb-6 text-sm">
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
