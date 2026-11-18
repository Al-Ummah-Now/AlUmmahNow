'use client';
/** The social networks Help may name (read on the server per request, lib/help/social-server.ts), and t.help adapted to them. */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { HelpTranslations, SocialNetwork } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { helpForNetworks } from '@/lib/help/social';

const HelpNetworksContext = createContext<readonly SocialNetwork[]>([]);

export function HelpNetworksProvider({ networks, children }: { networks: readonly SocialNetwork[]; children: ReactNode }) {
  return <HelpNetworksContext.Provider value={networks}>{children}</HelpNetworksContext.Provider>;
}

/** t.help with the Social topic naming only the networks that are on */
export function useHelp(other?: HelpTranslations): { help: HelpTranslations; other?: HelpTranslations } {
  const { t, lang } = useLanguage();
  const networks = useContext(HelpNetworksContext);
  const names = t.studio.social.networks;
  return useMemo(
    () => ({
      help: helpForNetworks(t.help, networks, names, lang),
      ...(other ? { other: helpForNetworks(other, networks, names, lang === 'ar' ? 'en' : 'ar') } : {}),
    }),
    [t.help, other, networks, names, lang],
  );
}
