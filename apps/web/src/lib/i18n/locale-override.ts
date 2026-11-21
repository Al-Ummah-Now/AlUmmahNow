'use client';

import { createContext } from 'react';
import type { SupportedLanguage } from './types';

/**
 * Language for routes whose URL has no locale segment (embed frames use ?lang=).
 * When set, it wins over the pathname.
 */
export const LocaleOverrideContext = createContext<SupportedLanguage | null>(null);
