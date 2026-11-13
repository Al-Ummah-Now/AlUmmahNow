'use client';

import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Clock, EllipsisVertical, Link2, ListPlus } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { MenuButton } from '@/components/common/MenuButton';
import { LibraryService } from '@/services/api/library';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';
import { copyText } from '@/lib/share/copy';
import { shareLink } from '@/lib/share/short-link';

// Loaded only when "Save to playlist" is chosen: the dialog's playlist calls are
// server actions (next/headers), which must not load with every video card
const SaveToPlaylist = lazy(() => import('@/components/SaveToPlaylist'));

interface VideoCardMenuProps {
  videoId: string;
  title: string;
  className?: string;
}

/**
 * Overflow menu on video cards (Story 29.6): "Save to Watch later" and "Save
 * to playlist" (the active channel's playlists, or the user's own without a
 * channel), for signed-in users; "Copy link" (the short link, wiki AUN-SHORT-LINKS) for
 * everyone. Keyboard accessible (menu button pattern).
 */
export function VideoCardMenu({ videoId, title, className = '' }: VideoCardMenuProps) {
  const { user } = useAuth();
  const { t, locale } = useLanguage();
  const texts = t.library;
  const [status, setStatus] = useState<string | null>(null);
  const [savingToPlaylist, setSavingToPlaylist] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flash = (message: string) => {
    setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 2500);
  };

  const copyLink = async () => {
    const link = shareLink({ kind: 'video', id: videoId }, `${window.location.origin}/${locale}/video/${encodeURIComponent(videoId)}`, { locale });
    flash((await copyText(link)) ? texts.linkCopied : texts.copyFailed);
  };

  const save = async () => {
    const result = await LibraryService.addToWatchLater(videoId);
    if (result.ok) flash(texts.savedToWatchLater);
    else flash(result.error === 'full' ? texts.watchLaterFull : texts.actionFailed);
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {status && (
        <span className="rounded bg-gray-900/90 px-2 py-0.5 text-xs text-white" data-testid="video-card-menu-status">
          {status}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">{status || ''}</span>
      <MenuButton
        label={fillTemplate(texts.moreActions, { title })}
        testId="video-card-menu"
        buttonClassName="rounded-full p-1.5 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        items={[
          ...(user
            ? [
                {
                  id: 'watch-later',
                  label: texts.saveToWatchLater,
                  icon: <Clock className="h-4 w-4" />,
                  testId: 'video-card-save-watch-later',
                  onSelect: save,
                },
                {
                  id: 'save-to-playlist',
                  label: t.playlist.saveToPlaylistTitle,
                  icon: <ListPlus className="h-4 w-4" />,
                  testId: 'video-card-save-to-playlist',
                  onSelect: () => setSavingToPlaylist(true),
                },
              ]
            : []),
          {
            id: 'copy-link',
            label: texts.copyLink,
            icon: <Link2 className="h-4 w-4" />,
            testId: 'video-card-copy-link',
            onSelect: copyLink,
          },
        ]}
      >
        <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
      {savingToPlaylist && (
        <Suspense fallback={null}>
          <SaveToPlaylist videoId={videoId} open onOpenChange={setSavingToPlaylist} className="absolute bottom-full end-0 mb-1" />
        </Suspense>
      )}
    </div>
  );
}

export default VideoCardMenu;
