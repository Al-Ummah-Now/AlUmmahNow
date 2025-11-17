/**
 * Account Switcher Component (RTL/Arabic)
 *
 * Displays current user account and allows switching between
 * multiple logged-in accounts or adding new ones.
 */

'use client';

import { useState } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useI18n } from '@/lib/i18n';
import { Plus, Check, LogOut, ChevronDown } from 'lucide-react';

export default function AccountSwitcherRTL() {
  const { t } = useI18n('ar');

  const {
    user,
    accounts,
    loading,
    error,
    addAccount,
    switchAccount,
    removeAccount,
    logout,
    logoutAll,
  } = useMultiAccount();

  const [isOpen, setIsOpen] = useState(false);

  if (loading) {
    return (
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="relative" dir="rtl">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="قائمة الحسابات"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <ChevronDown className="h-4 w-4 text-gray-500" />
        <div className="hidden md:block text-right">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {user.displayName}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {user.email}
          </div>
        </div>
        <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
          {user.displayName?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Menu */}
          <div
            className="absolute left-0 mt-2 w-80 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Account List */}
            <div className="p-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                {t.header.switchAccount} ({accounts.length})
              </div>

              {accounts.map((account) => (
                <div
                  key={account.userId}
                  className="group relative rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <button
                    onClick={() => {
                      if (!account.isActive) {
                        switchAccount(account.userId);
                        setIsOpen(false);
                      }
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2 text-right"
                    role="menuitem"
                    disabled={account.isActive}
                  >
                    {account.isActive && (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {account.displayName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {account.email}
                      </div>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                      {account.displayName?.[0]?.toUpperCase() || account.email[0].toUpperCase()}
                    </div>
                  </button>

                  {/* Remove Account Button (shown on hover, not for active account) */}
                  {!account.isActive && accounts.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAccount(account.userId);
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="إزالة الحساب"
                    >
                      <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700" />

            {/* Actions */}
            <div className="p-2">
              {/* Add Account */}
              <button
                onClick={() => {
                  addAccount();
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                role="menuitem"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t.header.addAccount}
                </span>
                <div className="h-10 w-10 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                  <Plus className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
              </button>

              {/* Logout Current */}
              <button
                onClick={() => {
                  logout();
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                role="menuitem"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t.header.logout} {user.displayName}
                </span>
                <div className="h-10 w-10 flex items-center justify-center">
                  <LogOut className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
              </button>

              {/* Logout All (if multiple accounts) */}
              {accounts.length > 1 && (
                <button
                  onClick={() => {
                    logoutAll();
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  role="menuitem"
                >
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t.header.logoutAll}
                  </span>
                  <div className="h-10 w-10 flex items-center justify-center">
                    <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                </button>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                <div className="p-3 bg-red-50 dark:bg-red-900/20">
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
