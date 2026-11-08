'use client';

import { useEffect } from 'react';

interface HtmlLocaleAttributesProps {
  locale: string;
  dir: 'ltr' | 'rtl';
}

/**
 * Keeps <html lang dir> in sync with the active locale.
 *
 * The root layout renders the attributes for the initial request, but it is
 * not re-rendered on client-side navigation between locales (e.g. /en -> /ar),
 * so the locale layout updates the document element here.
 */
export function HtmlLocaleAttributes({ locale, dir }: HtmlLocaleAttributesProps) {
  useEffect(() => {
    const html = document.documentElement;
    if (html.lang !== locale) html.lang = locale;
    if (html.dir !== dir) html.dir = dir;
  }, [locale, dir]);

  return null;
}
