import { getChannelById } from '@/lib/api/channels';
import { logger } from '@/lib/logger-server';
import NewPostForm from './NewPostForm';

interface NewPostPageProps {
  params: Promise<{ locale: string; id: string }>;
}

/**
 * New community post. The channel is read on the server so the breadcrumb
 * (<channel> › Settings › Community › New post) is complete in the first
 * render, not after a client fetch.
 */
export default async function NewPostPage({ params }: NewPostPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id).catch((error: unknown) => {
    logger.error('Failed to load channel', { error, channelId: id });
    return null;
  });
  return (
    <NewPostForm
      locale={locale}
      id={id}
      channelName={channel?.nameLocalized?.[locale] || channel?.name || ''}
      channelHandle={channel?.handle ?? null}
    />
  );
}
