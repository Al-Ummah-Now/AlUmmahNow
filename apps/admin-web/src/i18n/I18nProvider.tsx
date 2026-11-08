'use client';

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { getDirection, type Locale, type Theme } from './config';
import { createTranslator, type Translator } from './translate';

interface I18nContextValue {
  locale: Locale;
  theme: Theme;
  dir: 'ltr' | 'rtl';
  isRTL: boolean;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  theme,
  children,
}: {
  locale: Locale;
  theme: Theme;
  children: React.ReactNode;
}): React.ReactElement {
  const value = useMemo<I18nContextValue>(() => {
    const dir = getDirection(locale);
    return { locale, theme, dir, isRTL: dir === 'rtl', t: createTranslator(locale) };
  }, [locale, theme]);

  // createElement rather than JSX: with the hoisted node_modules layout the
  // global JSX namespace comes from the root @types/react@18 (via Next), which
  // rejects a Provider typed by admin-web's own @types/react@19.
  return createElement(I18nContext.Provider, { value }, children as ReactNode) as unknown as React.ReactElement;
}

/** Client-side access to the active locale, direction and translator. */
export function useLanguage(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useLanguage must be used inside <I18nProvider>');
  }
  return value;
}
