'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { useConfirm } from '@/components/content/actions';
import {
  fetchAuthAccounts,
  reauthPath,
  removeAuthAccount,
  signOutOneDecision,
  switchAuthAccount,
  type AuthAccount,
} from '@/lib/auth-accounts';

interface AccountMenuProps {
  /** Auth server origin (the Issuer). */
  issuer: string;
  /** The account this panel is signed in as, if any (shown until the list loads). */
  currentEmail?: string;
}

/**
 * Every account signed in to this browser, as the auth server knows them:
 * switch (silent sign-in as that account), add one (sign-in form), sign out
 * of one, or sign out of all (single sign-out).
 */
export function AccountMenu({ issuer, currentEmail }: AccountMenuProps) {
  const { t } = useLanguage();
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
  const label = count > 1 ? `${t('accounts.menu')} (${count})` : t('accounts.menu');
  // Without the auth server's list, show at least the account signed in here
  const rows: AuthAccount[] =
    accounts && accounts.length > 0
      ? accounts
      : currentEmail
        ? [{ userId: '', email: currentEmail, isActive: true }]
        : [];

  const itemClass =
    'text-sm px-2 py-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50';

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
        className="text-fg-muted hover:text-fg text-sm px-2 py-1 rounded border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-focus max-w-[16rem] truncate"
      >
        {label}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          data-testid="account-menu"
          aria-busy={busy}
          className="absolute end-0 mt-2 w-72 z-50 bg-surface border border-border rounded-lg shadow-lg p-2"
        >
          <p className="px-2 py-1 text-xs font-semibold text-fg-subtle uppercase">{t('accounts.title')}</p>
          <ul className="mb-2">
            {rows.map((account) => (
              <li
                key={account.userId || account.email}
                data-testid="account-menu-account"
                data-active={account.isActive ? 'true' : 'false'}
                data-email={account.email}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="account-switch"
                  disabled={busy || account.isActive || !account.userId}
                  onClick={() => onSwitch(account.userId)}
                  className="flex-1 min-w-0 text-start disabled:cursor-default"
                >
                  <span className="block text-sm text-fg truncate">{account.name || account.email}</span>
                  {account.name && <span className="block text-xs text-fg-muted truncate">{account.email}</span>}
                  {account.isActive && <span className="block text-xs text-success-fg">{t('accounts.active')}</span>}
                </button>
                {account.userId && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="account-sign-out"
                    disabled={busy}
                    onClick={() => onSignOut(account.userId)}
                    className={itemClass}
                    aria-label={t('accounts.signOutOf', { email: account.email })}
                  >
                    {t('accounts.signOut')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-border pt-2 flex flex-col items-stretch gap-1">
            <button type="button" role="menuitem" data-testid="account-add" disabled={busy} onClick={onAdd} className={`${itemClass} text-start`}>
              {t('accounts.add')}
            </button>
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
              <button type="submit" role="menuitem" data-testid="account-sign-out-all" disabled={busy} className={`${itemClass} w-full text-start`}>
                {t('accounts.signOutAll')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
