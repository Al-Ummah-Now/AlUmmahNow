import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HELP_AR, HELP_EN, joinMeta } from '@al-ummah/shared-types';
import { HelpTopicPage } from '@/components/help/HelpTopicPage';
import { HelpNetworksProvider } from '@/components/help/HelpNetworks';
import { getHelpNetworks } from '@/lib/help/social-server';
import { helpTopicExists } from '@/lib/help/features-server';
import { isHelpTopic } from '@/lib/help/content';

type Params = Promise<{ locale: string; topic: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, topic } = await params;
  if (!isHelpTopic(topic) || !(await helpTopicExists(topic))) return {};
  const h = locale === 'ar' ? HELP_AR : HELP_EN;
  return { title: joinMeta(locale, [h.topics[topic].title, h.title]), description: h.topics[topic].summary };
}

export default async function HelpTopicRoute({ params }: { params: Params }) {
  const { topic } = await params;
  if (!isHelpTopic(topic) || !(await helpTopicExists(topic))) notFound();
  // Only the Social topic and the search read the network list
  const networks = await getHelpNetworks();
  return (
    <HelpNetworksProvider networks={networks}>
      <HelpTopicPage topic={topic} />
    </HelpNetworksProvider>
  );
}
