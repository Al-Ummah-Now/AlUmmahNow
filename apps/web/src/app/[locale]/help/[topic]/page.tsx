import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { HelpTopicPage } from '@/components/help/HelpTopicPage';
import { HelpNetworksProvider } from '@/components/help/HelpNetworks';
import { getHelpNetworks } from '@/lib/help/social-server';
import { isHelpTopic } from '@/lib/help/content';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

type Params = Promise<{ locale: string; topic: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, topic } = await params;
  if (!isHelpTopic(topic)) return notFoundMetadata();
  const h = locale === 'ar' ? HELP_AR : HELP_EN;
  return { title: `${h.topics[topic].title} · ${h.title}`, description: h.topics[topic].summary };
}

export default async function HelpTopicRoute({ params }: { params: Params }) {
  const { topic } = await params;
  if (!isHelpTopic(topic)) notFound();
  // Only the Social topic and the search read the network list
  const networks = await getHelpNetworks();
  return (
    <HelpNetworksProvider networks={networks}>
      <HelpTopicPage topic={topic} />
    </HelpNetworksProvider>
  );
}
