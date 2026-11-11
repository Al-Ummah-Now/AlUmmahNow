'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { applySavedVideo } from '@/lib/studio/content-client';
import { listReturn, type ListReturn } from '@/lib/studio/list-return';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import SaveToPlaylist from '@/components/SaveToPlaylist';
import VideoEdit from '@/components/videoEdit/index';
import { useLanguage } from '@/hooks/useLanguage';
import type { VideoObject } from '@/interfaces';

interface Props {
  locale: string;
  channelId: string;
  userId: string;
  video: VideoObject;
  canViewAnalytics: boolean;
}

/** The video editor inside Studio (spec §4.5). */
export function StudioVideoEditor({ locale, channelId, userId, video, canViewAnalytics }: Props) {
  const { t } = useLanguage();
  const text = t.studio.editor;
  const router = useRouter();
  const queryClient = useQueryClient();
  const listBase = `/${locale}/studio/${encodeURIComponent(channelId)}/content/videos`;
  // Back returns to the list as it was (status, filters, sort, scroll), from cache
  const [back, setBack] = useState<ListReturn | null>(null);
  useEffect(() => {
    setBack(listReturn(channelId, window.location.pathname));
  }, [channelId]);
  const list = back?.url ?? listBase;
  useEffect(() => {
    router.prefetch(list);
  }, [router, list]);
  const backToList = () => {
    if (back?.cameFromList) router.back();
    else router.push(list);
  };
  const onBackClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!back?.cameFromList || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.back();
  };
  const onSaved = (updated: VideoObject) => {
    applySavedVideo(queryClient, channelId, updated as never);
    backToList();
  };

  return (
    <div data-testid="studio-video-editor">
      <Link href={list} onClick={onBackClick} data-testid="studio-editor-back" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />
        {text.back}
      </Link>
      <h1 dir="auto" className="mb-3 truncate text-xl font-bold text-foreground">{video.title}</h1>

      <nav aria-label={t.studio.tabsLabel} className="mb-4 flex gap-1 border-b border-border">
        <span aria-current="page" className="flex min-h-11 items-center border-b-2 border-primary px-3 text-sm font-medium text-foreground">{text.details}</span>
        {canViewAnalytics && (
          <Link href={`${listBase}/${encodeURIComponent(video.id)}/analytics`} className="flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground">
            {text.analytics}
          </Link>
        )}
      </nav>

      <div className="mb-4">
        <SaveToPlaylist videoId={video.id} channelId={channelId} />
      </div>
      <VideoEdit video={video} userId={userId} channelId={channelId} onSave={onSaved} onCancel={backToList} />
    </div>
  );
}
