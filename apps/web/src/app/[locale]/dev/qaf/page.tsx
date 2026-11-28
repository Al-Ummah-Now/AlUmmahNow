import { notFound } from 'next/navigation';
import { ComposerHarness } from './ComposerHarness';

export default async function QafHarnessPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ postLocale?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { locale } = await params;
  const { postLocale = locale } = await searchParams;
  return <ComposerHarness locale={locale} postLocale={postLocale === 'ar' ? 'ar' : 'en'} />;
}
