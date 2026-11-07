'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Clock, EllipsisVertical } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { MenuButton } from '@/components/common/MenuButton';
import { LibraryService } from '@/services/api/library';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';

interface VideoCardMenuProps {
  videoId: string;
  title: string;
  className?: string;
}

/**
 * Overflow menu on video cards (Story 29.6) with "Save to Watch later".
 * Keyboard accessible (menu button pattern); signed-in users only.
 */
export function VideoCardMenu({ videoId, title, className = '' }: VideoCardMenuProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const texts = t.library;
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!user) return null;

  const flash = (message: string) => {
    setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 2500);
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
          {
            id: 'watch-later',
            label: texts.saveToWatchLater,
            icon: <Clock className="h-4 w-4" />,
            testId: 'video-card-save-watch-later',
            onSelect: save,
          },
        ]}
      >
        <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
    </div>
  );
}

export default VideoCardMenu;
