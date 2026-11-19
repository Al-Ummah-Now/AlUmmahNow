'use client';

/**
 * The subscription page's changes (wiki AUN-SUBS): cancel at the end of the
 * paid period or now (billing:manage), and refund a payment in full or in
 * part with a reason (billing:refund, super admins). Both ask first in the
 * in-app dialog; admin-api asks for a recent sign-in (step-up) and queues the
 * provider call, so the page says it was requested and refreshes.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BILLING_REFUND_REASON_MAX, formatBillingAmount, parseBillingAmount, type AdminBillingSubscriptionRow, type BillingPayment } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { ActionFeedback, useConfirm } from '@/components/content/actions';
import { dangerButtonClass, primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass } from '@/components/ui';
import { billingRequest } from '@/lib/list/api-client';
import { canCancelAtPeriodEnd, canCancelSubscription, partialRefundAllowed, refundableAmount } from '@/lib/payments';
import { hintClass, labelClass, providerName, useBillingAction } from './shared';

export function CancelSubscription({ subscription: s }: { subscription: AdminBillingSubscriptionRow }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const { busy, error, notice, run } = useBillingAction('payments-cancel');
  const endAllowed = canCancelAtPeriodEnd(s);
  const [atPeriodEnd, setAtPeriodEnd] = useState(endAllowed);
  const user = s.displayName || t('payments.subs.unknownUser');
  const open = canCancelSubscription(s);
  // Nothing to cancel and nothing to report (a cancel that just went through keeps its message)
  if (!open && !notice && !error) return null;

  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid="payments-cancel">
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-4">
        {t('payments.cancel.button')}
      </h2>
      {dialog}
      <ActionFeedback error={error} message={notice} testId="payments-cancel-feedback" />
      {open && (
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await confirm({ title: t('payments.cancel.title'), body: t('payments.cancel.body', { user, tier: s.tierName }), confirmLabel: t('payments.cancel.confirm'), danger: true, testId: 'payments-cancel-confirm' });
          if (!ok) return;
          const done = await run('cancel', async () => {
            await billingRequest('POST', `subscriptions/${encodeURIComponent(s.id)}/cancel`, { body: { atPeriodEnd } });
            return t('payments.cancel.queued');
          });
          if (done) router.refresh();
        }}
      >
        <fieldset>
          <legend className={labelClass}>{t('payments.cancel.when')}</legend>
          <div className="space-y-2">
            {endAllowed && (
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name={`${ids}-when`} className="mt-0.5" checked={atPeriodEnd} onChange={() => setAtPeriodEnd(true)} aria-describedby={`${ids}-end-hint`} data-testid="payments-cancel-at-end" />
                <span>
                  <span className="block text-fg">{t('payments.cancel.atEnd', { date: s.currentPeriodEnd ? formatDate(s.currentPeriodEnd, locale) : '' })}</span>
                  <span id={`${ids}-end-hint`} className="block text-fg-muted">
                    {t('payments.cancel.atEndHint')}
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name={`${ids}-when`} className="mt-0.5" checked={!atPeriodEnd} onChange={() => setAtPeriodEnd(false)} aria-describedby={`${ids}-now-hint`} data-testid="payments-cancel-now" />
              <span>
                <span className="block text-fg">{t('payments.cancel.now')}</span>
                <span id={`${ids}-now-hint`} className="block text-fg-muted">
                  {t('payments.cancel.nowHint')}
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <button type="submit" className={dangerButtonClass} disabled={busy !== null} data-testid="payments-cancel-submit">
          {t('payments.cancel.button')}
        </button>
      </form>
      )}
    </section>
  );
}

export function RefundPayment({ payment }: { payment: BillingPayment }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const { busy, error, notice, run } = useBillingAction('payments-refund');
  const [open, setOpen] = useState(false);
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const left = refundableAmount(payment);
  const max = formatBillingAmount(left, payment.currency, locale);
  const partOk = partialRefundAllowed(payment);
  if (left <= 0) return null;

  return (
    <div data-testid="payments-refund" data-payment-id={payment.id}>
      {dialog}
      <ActionFeedback error={error} message={notice} testId="payments-refund-feedback" />
      {!open ? (
        <button type="button" className={smallButtonClass} onClick={() => setOpen(true)} aria-label={t('payments.refund.buttonLabel', { amount: formatBillingAmount(payment.amount, payment.currency, locale), date: formatDate(payment.occurredAt, locale) })} data-testid="payments-refund-open">
          {t('payments.refund.button')}
        </button>
      ) : (
        <form
          className="mt-2 space-y-3 rounded border border-border p-3 text-sm"
          aria-labelledby={`${ids}-title`}
          onSubmit={async (e) => {
            e.preventDefault();
            const minor = partial ? parseBillingAmount(amount, payment.currency) : null;
            if (partial && (minor === null || minor <= 0 || minor > left)) {
              setProblem(t('payments.refund.invalidAmount', { max }));
              return;
            }
            if (!reason.trim()) {
              setProblem(t('payments.refund.reasonRequired'));
              return;
            }
            setProblem(null);
            const shown = partial && minor !== null ? formatBillingAmount(minor, payment.currency, locale) : max;
            const ok = await confirm({ title: t('payments.refund.title'), body: `${shown} — ${reason.trim()}`, confirmLabel: t('payments.refund.confirm'), danger: true, testId: 'payments-refund-confirm' });
            if (!ok) return;
            const done = await run('refund', async () => {
              await billingRequest('POST', `payments/${encodeURIComponent(payment.id)}/refund`, { body: { amount: partial ? minor : null, reason: reason.trim() } });
              return t('payments.refund.queued');
            });
            if (done) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <h4 id={`${ids}-title`} className="font-medium text-fg">
            {t('payments.refund.title')}
          </h4>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t('payments.refund.amount')}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name={`${ids}-kind`} checked={!partial} onChange={() => setPartial(false)} data-testid="payments-refund-full" />
              {t('payments.refund.full', { amount: max })}
            </label>
            {partOk ? (
              <label className="flex items-center gap-2">
                <input type="radio" name={`${ids}-kind`} checked={partial} onChange={() => setPartial(true)} data-testid="payments-refund-partial" />
                {t('payments.refund.partial')}
              </label>
            ) : (
              <p className={hintClass}>{t('payments.refund.noPartial', { provider: providerName(t, payment.provider) })}</p>
            )}
          </fieldset>
          {partial && (
            <div>
              <label htmlFor={`${ids}-amount`} className={labelClass}>
                {t('payments.refund.amount')}
              </label>
              <input id={`${ids}-amount`} dir="ltr" inputMode="decimal" className={`${fieldClass} w-40`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={`${ids}-amount-hint`} data-testid="payments-refund-amount" />
              <p id={`${ids}-amount-hint`} className={hintClass}>
                {t('payments.refund.amountHint', { max })}
              </p>
            </div>
          )}
          <div>
            <label htmlFor={`${ids}-reason`} className={labelClass}>
              {t('payments.refund.reason')}
            </label>
            <textarea id={`${ids}-reason`} dir="auto" rows={2} className={`${fieldClass} w-full`} maxLength={BILLING_REFUND_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${ids}-reason-hint`} data-testid="payments-refund-reason" />
            <p id={`${ids}-reason-hint`} className={hintClass}>
              {t('payments.refund.reasonHint')}
            </p>
          </div>
          {problem && (
            <p role="alert" className="text-danger-fg">
              {problem}
            </p>
          )}
          {/* Card footer: actions at the end edge, the main one last (owner rule) */}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="submit" className={`${primarySmallButtonClass} order-last`} disabled={busy !== null} data-testid="payments-refund-submit">
              {t('payments.refund.confirm')}
            </button>
            <button type="button" className={smallButtonClass} onClick={() => setOpen(false)}>
              {t('payments.refund.close')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
