import { notFound } from 'next/navigation';
import { ComposerHarness } from './ComposerHarness';

export default async function QafHarnessPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { locale } = await params;
  return <ComposerHarness locale={locale} />;
}
