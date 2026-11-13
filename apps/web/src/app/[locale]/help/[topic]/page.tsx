import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { HelpTopicPage } from '@/components/help/HelpTopicPage';
import { isHelpTopic } from '@/lib/help/content';

type Params = Promise<{ locale: string; topic: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, topic } = await params;
  if (!isHelpTopic(topic)) return {};
  const h = locale === 'ar' ? HELP_AR : HELP_EN;
  return { title: `${h.topics[topic].title} · ${h.title}`, description: h.topics[topic].summary };
}

export default async function HelpTopicRoute({ params }: { params: Params }) {
  const { topic } = await params;
  if (!isHelpTopic(topic)) notFound();
  return <HelpTopicPage topic={topic} />;
}
