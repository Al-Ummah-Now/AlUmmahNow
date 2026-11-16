'use client';

/** Client-only: the number and money formats of the Backfill page (labels.ts stays importable by the server page). */
import { useMemo } from 'react';

import { useLanguage } from '@/i18n/I18nProvider';
import { deliveryFormats } from '../delivery/format';
import { moneyFormat } from '@al-ummah/shared-types';

/** The Delivery page's formats, but money always to the cent (a budget cap of $12.69 must not read "$13"). */
export function useFormats() {
  const { locale } = useLanguage();
  return useMemo(() => {
    const base = deliveryFormats(locale);
    const cents = moneyFormat(locale, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { ...base, usd: (v: number) => cents.format(v) };
  }, [locale]);
}
