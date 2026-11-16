'use client';

/**
 * Payments → Prices (wiki AUN-SUBS): each tier's prices per period and
 * currency, entered in major units (9.99) and stored in minor units, each
 * with its active switch and its sync status at every provider; how the tier
 * is offered (sell automatically or by request only); and the buttons that
 * sync prices to a provider. Prices, sale modes: billing:manage. Sync:
 * billing:providers.
 */
import { useId, useMemo, useRef, useState } from 'react';
import {
  BILLING_PERIODS,
  BILLING_PRICE_BOUNDS,
  currencyExponent,
  PAYMENT_PROVIDERS,
  formatBillingAmount,
  isCurrencyCode,
  parseBillingAmount,
  type BillingPeriod,
  type PaymentProviderConfig,
  type TierPrice,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ActionFeedback } from '@/components/content/actions';
import { dangerButtonClass, primarySmallButtonClass, smallButtonClass, tableWrapClass } from '@/components/content/parts';
import { cardClass, fieldClass } from '@/components/ui';
import { billingRequest } from '@/lib/list/api-client';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { LINK_TONE, linkFor, linkState, pricesByTier } from '@/lib/payments';
import { ToneChip, hintClass, labelClass, providerName, sectionTitle, useBillingAction } from './shared';

export interface TierOption {
  id: string;
  name: string;
}

interface Props {
  prices: TierPrice[];
  tiers: TierOption[];
  providers: PaymentProviderConfig[];
  canManage: boolean;
  canSync: boolean;
  onRefresh: () => Promise<void>;
}

type Draft = { tierId: string; period: BillingPeriod; currency: string; amount: string };

const EXAMPLE: Record<number, string> = { 0: '1000', 2: '9.99', 3: '9.990' };

export function PricesPanel({ prices, tiers, providers, canManage, canSync, onRefresh }: Props) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { busy, error, notice, run } = useBillingAction('payments-prices');
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>({ tierId: tiers[0]?.id ?? '', period: 'month', currency: 'USD', amount: '' });
  const [invalid, setInvalid] = useState<string | null>(null);
  const locked = !canManage || busy !== null;

  const tierName = (id: string) => tiers.find((x) => x.id === id)?.name ?? id;
  const periodName = (p: BillingPeriod) => t(`payments.periods.${p}`);
  const groups = useMemo(() => pricesByTier(prices, tiers.map((x) => x.id)), [prices, tiers]);
  // Providers whose status a price shows: the ones that are on, and any that already hold a link
  const syncProviders = providers.filter((p) => p.enabled || prices.some((pr) => pr.links.some((l) => l.provider === p.id)));
  const currencies = useMemo(() => [...new Set(providers.flatMap((p) => PAYMENT_PROVIDERS[p.id].currencies ?? []))].sort(), [providers]);

  const currency = draft.currency.trim().toUpperCase();
  const exponentExample = (c: string) => EXAMPLE[currencyExponent(c)] ?? EXAMPLE[2];
  const unsupported = isCurrencyCode(currency) ? providers.filter((p) => p.enabled && PAYMENT_PROVIDERS[p.id].currencies && !PAYMENT_PROVIDERS[p.id].currencies!.includes(currency)) : [];

  const { run: withUndo } = useUndoableAction();
  type PriceRow = { id: string; tierId: string; period: BillingPeriod; currency: string; amount: number; active: boolean };
  /** Puts a price back as it was (Undo of a save or a delete). */
  const restore = async (p: PriceRow) => {
    await billingRequest('PUT', 'prices', { body: { tierId: p.tierId, period: p.period, currency: p.currency, amount: p.amount, active: p.active, undo: true } });
    await onRefresh();
  };
  const save = (body: { tierId: string; period: BillingPeriod; currency: string; amount: number; active?: boolean }, key: string, message: string) =>
    run(key, async () => {
      await withUndo({
        action: () => billingRequest<{ previous: PriceRow | null; price: PriceRow }>('PUT', 'prices', { body }),
        // A new price is removed again; a changed one gets its old amount and state back
        undo: async (r) => {
          if (r.previous) return restore(r.previous);
          await billingRequest('DELETE', `prices/${encodeURIComponent(r.price.id)}`, { body: {} });
          await onRefresh();
        },
        message,
        undoneMessage: t('payments.undone'),
      });
      await onRefresh();
      return null;
    });

  const submit = async () => {
    if (!draft.tierId) return;
    if (!isCurrencyCode(currency)) {
      setInvalid(t('payments.prices.invalidCurrency'));
      return;
    }
    const amount = parseBillingAmount(draft.amount, currency);
    const example = exponentExample(currency);
    if (amount === null) {
      setInvalid(t('payments.prices.invalidAmount', { example }));
      return;
    }
    const { min, max } = BILLING_PRICE_BOUNDS.amount;
    if (amount < min || amount > max) {
      setInvalid(t('payments.prices.outOfBounds', { min: formatBillingAmount(min, currency, locale), max: formatBillingAmount(max, currency, locale) }));
      return;
    }
    setInvalid(null);
    const existing = prices.find((p) => p.tierId === draft.tierId && p.period === draft.period && p.currency === currency);
    if (await save({ tierId: draft.tierId, period: draft.period, currency, amount, active: existing?.active ?? true }, 'save', t('payments.prices.savedNotice'))) {
      setDraft((d) => ({ ...d, amount: '' }));
    }
  };

  return (
    <div className="space-y-6" data-testid="payments-prices">
      <p className="text-sm text-fg-muted max-w-prose">{t('payments.prices.hint')}</p>
      {!canManage && <p className="text-sm text-fg-muted">{t('payments.prices.readOnly')}</p>}
      <ActionFeedback error={error} message={notice} testId="payments-prices-feedback" />

      {canSync && (
        <section className={cardClass} aria-labelledby={`${ids}-sync`}>
          <h2 id={`${ids}-sync`} className={sectionTitle}>
            {t('payments.prices.syncTitle')}
          </h2>
          <p className={`${hintClass} mb-3`}>{t('payments.prices.syncHint')}</p>
          {providers.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('payments.prices.noProviders')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={smallButtonClass}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`sync-${p.id}`, async () => {
                      await billingRequest('POST', `providers/${p.id}/sync-prices`, { body: {} });
                      return t('payments.provider.syncQueued', { provider: providerName(t, p.id) });
                    })
                  }
                  data-testid={`payments-prices-sync-${p.id}`}
                >
                  {t('payments.provider.sync', { provider: providerName(t, p.id) })}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {tiers.length === 0 && <p className="text-fg-muted">{t('payments.prices.noTiers')}</p>}

      {canManage && tiers.length > 0 && (
        <section className={cardClass} aria-labelledby={`${ids}-add`}>
          <h2 id={`${ids}-add`} className={`${sectionTitle} mb-3`}>
            {t('payments.prices.addTitle')}
          </h2>
          <form
            ref={formRef}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_8rem_10rem_auto] lg:items-start [&>*]:min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            data-testid="payments-price-form"
          >
            <div>
              <label htmlFor={`${ids}-tier`} className={labelClass}>
                {t('payments.prices.tier')}
              </label>
              <select id={`${ids}-tier`} className={`${fieldClass} w-full`} value={draft.tierId} onChange={(e) => setDraft((d) => ({ ...d, tierId: e.target.value }))} data-testid="payments-price-tier">
                {tiers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-period`} className={labelClass}>
                {t('payments.prices.period')}
              </label>
              <select id={`${ids}-period`} className={`${fieldClass} w-full`} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value as BillingPeriod }))} data-testid="payments-price-period">
                {BILLING_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {periodName(p)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-currency`} className={labelClass}>
                {t('payments.prices.currency')}
              </label>
              <input id={`${ids}-currency`} dir="ltr" className={`${fieldClass} w-full uppercase`} maxLength={3} list={`${ids}-currencies`} autoComplete="off" value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} data-testid="payments-price-currency" />
              <datalist id={`${ids}-currencies`}>
                {currencies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={`${ids}-amount`} className={labelClass}>
                {t('payments.prices.amount')}
              </label>
              <input id={`${ids}-amount`} dir="ltr" inputMode="decimal" className={`${fieldClass} w-full`} value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} aria-describedby={`${ids}-amount-hint`} aria-invalid={invalid ? true : undefined} data-testid="payments-price-amount" />
              <p id={`${ids}-amount-hint`} className={hintClass}>
                {isCurrencyCode(currency) ? t('payments.prices.amountHint', { currency, example: exponentExample(currency) }) : ''}
              </p>
            </div>
            <div className="lg:pt-6">
              <button type="submit" className={primarySmallButtonClass} disabled={locked || !draft.amount.trim()} data-testid="payments-price-save">
                {t('payments.prices.save')}
              </button>
            </div>
            {(invalid || unsupported.length > 0) && (
              <div className="sm:col-span-2 lg:col-span-5 space-y-1" aria-live="polite">
                {invalid && (
                  <p role="alert" className="text-sm text-danger-fg">
                    {invalid}
                  </p>
                )}
                {unsupported.map((p) => (
                  <p key={p.id} className="text-sm text-fg-muted">
                    {t('payments.prices.unsupported', { provider: providerName(t, p.id), currency })}
                  </p>
                ))}
              </div>
            )}
          </form>
        </section>
      )}

      {groups.map(({ tierId, prices: rows }) => (
        <section key={tierId} className={cardClass} aria-labelledby={`${ids}-tier-${tierId}`} data-testid={`payments-tier-${tierId}`}>
          <h2 id={`${ids}-tier-${tierId}`} className={`${sectionTitle} mb-3`} dir="auto">
            {tierName(tierId)}
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted mt-3">{t('payments.prices.none')}</p>
          ) : (
            <div className={`${tableWrapClass} relative mt-4`}>
              {/* Phones: each price is a stack of label/value rows (the header row is hidden and each cell names itself) */}
              <table className="w-full text-sm max-sm:block" data-testid={`payments-prices-table-${tierId}`}>
                <thead className="bg-surface-2 text-fg-muted text-start max-sm:sr-only">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.prices.period')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.prices.amount')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.prices.active')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.prices.sync')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.prices.actions')}</th>
                  </tr>
                </thead>
                <tbody className="max-sm:block">
                  {rows.map((price) => {
                    const labels = { period: periodName(price.period), currency: price.currency, tier: tierName(tierId) };
                    const amountText = formatBillingAmount(price.amount, price.currency, locale);
                    return (
                      <tr key={price.id} className="border-t border-border align-top max-sm:block max-sm:py-2" data-testid="payments-price-row" data-price-id={price.id} data-currency={price.currency} data-period={price.period}>
                        <td className="px-3 py-2 whitespace-nowrap max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:before:content-[attr(data-label)] max-sm:before:text-fg-muted max-sm:before:font-medium max-sm:before:shrink-0" data-label={t('payments.prices.period')}>{periodName(price.period)}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:before:content-[attr(data-label)] max-sm:before:text-fg-muted max-sm:before:font-medium max-sm:before:shrink-0" data-label={t('payments.prices.amount')}>
                          <span className="inline-block" dir="auto">
                            {amountText}
                          </span>
                        </td>
                        <td className="px-3 py-2 max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:before:content-[attr(data-label)] max-sm:before:text-fg-muted max-sm:before:font-medium max-sm:before:shrink-0" data-label={t('payments.prices.active')}>
                          <input
                            type="checkbox"
                            role="switch"
                            className="h-4 w-4 accent-accent"
                            checked={price.active}
                            disabled={locked}
                            aria-label={t('payments.prices.activeLabel', labels)}
                            onChange={(e) => {
                              const active = e.currentTarget.checked;
                              void save({ tierId, period: price.period, currency: price.currency, amount: price.amount, active }, `active-${price.id}`, t(active ? 'payments.prices.activated' : 'payments.prices.deactivated'));
                            }}
                            data-testid="payments-price-active"
                          />
                        </td>
                        <td className="px-3 py-2 max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:before:content-[attr(data-label)] max-sm:before:text-fg-muted max-sm:before:font-medium max-sm:before:shrink-0" data-label={t('payments.prices.sync')}>
                          <ul className="flex flex-wrap gap-1">
                            {syncProviders.map((p) => {
                              const link = linkFor(price, p.id, p.mode);
                              const state = linkState(price, link);
                              return (
                                <li key={p.id} title={link?.error ?? undefined} data-testid={`payments-price-link-${p.id}`} data-state={state}>
                                  <ToneChip tone={LINK_TONE[state]}>
                                    {t('payments.prices.linkLabel', { provider: providerName(t, p.id), mode: t(`payments.modes.${p.mode}`), state: t(`payments.prices.link.${state}`) })}
                                  </ToneChip>
                                  {link?.error && (
                                    <span className="block mt-1 max-w-[16rem] break-words text-xs text-danger-fg" dir="auto">
                                      {link.error}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                        <td className="px-3 py-2 max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:before:content-[attr(data-label)] max-sm:before:text-fg-muted max-sm:before:font-medium max-sm:before:shrink-0" data-label={t('payments.prices.actions')}>
                          {canManage && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={smallButtonClass}
                                disabled={locked}
                                aria-label={t('payments.prices.editLabel', labels)}
                                onClick={() => {
                                  const exp = currencyExponent(price.currency);
                                  setDraft({ tierId, period: price.period, currency: price.currency, amount: (price.amount / 10 ** exp).toFixed(exp) });
                                  formRef.current?.scrollIntoView({ block: 'center' });
                                  formRef.current?.querySelector<HTMLInputElement>('[data-testid="payments-price-amount"]')?.focus();
                                }}
                              >
                                {t('payments.prices.edit')}
                              </button>
                              <button
                                type="button"
                                className={dangerButtonClass}
                                disabled={locked}
                                aria-label={t('payments.prices.deleteLabel', labels)}
                                onClick={async () => {
                                  // Acts at once with Undo (the price comes back as it was)
                                  await run(`delete-${price.id}`, async () => {
                                    await withUndo({
                                      action: () => billingRequest<{ previous: PriceRow | null }>('DELETE', `prices/${encodeURIComponent(price.id)}`, { body: {} }),
                                      undo: async (r) => restore(r.previous ?? { id: price.id, tierId, period: price.period, currency: price.currency, amount: price.amount, active: price.active }),
                                      message: t('payments.prices.deletedNotice'),
                                      undoneMessage: t('payments.undone'),
                                    });
                                    await onRefresh();
                                    return null;
                                  });
                                }}
                                data-testid="payments-price-delete"
                              >
                                {t('payments.prices.delete')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

