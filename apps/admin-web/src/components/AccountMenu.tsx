'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { Icon } from '@/components/shell/icons';
import { useConfirm } from '@/components/content/actions';
import {
  fetchAuthAccounts,
  reauthPath,
  removeAuthAccount,
  signOutOneDecision,
  switchAuthAccount,
  type AuthAccount,
} from '@/lib/auth-accounts';
import { appLinks, appUrlsFromIssuer, type AppLinkId } from '@al-ummah/shared-types';

interface AccountMenuProps {
  /** Auth server origin (the Issuer). */
  issuer: string;
  /** The account this panel is signed in as, if any (shown until the list loads). */
  currentEmail?: string;
  /** This account's roles: the "Al Ummah Now apps" links are gated like each app's guard. */
  roles?: readonly string[];
}

/**
 * Every account signed in to this browser, as the auth server knows them:
 * switch (silent sign-in as that account), add one (sign-in form), sign out
 * of one, or sign out of all (single sign-out).
 */
export function AccountMenu({ issuer, currentEmail, roles }: AccountMenuProps) {
  const { t, locale } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AuthAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const signOutAllRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    setAccounts(await fetchAuthAccounts(issuer));
  }, [issuer]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  const currentPath = () => `${window.location.pathname}${window.location.search}`;

  const onSwitch = async (userId: string) => {
    setBusy(true);
    // Make it the active account everywhere, then get its tokens silently
    await switchAuthAccount(issuer, userId);
    window.location.assign(reauthPath(currentPath(), 'none'));
  };

  const onAdd = () => {
    window.location.assign(reauthPath(currentPath(), 'login'));
  };

  const onSignOut = async (userId: string) => {
    setBusy(true);
    if (signOutOneDecision(accounts, userId) === 'single-sign-out') {
      signOutAllRef.current?.requestSubmit();
      return;
    }
    await removeAuthAccount(issuer, userId);
    window.location.assign(reauthPath(currentPath(), 'none'));
  };

  const count = accounts?.length ?? 0;
  // Without the auth server's list, show at least the account signed in here
  const rows: AuthAccount[] =
    accounts && accounts.length > 0
      ? accounts
      : currentEmail
        ? [{ userId: '', email: currentEmail, isActive: true }]
        : [];
  const active = rows.find((a) => a.isActive) ?? rows[0];
  const others = rows.filter((a) => a !== active);
  // The name auth has for the account (platform display-name rule); the email only without one
  const nameOf = (a: AuthAccount | undefined) => a?.name || a?.email || currentEmail || '';
  const name = nameOf(active);
  const initial = (name[0] ?? '?').toUpperCase();
  const otherApps = appLinks({ current: 'admin', roles, lang: locale, urls: appUrlsFromIssuer(issuer) });
  const appLabel: Record<AppLinkId, string> = {
    www: t('accounts.appWww'),
    videos: t('accounts.appVideos'),
    profile: t('accounts.appProfile'),
    cms: t('accounts.appCms'),
    admin: t('accounts.appAdmin'),
    'auth-admin': t('accounts.appAuthAdmin'),
  };
  const sep = <div className="aun-menu-sep" role="separator" />;

  return (
    <div ref={rootRef} className="relative">
      {confirmDialog}
      <button
        type="button"
        data-testid="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="aun-acct-btn"
      >
        {/* No aria-label: the visible name is the button's name (axe label-content-name-mismatch) */}
        <span className="aun-avatar" aria-hidden="true">{initial}</span>
        <span className="sr-only">{t('accounts.menu')}: </span>
        <span className="aun-acct-name" dir="auto">{name}</span>
        <Icon name="chevron" className="aun-caret rotate-90" />
      </button>
      {open && (
        <div id={menuId} role="menu" data-testid="account-menu" aria-busy={busy} className="aun-menu">
          {/* The current account, only here (the Google pattern); the others follow under "More accounts" */}
          <div className="aun-menu-who" data-testid="account-menu-account" data-active="true" data-email={active?.email ?? ''}>
            <span className="aun-avatar aun-avatar--lg" aria-hidden="true">{initial}</span>
            <span className="aun-menu-who-text">
              <span className="aun-menu-who-name" dir="auto">{name}</span>
              {active?.email && active.email !== name && <EmailText email={active.email} className="aun-menu-who-sub" />}
            </span>
          </div>
          {sep}
          {others.length > 0 && (
            <>
              <span className="aun-menu-label" id={`${menuId}-accounts`}>{t('accounts.more')}</span>
              <ul aria-labelledby={`${menuId}-accounts`}>
                {others.map((account) => {
                  const label = nameOf(account);
                  return (
                    <li
                      key={account.userId || account.email}
                      data-testid="account-menu-account"
                      data-active="false"
                      data-email={account.email}
                      className="aun-acct-row"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="account-switch"
                        disabled={busy || !account.userId}
                        aria-label={t('accounts.switchTo', { name: label })}
                        onClick={() => onSwitch(account.userId)}
                        className="aun-menu-item"
                      >
                        <span className="aun-avatar" aria-hidden="true">{(label[0] ?? '?').toUpperCase()}</span>
                        <span className="aun-acct-text">
                          <span className="aun-acct-label" dir="auto">{label}</span>
                          {account.name && <EmailText email={account.email} className="aun-acct-email" />}
                        </span>
                      </button>
                      {account.userId && (
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="account-sign-out"
                          disabled={busy}
                          onClick={() => onSignOut(account.userId)}
                          className="aun-acct-signout"
                          aria-label={t('accounts.signOutOf', { name: label })}
                          title={t('accounts.signOutOf', { name: label })}
                        >
                          <Icon name="logout" className="aun-flip" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <button type="button" role="menuitem" data-testid="account-add" disabled={busy} onClick={onAdd} className="aun-menu-item">
            <Icon name="login" className="aun-menu-icon aun-flip" />
            <span className="aun-menu-text">{t('accounts.add')}</span>
          </button>
          {otherApps.length > 0 && (
            <>
              {sep}
              <div role="group" aria-labelledby={`${menuId}-apps`} data-testid="account-menu-apps">
                <span className="aun-menu-label" id={`${menuId}-apps`}>{t('accounts.apps')}</span>
                {otherApps.map((app) => (
                  <a key={app.id} href={app.href} role="menuitem" className="aun-menu-item" data-app={app.id}>
                    <span className="aun-app-icon" data-app={app.id} aria-hidden="true" />
                    <span className="aun-menu-text">{appLabel[app.id]}</span>
                  </a>
                ))}
              </div>
            </>
          )}
          {sep}
          <form
            ref={signOutAllRef}
            action="/api/logout"
            method="POST"
            onSubmit={async (e) => {
              // With several accounts a click signs every one out: confirm first
              // (requestSubmit from onSignOut has no submitter and goes straight through)
              if (count < 2 || !(e.nativeEvent as SubmitEvent).submitter) return;
              e.preventDefault();
              const confirmed = await confirm({
                title: t('confirmDialog.signOutAllTitle'),
                body: t('confirmDialog.signOutAllBody'),
                confirmLabel: t('accounts.signOutAll'),
                danger: true,
                testId: 'account-sign-out-all-confirm',
              });
              if (confirmed) signOutAllRef.current?.submit();
            }}
          >
            {/* With several accounts, "Sign out" signs out this one (the next account takes over), as in
                every app's menu (docs/design/NAV.md); "Sign out of all accounts" follows */}
            {count > 1 && active?.userId && (
              <button
                type="button"
                role="menuitem"
                data-testid="account-sign-out-current"
                disabled={busy}
                onClick={() => void onSignOut(active.userId)}
                className="aun-menu-item"
              >
                <Icon name="logout" className="aun-menu-icon aun-flip" />
                <span className="aun-menu-text">{t('accounts.signOut')}</span>
              </button>
            )}
            {/* Single sign-out through the auth server (it was a separate header button) */}
            <button
              type="submit"
              role="menuitem"
              data-testid="account-sign-out-all"
              disabled={busy}
              className={`aun-menu-item ${count > 1 ? 'aun-menu-item--danger' : ''}`}
            >
              <Icon name="logout" className="aun-menu-icon aun-flip" />
              <span className="aun-menu-text">{count > 1 ? t('accounts.signOutAll') : t('accounts.signOut')}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * An email that keeps its domain when it does not fit (AlUmmahNow docs/design/NAV.md): the local
 * part shrinks with an ellipsis, "@domain" stays whole, and the full address is the tooltip.
 */
function EmailText({ email, className }: { email: string; className: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return <span className={className} dir="ltr" title={email}>{email}</span>;
  return (
    <span className={`${className} aun-email`} dir="ltr" title={email}>
      <span className="aun-email-local">{email.slice(0, at)}</span>
      <span className="aun-email-domain">{email.slice(at)}</span>
    </span>
  );
}
