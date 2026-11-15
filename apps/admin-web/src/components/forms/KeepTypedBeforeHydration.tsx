'use client';

import { useEffect } from 'react';
import { scheduleKeepTypedBeforeHydration } from '@/lib/forms/keep-typed-before-hydration';

/** Text typed into a form before the page hydrated is kept (#1462). Mounted once in the root layout. */
export function KeepTypedBeforeHydration() {
  useEffect(() => scheduleKeepTypedBeforeHydration(), []);
  return null;
}
