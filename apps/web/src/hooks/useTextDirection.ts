'use client';

/**
 * The document's text direction, for shared primitives (dialogs, toasts) that render in a portal
 * outside the page's dir wrapper, so they inherit the page direction: Arabic is right to left.
 * The root layout sets <html dir> on the server and HtmlLocaleAttributes keeps it current on
 * client navigation; embed frames (no locale in the URL) give theirs through LocaleOverrideContext.
 * Unlike useLanguage it loads no translations, so it needs no providers.
 */

import { useContext } from 'react';
import { LocaleOverrideContext } from '@/lib/i18n/locale-override';

export function useTextDirection(): 'ltr' | 'rtl' {
  const override = useContext(LocaleOverrideContext);
  if (override) return override === 'ar' ? 'rtl' : 'ltr';
  // Portals render on the client only, so the document is there when this is read
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}
