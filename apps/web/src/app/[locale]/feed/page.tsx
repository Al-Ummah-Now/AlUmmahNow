import { permanentRedirect } from 'next/navigation';

/** The feed lives at /subscriptions now; old links keep working. */
export default async function FeedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/subscriptions`);
}
