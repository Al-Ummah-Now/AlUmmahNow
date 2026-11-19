/**
 * Autofill (owner 2026-11-16): the pay choices on /upgrade are a real form with named fields and
 * standard tokens, labels for every field, and no card fields on our page (the card is entered on
 * the provider's hosted checkout, where password managers fill it).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { BillingPlans } from '@al-ummah/shared-types';
import { BILLING_EN } from '@al-ummah/shared-types';
import { TierPricing } from '../PayParts';

jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const plans: BillingPlans = {
  providers: [
    { id: 'fake', name: 'Test provider', mode: 'test' },
    { id: 'paygood', name: 'PayGood', mode: 'test' },
  ],
  offers: [
    {
      tierId: 'creator',
      prices: [
        { period: 'month', currency: 'USD', amount: 500, providers: ['fake', 'paygood'] },
        { period: 'month', currency: 'EUR', amount: 450, providers: ['fake', 'paygood'] },
        { period: 'year', currency: 'USD', amount: 5000, providers: ['fake', 'paygood'] },
      ],
    },
  ],
  pricesIncludeTax: true,
  taxRatePercent: null,
};

describe('pay form autofill', () => {
  it('period, currency and provider are named fields of one real form; currency carries autocomplete="transaction-currency"; Subscribe submits it', () => {
    render(<TierPricing tierId="creator" tierLabel="Creator" offer={plans.offers[0]} plans={plans} lang="en" locale="en" signedIn copy={BILLING_EN} busy={false} error={null} onSubscribe={jest.fn()} />);
    const form = screen.getByTestId('tier-creator-pay-form');
    expect(form.tagName).toBe('FORM');
    const currency = screen.getByTestId('tier-creator-currency');
    expect(form.contains(currency)).toBe(true);
    expect(currency).toHaveAttribute('name', 'currency');
    expect(currency).toHaveAttribute('autocomplete', 'transaction-currency');
    expect(document.querySelector(`label[for="${currency.id}"]`)).not.toBeNull();
    for (const radio of form.querySelectorAll('input[type=radio]')) expect(radio.getAttribute('name')).toBeTruthy();
    expect(screen.getByTestId('tier-creator-subscribe')).toHaveAttribute('type', 'submit');
    expect(form.contains(screen.getByTestId('tier-creator-subscribe'))).toBe(true);
    expect(form.querySelectorAll('[autocomplete="off"]')).toHaveLength(0);
  });

  it('never has card fields on our page (number, expiry, CVC stay on the provider\'s hosted checkout)', () => {
    const { container } = render(<TierPricing tierId="creator" tierLabel="Creator" offer={plans.offers[0]} plans={plans} lang="en" locale="en" signedIn copy={BILLING_EN} busy={false} error={null} onSubscribe={jest.fn()} />);
    expect(container.querySelectorAll('[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i], input[name*="cvv" i]')).toHaveLength(0);
  });
});
