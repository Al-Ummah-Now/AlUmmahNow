import type { Metadata } from 'next';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { HelpHome } from '@/components/help/HelpHome';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const h = locale === 'ar' ? HELP_AR : HELP_EN;
  return { title: h.title, description: h.lead };
}

export default function HelpRoute() {
  return <HelpHome />;
}
