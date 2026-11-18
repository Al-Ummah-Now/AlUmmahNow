import type { Metadata } from 'next';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { HelpHome } from '@/components/help/HelpHome';
import { HelpNetworksProvider } from '@/components/help/HelpNetworks';
import { getHelpNetworks } from '@/lib/help/social-server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const h = locale === 'ar' ? HELP_AR : HELP_EN;
  return { title: h.title, description: h.lead };
}

export default async function HelpRoute() {
  // Search covers the Social topic's sections, which name only the networks that are on
  const networks = await getHelpNetworks();
  return (
    <HelpNetworksProvider networks={networks}>
      <HelpHome />
    </HelpNetworksProvider>
  );
}
