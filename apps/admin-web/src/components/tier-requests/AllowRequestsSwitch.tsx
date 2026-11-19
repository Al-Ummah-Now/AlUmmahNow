'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { cardClass } from '@/components/ui';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { logger } from '@/lib/logger-client';

type SetAllowed = (allowed: boolean, opts?: { undo?: boolean }) => Promise<ActionResult<{ previous: boolean; allowed: boolean; mode: string }>>;

class SettingFailure extends Error {}

/**
 * "Allow tier requests" (owner rule 2026-11-15, shared-types UPGRADE_MODES).
 * With no payment provider enabled it decides the Upgrade page: the request
 * form, or (off) no Upgrade page at all: 404 feature_off, no links to it
 * (owner decision 2026-11-19). With a
 * provider enabled the page sells and requests are off whatever this says.
 * Acts at once, audited, with Undo.
 */
export function AllowRequestsSwitch({ allowed: initial, providerEnabled, canManage, setAllowed }: { allowed: boolean; providerEnabled: boolean; canManage: boolean; setAllowed: SetAllowed }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { run } = useUndoableAction();
  const [allowed, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(value: boolean, undo = false) {
    const result = await setAllowed(value, undo ? { undo: true } : undefined);
    if (!result.ok) throw new SettingFailure(result.error);
    setLocal(value);
    return result.data;
  }

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await run({
        action: () => call(next),
        undo: async (res) => {
          await call(res.previous, true);
          router.refresh();
        },
        message: next ? t('tierRequests.allowOnDone') : t('tierRequests.allowOffDone'),
        undoneMessage: t('tierRequests.allowUndone'),
      });
      router.refresh();
    } catch (e) {
      logger.warn('[tier-requests] Allow requests change failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('tierRequests.allowFailed'));
    } finally {
      setBusy(false);
    }
  }

  const mode = providerEnabled ? 'pay' : allowed ? 'request' : 'closed';
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="tier-requests-allow-title" data-testid="tier-requests-allow" data-mode={mode}>
      <h2 id="tier-requests-allow-title" className="text-lg font-semibold text-fg mb-2">{t('tierRequests.allowTitle')}</h2>
      <label className="flex items-center gap-2 text-fg">
        <input
          type="checkbox"
          role="switch"
          checked={allowed}
          disabled={!canManage || busy}
          aria-checked={allowed}
          aria-describedby="tier-requests-allow-mode"
          onChange={(e) => void toggle(e.target.checked)}
          className="h-4 w-4 accent-accent"
          data-testid="tier-requests-allow-switch"
        />
        {t('tierRequests.allowLabel')}
      </label>
      <p id="tier-requests-allow-mode" className="mt-2 text-sm text-fg-muted" data-testid="tier-requests-allow-mode">
        {t(mode === 'pay' ? 'tierRequests.modePay' : mode === 'request' ? 'tierRequests.modeRequest' : 'tierRequests.modeClosed')}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
    </section>
  );
}
