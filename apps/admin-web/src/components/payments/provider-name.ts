/**
 * A payment provider's display name (server and client): brand names as they
 * are, the test provider and admin comps in the admin's language.
 */
import { PAYMENT_PROVIDERS, type BillingProviderId } from '@al-ummah/shared-types';
import type { Translator } from '@/i18n/translate';

export function providerName(t: Translator, id: BillingProviderId): string {
  if (id === 'manual') return t('payments.providerNames.manual');
  if (id === 'fake') return t('payments.providerNames.fake');
  return PAYMENT_PROVIDERS[id].name;
}
