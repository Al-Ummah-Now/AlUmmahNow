'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CAPTION_GRANT_BOUNDS, type CaptionGrantScope, type CaptionLedgerEntry, type CaptionMinuteGrant, type CaptionMinutesUsage } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber, type MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { Chip, dangerButtonClass, smallButtonClass } from '@/components/content/parts';
import { reportError } from '@/lib/errors/reporter';
import { confirmButtonClass } from './TierChangeDialog';

export interface CaptionGrantControlsProps {
  userId: string;
  usage: CaptionMinutesUsage;
  grants: CaptionMinuteGrant[];
  /** The newest balance changes (each job step and overdraft paydown) */
  ledger?: CaptionLedgerEntry[];
  canManage: boolean;
  grant: (userId: string, grant: { minutes: number; scope: CaptionGrantScope; reason: string }) => Promise<ActionResult<unknown>>;
  revoke: (userId: string, grantId: string, reason: string) => Promise<ActionResult<unknown>>;
}

type Status = { kind: 'ok' | 'error'; text: string } | null;

/** This month's caption minutes, the grant form and the grants (each revocable with a reason). */
export function CaptionGrantControls({ userId, usage, grants, ledger = [], canManage, grant, revoke }: CaptionGrantControlsProps) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const n = (value: number) => formatNumber(value, locale);
  /** Signed: +17 charged, −5 given back (a real minus sign) */
  const signed = (value: number) => (value > 0 ? `+${n(value)}` : value < 0 ? `\u2212${n(-value)}` : n(0));
  const [minutes, setMinutes] = useState<number>(60);
  const [scope, setScope] = useState<CaptionGrantScope>('month');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const { min, max } = CAPTION_GRANT_BOUNDS.minutes;
  const minutesError = !Number.isInteger(minutes) || minutes < min || minutes > max;
  const reasonError = !reason.trim() || reason.trim().length > CAPTION_GRANT_BOUNDS.reason.max;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (minutesError || reasonError) return;
    setBusy(true);
    setStatus(null);
    const result = await grant(userId, { minutes, scope, reason: reason.trim() });
    setBusy(false);
    if (!result.ok) {
      setStatus({ kind: 'error', text: t('captionMinutes.grantFailed') });
      if (result.status >= 500) reportError(new Error(`caption grant failed: ${result.error}`), { shown: true, status: result.status, extra: { userId } });
      return;
    }
    setStatus({ kind: 'ok', text: t('captionMinutes.granted') });
    setReason('');
    setTouched(false);
    router.refresh();
  }

  async function confirmRevoke(grantId: string) {
    const why = revokeReason.trim();
    if (!why) return;
    setBusy(true);
    setStatus(null);
    const result = await revoke(userId, grantId, why);
    setBusy(false);
    if (!result.ok) {
      setStatus({ kind: 'error', text: t('captionMinutes.revokeFailed') });
      if (result.status >= 500) reportError(new Error(`caption grant revoke failed: ${result.error}`), { shown: true, status: result.status, extra: { userId, grantId } });
      return;
    }
    setRevoking(null);
    setRevokeReason('');
    setStatus({ kind: 'ok', text: t('captionMinutes.revokeDone') });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm" data-testid="caption-minutes-usage">
        {usage.unlimited ? (
          <p className="text-fg">{t('captionMinutes.unlimited')}</p>
        ) : (
          <>
            <p className="text-fg">{t('captionMinutes.tierLine', { minutes: n(usage.tierMinutes) })}</p>
            <p className="text-fg">
              {t('captionMinutes.monthLine', { used: n(usage.monthUsed), limit: n(usage.monthLimit ?? 0), date: formatDate(usage.resetsAt, locale) })}{' '}
              {usage.warning && <Chip tone="warn">80%</Chip>}
            </p>
            {usage.packsRemaining > 0 && <p className="text-fg">{t('captionMinutes.packsLine', { count: n(usage.packsRemaining) })}</p>}
            {usage.held > 0 && <p className="text-fg-muted">{t('captionMinutes.heldLine', { count: n(usage.held) })}</p>}
            {usage.overdraft > 0 ? (
              <p className="font-medium text-danger-fg" data-testid="caption-minutes-overdraft">{t('captionMinutes.overdraftLine', { count: n(usage.overdraft) })}</p>
            ) : (
              <p className="font-medium text-fg" data-testid="caption-minutes-remaining">{t('captionMinutes.remainingLine', { count: n(Math.max(0, usage.remaining ?? 0)) })}</p>
            )}
          </>
        )}
      </div>

      {canManage ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded border border-border p-4" aria-labelledby={`${ids}-grant`} data-testid="caption-grant-form">
          <h3 id={`${ids}-grant`} className="text-base font-semibold text-fg">{t('captionMinutes.grantTitle')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              <span className="text-fg font-medium">{t('captionMinutes.minutes')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={Number.isFinite(minutes) ? minutes : ''}
                onChange={(e) => setMinutes(e.target.value === '' ? NaN : Number(e.target.value))}
                aria-invalid={touched && minutesError ? true : undefined}
                aria-describedby={touched && minutesError ? `${ids}-minutes-error` : undefined}
                className={fieldClass}
                dir="ltr"
                data-testid="caption-grant-minutes"
              />
              {touched && minutesError && (
                <span id={`${ids}-minutes-error`} className="text-xs text-danger-fg">{t('captionMinutes.errorRange', { min: n(min), max: n(max) })}</span>
              )}
            </label>
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="text-fg font-medium mb-1">{t('captionMinutes.scope')}</legend>
              {(['month', 'until_used'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-fg">
                  <input type="radio" name={`${ids}-scope`} value={value} checked={scope === value} onChange={() => setScope(value)} data-testid={`caption-grant-scope-${value}`} />
                  {value === 'month' ? t('captionMinutes.scopeMonth') : t('captionMinutes.scopeUntilUsed')}
                </label>
              ))}
            </fieldset>
          </div>
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('captionMinutes.reason')}</span>
            <input
              type="text"
              value={reason}
              maxLength={CAPTION_GRANT_BOUNDS.reason.max}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && reasonError ? true : undefined}
              aria-describedby={`${ids}-reason-help${touched && reasonError ? ` ${ids}-reason-error` : ''}`}
              className={fieldClass}
              data-testid="caption-grant-reason"
            />
            <span id={`${ids}-reason-help`} className="text-xs">{t('captionMinutes.reasonHelp')}</span>
            {touched && reasonError && <span id={`${ids}-reason-error`} className="text-xs text-danger-fg">{t('captionMinutes.errorReason')}</span>}
          </label>
          <div>
            <button type="submit" className={confirmButtonClass} disabled={busy} data-testid="caption-grant-submit">
              {busy ? t('captionMinutes.granting') : t('captionMinutes.grant')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-fg-muted">{t('captionMinutes.noAccess')}</p>
      )}

      <p role="status" aria-live="polite" className={`text-sm min-h-5 ${status?.kind === 'error' ? 'text-danger-fg' : 'text-fg'}`} data-testid="caption-grant-status">
        {status?.text}
      </p>

      <div>
        <h3 className="text-base font-semibold text-fg mb-2">{t('captionMinutes.ledgerTitle')}</h3>
        {ledger.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('captionMinutes.ledgerEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-testid="caption-ledger">
            {ledger.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-b-0" data-testid="caption-ledger-entry" data-kind={e.kind}>
                <span className="text-fg">
                  {formatDate(e.createdAt, locale, true)} · {t(`captionMinutes.ledgerKind.${e.kind}` as MessageKey)} · <bdi dir="ltr">{signed(e.minutes)}</bdi>
                  {e.balanceAfter !== null && (
                    <>
                      {' · '}
                      <span className={e.balanceAfter < 0 ? 'font-medium text-danger-fg' : undefined}>
                        {t('captionMinutes.ledgerBalance')} <bdi dir="ltr">{signed(e.balanceAfter)}</bdi>
                      </span>
                    </>
                  )}
                </span>
                {e.holdId && (
                  <span className="text-xs text-fg-muted">
                    {t('captionMinutes.ledgerJob')} <bdi dir="ltr">{e.holdId}</bdi>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-fg mb-2">{t('captionMinutes.grantsTitle')}</h3>
        {grants.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('captionMinutes.grantsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm" data-testid="caption-grants">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0" data-testid="caption-grant">
                <span className={`font-medium ${g.revokedAt ? 'text-fg-muted line-through' : 'text-fg'}`}>
                  {g.scope === 'month'
                    ? t('captionMinutes.grantMonth', { minutes: n(g.minutes), period: g.period ?? '' })
                    : t('captionMinutes.grantUntilUsed', { minutes: n(g.minutes), used: n(g.used) })}
                </span>
                <span className="text-fg-muted">
                  {t('captionMinutes.grantBy', { reason: g.reason, actor: g.createdBy, date: formatDate(g.createdAt, locale, true) })}
                </span>
                {g.revokedAt && (
                  <span className="text-fg-muted">{t('captionMinutes.revokedLine', { actor: g.revokedBy ?? '', date: formatDate(g.revokedAt, locale, true), reason: g.revokeReason ?? '' })}</span>
                )}
                {canManage && !g.revokedAt && revoking !== g.id && (
                  <div>
                    <button type="button" className={smallButtonClass} onClick={() => { setRevoking(g.id); setRevokeReason(''); }} disabled={busy} data-testid="caption-grant-revoke">
                      {t('captionMinutes.revoke')}
                    </button>
                  </div>
                )}
                {revoking === g.id && (
                  <div role="group" aria-labelledby={`${ids}-revoke-${g.id}`} className="flex flex-col gap-2 rounded border border-border border-s-4 border-s-accent bg-surface-2 p-3" data-testid="caption-grant-revoke-confirm">
                    <p id={`${ids}-revoke-${g.id}`} className="font-medium text-fg">{t('captionMinutes.revokeTitle')}</p>
                    <p className="text-fg-muted">{t('captionMinutes.revokeBody')}</p>
                    <label className="flex flex-col gap-1 text-fg-muted">
                      <span className="text-fg">{t('captionMinutes.revokeReason')}</span>
                      <input type="text" autoFocus value={revokeReason} maxLength={CAPTION_GRANT_BOUNDS.reason.max} onChange={(e) => setRevokeReason(e.target.value)} className={fieldClass} data-testid="caption-grant-revoke-reason" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={smallButtonClass} onClick={() => setRevoking(null)}>{t('content.cancel')}</button>
                      <button type="button" className={dangerButtonClass} disabled={busy || !revokeReason.trim()} onClick={() => void confirmRevoke(g.id)} data-testid="caption-grant-revoke-submit">
                        {t('captionMinutes.revoke')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
