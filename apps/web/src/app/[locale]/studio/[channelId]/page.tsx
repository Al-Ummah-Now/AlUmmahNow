import { redirect } from 'next/navigation';

export default async function StudioChannelPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  redirect(`/${locale}/studio/${encodeURIComponent(channelId)}/dashboard`);
}
