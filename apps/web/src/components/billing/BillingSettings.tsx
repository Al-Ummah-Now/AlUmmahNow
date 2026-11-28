/**
 * Settings › Billing (wiki AUN-SUBS): the user's subscriptions with their
 * status, renewal or end date, amount and provider; Cancel (in-app confirm,
 * the tier stays until the paid period ends) and Manage billing (the
 * provider's portal, when it has one); and the payment history with
 * receipts. Data from GET /api/me/billing.
 */
'use client';

import '@/theme/upgrade.css';
import '@/theme/billing.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CreditCard, ExternalLink, Receipt } from 'lucide-react';
import { type BillingPayment, type BillingSubscription, type MyBilling, type PublicTier } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { QUIET } from '@/components/upgrade/buttons';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { refreshCreatorAccess } from '@/hooks/useCreatorAccess';
import { cancelBillingSubscription, fetchMyBilling, fetchPaymentReceipt, openBillingPortal } from '@/lib/api/billing-client';
import { fetchUpgradeOverview } from '@/lib/api/tier-requests-client';
import type { BillingTranslations as BillingCopy } from '@al-ummah/shared-types';
import { billingErrorMessage, billingLocale, canCancel, fillBillingCopy, priceLabel, sortSubscriptions, subscriptionDateLine } from '@/lib/billing/pay';
import { tierName } from '@/lib/upgrade/tiers';
import { formatAbsoluteDate } from '@/lib/format/videoMeta';
import { formatBillingAmount } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { getApiUrl } from '@/lib/runtime-config';
import { safeBillingRedirectUrl } from '@/lib/security/safe-input';

import { MetaSep } from '@/components/ui/MetaSep';
type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; billing: MyBilling };

/** After a cancel the job runs in the queue: look again a few times so the row updates on its own. */
const CANCEL_RECHECK_MS = [3_000, 8_000, 15_000, 30_000];


export function BillingSettings() {
  const { t, lang, dir } = useLanguage();
  const l = lang === 'ar' ? 'ar' : 'en';
  const copy = t.billing;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tiers, setTiers] = useState<PublicTier[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const reload = useCallback(async () => {
    const res = await fetchMyBilling();
    if (res.ok && res.result) {
      setLoad({ status: 'ready', billing: res.result });
      return;
    }
    logger.warn('[billing] My billing not loaded', { status: res.status, code: res.code });
    if (res.status === 0 || res.status >= 500) reportError(new Error(`My billing failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true });
    setLoad({ status: 'error' });
  }, []);

  useEffect(() => {
    void reload();
    // Arabic tier names (best effort: the billing rows carry the English name)
    void fetchUpgradeOverview().then((res) => {
      if (res.ok && res.result) setTiers(res.result.tiers);
    });
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [reload]);

  const labelOf = (sub: BillingSubscription) => {
    const tier = tiers.find((x) => x.id === sub.tierId);
    return tier ? tierName(tier, l) : sub.tierName;
  };
  const date = (iso: string) => formatAbsoluteDate(iso, l);

  const cancel = async (sub: BillingSubscription) => {
    const name = labelOf(sub);
    const until = sub.currentPeriodEnd;
    const ok = await confirm({
      title: fillBillingCopy(copy.settings.cancelTitle, { tier: name }),
      description: until ? fillBillingCopy(copy.settings.cancelBody, { tier: name, date: date(until) }) : fillBillingCopy(copy.settings.cancelBodyNow, { tier: name }),
      confirmLabel: copy.settings.cancelConfirm,
      cancelLabel: copy.settings.keep,
      danger: true,
      testId: 'billing-cancel-dialog',
    });
    if (!ok) return;
    setFailure(null);
    setNotice(null);
    const res = await cancelBillingSubscription(sub.id);
    if (!res.ok) {
      logger.warn('[billing] Cancel refused', { subscriptionId: sub.id, status: res.status, code: res.code });
      if (res.status === 0 || res.status >= 500) reportError(new Error(`Billing cancel failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true, extra: { subscriptionId: sub.id } });
      setFailure(billingErrorMessage(res.code, copy));
      await reload();
      return;
    }
    setNotice(copy.settings.cancelRequested);
    timers.current.forEach(clearTimeout);
    timers.current = CANCEL_RECHECK_MS.map((ms) => setTimeout(() => void reload().then(() => refreshCreatorAccess()), ms));
  };

  const manage = async () => {
    setPortalBusy(true);
    setFailure(null);
    const res = await openBillingPortal();
    const portalUrl = res.ok ? safeBillingRedirectUrl(res.result?.url, getApiUrl()) : null;
    if (portalUrl) {
      window.location.assign(portalUrl);
      return;
    }
    logger.warn('[billing] Portal not opened', { status: res.status, code: res.code });
    if (res.status === 0 || res.status >= 500) reportError(new Error(`Billing portal failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true });
    setFailure(billingErrorMessage(res.code, copy));
    setPortalBusy(false);
  };

  const billing = load.status === 'ready' ? load.billing : null;
  const subs = billing ? sortSubscriptions(billing.subscriptions) : [];

  return (
    <main id={MAIN_CONTENT_ID} className="bil" dir={dir} data-testid="billing-settings">
      <header className="bil-head">
        <span className="bil-head-icon"><CreditCard aria-hidden="true" /></span>
        <div>
          <h1 className="bil-title">{copy.settings.title}</h1>
          <p className="bil-lead">{copy.settings.description}</p>
        </div>
      </header>

      <p className="upg-notice" role="status" aria-live="polite" data-testid="billing-notice">{notice}</p>
      {failure && <p className="upg-err upg-form-err bil-failure" role="alert" data-testid="billing-error">{failure}</p>}

      {load.status === 'loading' && (
        <div className="bil-skel-wrap" aria-busy="true" data-testid="billing-loading">
          <div data-slot="card" className="bil-card bil-skel" aria-hidden="true" />
          <div data-slot="card" className="bil-card bil-skel bil-skel-short" aria-hidden="true" />
        </div>
      )}
      {load.status === 'error' && (
        <div className="upg-error" data-slot="card" role="alert" data-testid="billing-load-error">
          <p>{copy.errors.loadFailed}</p>
          <button type="button" className={QUIET} data-slot="button" onClick={() => { setLoad({ status: 'loading' }); void reload(); }}>{copy.errors.retry}</button>
        </div>
      )}

      {billing && (
        <>
          <section className="bil-section" aria-labelledby="bil-subs-h">
            <div className="bil-section-head">
              <h2 id="bil-subs-h" className="bil-h2">{copy.settings.subscriptionsHeading}</h2>
              {billing.portal && (
                <button type="button" className={`${QUIET} bil-manage`} data-slot="button" onClick={() => void manage()} disabled={portalBusy} data-testid="billing-portal">
                  <ExternalLink aria-hidden="true" />
                  {portalBusy ? copy.settings.opening : copy.settings.manage}
                </button>
              )}
            </div>
            {subs.length === 0 ? (
              <div data-slot="card" className="bil-card bil-empty" data-testid="billing-no-subscriptions">
                <p>{copy.settings.noSubscriptions}</p>
              </div>
            ) : (
              <ul className="bil-subs">
                {subs.map((sub) => (
                  <SubscriptionRow key={sub.id} sub={sub} name={labelOf(sub)} lang={l} copy={copy} date={date} onCancel={() => void cancel(sub)} />
                ))}
              </ul>
            )}
          </section>

          <section className="bil-section" aria-labelledby="bil-pay-h">
            <h2 id="bil-pay-h" className="bil-h2">{copy.settings.paymentsHeading}</h2>
            {billing.payments.length === 0 ? (
              <div data-slot="card" className="bil-card bil-empty" data-testid="billing-no-payments"><p>{copy.settings.noPayments}</p></div>
            ) : (
              <PaymentsTable payments={billing.payments} lang={l} copy={copy} date={date} />
            )}
          </section>
        </>
      )}
      {dialog}
    </main>
  );
}

function SubscriptionRow({ sub, name, lang, copy, date, onCancel }: { sub: BillingSubscription; name: string; lang: string; copy: BillingCopy; date: (iso: string) => string; onCancel: () => void }) {
  const comp = sub.provider === 'manual';
  const dateLine = subscriptionDateLine(sub, date, copy);
  const amount = sub.amount !== null && sub.currency && sub.period ? priceLabel({ amount: sub.amount, currency: sub.currency, period: sub.period }, lang, copy) : null;
  const status = sub.cancelAtPeriodEnd && sub.status === 'active' ? 'canceled' : sub.status;
  return (
    <li data-slot="card" className="bil-card bil-sub" data-status={sub.status} data-testid={`billing-subscription-${sub.tierId}`}>
      <div className="bil-sub-main">
        <div className="bil-sub-title">
          <h3 className="bil-h3">{name}</h3>
          <span className="bil-badge" data-status={status} data-testid="billing-subscription-status">{copy.settings.status[status]}</span>
          {sub.mode === 'test' && <span className="upg-pay-test">{copy.settings.testMode}</span>}
        </div>
        <p className="bil-sub-meta">
          {comp ? copy.settings.complimentary : amount}
          {!comp && <MetaSep lang={lang} en="·" gap="6px" className="bil-dot" />}
          {!comp && <span>{fillBillingCopy(copy.settings.via, { provider: copy.providers[sub.provider as keyof BillingCopy["providers"]] ?? sub.provider })}</span>}
        </p>
        {dateLine && <p className="bil-sub-date" data-testid="billing-subscription-date">{dateLine}</p>}
        {sub.status === 'past_due' && (
          <p className="bil-warn" role="note"><AlertTriangle aria-hidden="true" />{copy.settings.pastDueNote}</p>
        )}
      </div>
      {canCancel(sub) && (
        <div className="bil-sub-actions">
          <button type="button" className={QUIET} data-slot="button" onClick={onCancel} data-testid={`billing-cancel-${sub.tierId}`}>{copy.settings.cancel}</button>
        </div>
      )}
    </li>
  );
}

/** Receipts of providers that make short-lived links (receiptsOnRequest): fetched when asked for, opened in a new tab. */
function ReceiptOnRequest({ paymentId, copy }: { paymentId: string; copy: BillingCopy }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    // Opened before the request so the browser treats it as the click's own tab, not a pop-up
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    const res = await fetchPaymentReceipt(paymentId);
    setBusy(false);
    const url = res.ok ? res.result?.url : undefined;
    if (url && /^https:\/\//.test(url)) {
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      return;
    }
    tab?.close();
    logger.warn('[billing] Receipt link failed', { paymentId, status: res.status, code: res.code });
    if (res.status === 0 || res.status >= 500) reportError(new Error(`Billing receipt failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true, extra: { paymentId } });
    setFailed(true);
  };
  return (
    <span className="bil-receipt-req">
      <button type="button" className="bil-link bil-link-btn" onClick={() => void open()} aria-busy={busy || undefined} data-testid="billing-receipt-request">
        <Receipt aria-hidden="true" />
        {busy ? copy.settings.opening : copy.settings.payment.open}
      </button>
      {failed && <span className="bil-receipt-error" role="alert">{copy.errors.providerError}</span>}
    </span>
  );
}

function PaymentsTable({ payments, lang, copy, date }: { payments: BillingPayment[]; lang: string; copy: BillingCopy; date: (iso: string) => string }) {
  const p = copy.settings.payment;
  const money = (amount: number, currency: string) => formatBillingAmount(amount, currency, billingLocale(lang));
  return (
    <div data-slot="card" data-glass="lite" className="bil-card bil-table-wrap">
      <table className="bil-table" data-testid="billing-payments">
        <thead>
          <tr>
            <th scope="col">{p.date}</th>
            <th scope="col">{p.amount}</th>
            <th scope="col">{p.status}</th>
            <th scope="col"><span className="sr-only">{p.receipt}</span></th>
          </tr>
        </thead>
        <tbody>
          {[...payments].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((pay) => (
            <tr key={pay.id} data-testid="billing-payment" data-status={pay.status}>
              <td data-label={p.date}>{date(pay.occurredAt)}</td>
              <td data-label={p.amount} className="bil-num">
                <span>
                  {money(pay.amount, pay.currency)}
                  {pay.status === 'partially_refunded' && pay.refundedAmount > 0 && (
                    <span className="bil-refunded">{fillBillingCopy(copy.settings.refundedPart, { amount: money(pay.refundedAmount, pay.currency) })}</span>
                  )}
                </span>
              </td>
              <td data-label={p.status}>
                <span>
                  <span className="bil-badge" data-status={pay.status}>{copy.settings.paymentStatus[pay.status]}</span>
                  {pay.mode === 'test' && <span className="upg-pay-test bil-test-inline">{copy.settings.testMode}</span>}
                </span>
              </td>
              <td data-label={p.receipt} className="bil-receipt">
                {pay.receiptUrl && /^https:\/\//.test(pay.receiptUrl) ? (
                  <a href={pay.receiptUrl} target="_blank" rel="noopener noreferrer" className="bil-link" data-testid="billing-receipt">
                    <Receipt aria-hidden="true" />
                    {p.open}
                  </a>
                ) : pay.receiptOnRequest ? (
                  <ReceiptOnRequest paymentId={pay.id} copy={copy} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
