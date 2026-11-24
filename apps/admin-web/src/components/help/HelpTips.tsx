'use client';

/**
 * Hands the page's "?" popovers their text (wiki AUN-ADMIN-HELP). A server page wraps its settings
 * in <HelpTips tips={tipsFor(locale, 'area')}> so only that area's brief texts reach the browser.
 */
import { createContext, useContext } from 'react';
import type { HelpTipData } from '@/lib/help/content';

const HelpTipsContext = createContext<Readonly<Record<string, HelpTipData>>>({});

export function HelpTips({ tips, children }: { tips: Record<string, HelpTipData>; children: React.ReactNode }) {
  const parent = useContext(HelpTipsContext);
  return <HelpTipsContext.Provider value={{ ...parent, ...tips }}>{children}</HelpTipsContext.Provider>;
}

export function useHelpTip(id: string): HelpTipData | null {
  return useContext(HelpTipsContext)[id] ?? null;
}
