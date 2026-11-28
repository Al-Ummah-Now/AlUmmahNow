/**
 * The /upgrade pay mode (wiki AUN-SUBS): a sellable tier's price block with
 * its period, currency and provider choices and the Subscribe button, the
 * subscribe flow (a redirect to the provider's checkout) and the banner
 * shown after checkout returns (confirming → active, or still processing).
 * While payments are off none of this renders and /upgrade is request-only.
 */
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BadgeCheck, Clock, Loader2 } from 'lucide-react';
import type { BillingOffer, BillingPlans, PaymentProviderId } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { FILLED, QUIET } from '@/components/upgrade/buttons';
import { login } from '@/lib/actions';
import { upgradePath } from '@/lib/auth/sign-in-return';
import { safeNavigationUrl } from '@/lib/security/safe-input';
import { abandonBillingCheckout, fetchMyBilling, fetchMyCheckout, startBillingCheckout } from '@/lib/api/billing-client';
import type { BillingTranslations as BillingCopy } from '@al-ummah/shared-types';
import {
  CHECKOUT_PARAM,
  CONFIRM_POLL_MS,
  billingErrorMessage,
  checkoutIdFrom,
  chooseProvider,
  fillBillingCopy,
  findPrice,
  grantsTier,
  offerCurrencies,
  offerPeriods,
  pollOutcome,
  priceLabel,
  providersFor,
  selectPrice,
  taxNote,
  type PriceSelection,
} from '@/lib/billing/pay';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

/** Drop ?checkout= from the address bar once it has been handled (a reload must not poll again). */
function clearCheckoutParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(CHECKOUT_PARAM)) return;
  url.searchParams.delete(CHECKOUT_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export type ConfirmState =
  | { state: 'confirming'; checkoutId: string }
  | { state: 'done'; tierId: string; tierName: string }
  | { state: 'slow' };

/**
 * After checkout: polls GET /api/me/billing/checkouts/:id every 3 s for up to
 * 2 min until the subscription it started is active (the provider's webhook
 * is queued, so activation lands a few seconds after the payment). A checkout
 * the user left unpaid stops the poll at once.
 */
export function useCheckoutReturn(onActive: () => void, onAbandoned: () => void) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const onAbandonedRef = useRef(onAbandoned);
  onAbandonedRef.current = onAbandoned;

  const startConfirm = useCallback((checkoutId: string) => setConfirm({ state: 'confirming', checkoutId }), []);

  useEffect(() => {
    const checkoutId = checkoutIdFrom(window.location.search);
    if (checkoutId) startConfirm(checkoutId);
  }, [startConfirm]);

  const confirming = confirm?.state === 'confirming' ? confirm : null;
  useEffect(() => {
    if (!confirming) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const began = Date.now();
    const tick = async () => {
      const res = await fetchMyCheckout(confirming.checkoutId);
      if (stopped) return;
      if (!res.ok) logger.warn('[billing] Confirm poll failed', { status: res.status, code: res.code });
      const checkout = res.ok ? (res.result ?? null) : null;
      const outcome = pollOutcome(checkout, Date.now() - began);
      if (outcome.state === 'continue') {
        timer = setTimeout(tick, CONFIRM_POLL_MS);
        return;
      }
      clearCheckoutParam();
      if (outcome.state === 'done' && checkout) {
        // The subscription row carries the tier's name as sold
        const billing = await fetchMyBilling();
        if (stopped) return;
        const sub = billing.result?.subscriptions.find((s) => s.tierId === checkout.tierId && grantsTier(s));
        setConfirm({ state: 'done', tierId: checkout.tierId, tierName: sub?.tierName ?? checkout.tierId });
        onActiveRef.current();
      } else if (outcome.state === 'abandoned') {
        setConfirm(null);
        onAbandonedRef.current();
      } else {
        logger.warn('[billing] Subscription not active after checkout', { checkoutId: confirming.checkoutId });
        setConfirm({ state: 'slow' });
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [confirming]);

  return { confirm, startConfirm };
}

export function CheckoutBanner({ confirm, tierLabel, locale, copy }: { confirm: ConfirmState; tierLabel: (id: string, fallback: string) => string; locale: string; copy: BillingCopy }) {
  const titleId = useId();
  if (confirm.state === 'confirming') {
    return (
      <section className="upg-status upg-pay-status" data-slot="card" data-status="confirming" data-testid="checkout-confirming" aria-labelledby={titleId} aria-busy="true">
        <span className="upg-status-icon"><Loader2 className="upg-spin" aria-hidden="true" /></span>
        <div className="upg-status-text" role="status">
          <h2 id={titleId} className="upg-status-title">{copy.pay.confirmingTitle}</h2>
          <p>{copy.pay.confirmingBody}</p>
        </div>
      </section>
    );
  }
  if (confirm.state === 'done') {
    const name = tierLabel(confirm.tierId, confirm.tierName);
    return (
      <section className="upg-status upg-pay-status" data-slot="card" data-status="approved" data-testid="checkout-success" aria-labelledby={titleId}>
        <span className="upg-status-icon"><BadgeCheck aria-hidden="true" /></span>
        <div className="upg-status-text" role="status">
          <h2 id={titleId} className="upg-status-title">{fillBillingCopy(copy.pay.successTitle, { tier: name })}</h2>
          <p>{copy.pay.successBody}</p>
        </div>
        <div className="upg-status-action upg-pay-links">
          <Link href={`/${locale}/studio`} className={FILLED} data-slot="button" data-testid="checkout-success-studio">{copy.pay.goToStudio}</Link>
          <Link href={`/${locale}/settings/billing`} className={QUIET} data-slot="button" data-testid="checkout-success-billing">{copy.pay.viewBilling}</Link>
        </div>
      </section>
    );
  }
  return (
    <section className="upg-status upg-pay-status" data-slot="card" data-status="pending" data-testid="checkout-slow" aria-labelledby={titleId}>
      <span className="upg-status-icon"><Clock aria-hidden="true" /></span>
      <div className="upg-status-text" role="status">
        <h2 id={titleId} className="upg-status-title">{copy.pay.slowTitle}</h2>
        <p>{copy.pay.slowBody}</p>
      </div>
      <div className="upg-status-action">
        <Link href={`/${locale}/settings/billing`} className={QUIET} data-slot="button" data-testid="checkout-slow-billing">{copy.pay.viewBilling}</Link>
      </div>
    </section>
  );
}

export interface SubscribeRequest {
  tierId: string;
  selection: PriceSelection;
  provider: PaymentProviderId;
}

/** Starts a checkout: a redirect to the provider's (or the test provider's) checkout page. */
export function useSubscribe({ locale, copy }: { locale: string; copy: BillingCopy }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ tierId: string; message: string } | null>(null);

  const subscribe = async ({ tierId, selection, provider }: SubscribeRequest) => {
    if (busy) return;
    setBusy(tierId);
    setError(null);
    const fail = (message: string) => {
      setError({ tierId, message });
      setBusy(null);
    };
    const res = await startBillingCheckout({ tierId, period: selection.period, currency: selection.currency, provider, returnPath: upgradePath(locale) });
    if (!res.ok || !res.result) {
      logger.warn('[billing] Checkout refused', { tierId, provider, status: res.status, code: res.code });
      if (res.status === 0 || res.status >= 500) reportError(new Error(`Billing checkout failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true, extra: { tierId, provider } });
      return fail(billingErrorMessage(res.code, copy));
    }
    const { checkoutId, url } = res.result;
    const safeUrl = safeNavigationUrl(url, { allowRelative: true });
    if (safeUrl) {
      window.location.assign(safeUrl);
      return;
    }
    reportError(new Error('Billing checkout returned no URL'), { kind: 'caught', shown: true, extra: { tierId, provider } });
    void abandonBillingCheckout(checkoutId);
    fail(copy.errors.failed);
  };

  return { subscribe, busy, error };
}

/** A sellable tier's card footer: price, choices and Subscribe (or sign in first). */
export function TierPricing({
  tierId,
  tierLabel,
  offer,
  plans,
  lang,
  locale,
  signedIn,
  copy,
  busy,
  error,
  onSubscribe,
}: {
  tierId: string;
  tierLabel: string;
  offer: BillingOffer;
  plans: BillingPlans;
  lang: string;
  locale: string;
  signedIn: boolean;
  copy: BillingCopy;
  busy: boolean;
  error: string | null;
  onSubscribe: (request: SubscribeRequest) => void;
}) {
  const ids = useId();
  const [wanted, setWanted] = useState<Partial<PriceSelection>>({});
  const [picked, setPicked] = useState<PaymentProviderId | null>(null);
  const selection = selectPrice(offer, wanted);
  if (!selection) return null;
  const price = findPrice(offer, selection);
  if (!price) return null;
  const periods = offerPeriods(offer);
  const currencies = offerCurrencies(offer, selection.period);
  // The currency row stays put when a period has only one currency (it shows that one), so switching
  // Monthly/Yearly never makes the card jump
  const anyChoice = periods.some((period) => offerCurrencies(offer, period).length > 1);
  const able = providersFor(plans, price);
  const provider = chooseProvider(plans, price, picked);
  const testMode = (provider ? able.filter((p) => p.id === provider) : able).every((p) => p.mode === 'test');

  return (
    <div className="upg-pay" data-testid={`tier-${tierId}-pay`}>
      <div className="upg-price-row">
        <p className="upg-price" data-testid={`tier-${tierId}-price`}>{priceLabel(price, lang, copy)}</p>
        {testMode && <span className="upg-pay-test">{copy.settings.testMode}</span>}
      </div>
      <p className="upg-tax" data-testid={`tier-${tierId}-tax`}>{taxNote(plans, lang, copy)}</p>
      {/* A real form (autofill and keyboard submit); the card itself is entered on the provider's hosted checkout */}
      <form
        className="upg-pay-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (signedIn && provider && !busy) onSubscribe({ tierId, selection, provider });
        }}
        data-testid={`tier-${tierId}-pay-form`}
      >
      {periods.length > 1 && (
        <fieldset className="upg-seg" data-testid={`tier-${tierId}-period`}>
          <legend className="sr-only">{copy.pay.periodLabel}</legend>
          {periods.map((period) => (
            <label key={period} className="upg-seg-opt">
              <input
                type="radio"
                name={`${ids}-period`}
                value={period}
                checked={selection.period === period}
                onChange={() => setWanted((w) => ({ ...w, period }))}
                data-testid={`tier-${tierId}-period-${period}`}
              />
              <span>{period === 'year' ? copy.pay.yearly : copy.pay.monthly}</span>
            </label>
          ))}
        </fieldset>
      )}

      {anyChoice && currencies.length === 1 && (
        <div className="upg-pay-field" data-testid={`tier-${tierId}-currency-only`}>
          <span className="upg-pay-field-label">{copy.pay.currencyLabel}</span>
          <span className="upg-pay-field-value" dir="ltr">{currencies[0]}</span>
        </div>
      )}

      {currencies.length > 1 && (
        <div className="upg-pay-field">
          <label htmlFor={`${ids}-currency`}>{copy.pay.currencyLabel}</label>
          <select
            id={`${ids}-currency`}
            name="currency"
            autoComplete="transaction-currency"
            className="upg-input upg-select"
            value={selection.currency}
            onChange={(e) => setWanted((w) => ({ ...w, currency: e.target.value }))}
            data-testid={`tier-${tierId}-currency`}
          >
            {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </div>
      )}

      {signedIn && able.length > 1 && (
        <fieldset className="upg-pay-providers" data-testid={`tier-${tierId}-providers`}>
          <legend className="upg-pay-legend">{copy.pay.providerLabel}</legend>
          {able.map((p) => (
            <label key={p.id} className="upg-seg-opt upg-provider-opt">
              <input
                type="radio"
                name={`${ids}-provider`}
                value={p.id}
                checked={provider === p.id}
                onChange={() => setPicked(p.id)}
                data-testid={`tier-${tierId}-provider-${p.id}`}
              />
              <span>{copy.providers[p.id as keyof BillingCopy["providers"]] ?? p.name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {signedIn && (
        <button
          type="submit"
          className={`${FILLED} w-full`}
          data-slot="button"
          disabled={busy || !provider}
          aria-describedby={`${ids}-note`}
          data-testid={`tier-${tierId}-subscribe`}
        >
          {busy ? copy.pay.subscribing : fillBillingCopy(copy.pay.subscribe, { tier: tierLabel })}
        </button>
      )}
      </form>
      {!signedIn && (
        <form action={login.bind(null, locale, upgradePath(locale))}>
          <button type="submit" className={`${QUIET} w-full`} data-slot="button" data-testid={`tier-${tierId}-sign-in`}>{copy.pay.signInToSubscribe}</button>
        </form>
      )}
      {error && <p className="upg-err" role="alert" data-testid={`tier-${tierId}-pay-error`}>{error}</p>}
      <p id={`${ids}-note`} className="upg-help upg-pay-note">{copy.pay.payNote}</p>
    </div>
  );
}
