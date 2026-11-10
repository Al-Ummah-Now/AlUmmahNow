'use client';

import React, { useEffect, useState } from 'react';
import { Clock, Check } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { LibraryService } from '@/services/api/library';

interface WatchLaterButtonProps {
  videoId: string;
  className?: string;
}

/** Watch page toggle (Story 29.6): save to / remove from Watch later. */
export function WatchLaterButton({ videoId, className = '' }: WatchLaterButtonProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const texts = t.library;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user || !videoId) return;
    let cancelled = false;
    void LibraryService.isInWatchLater(videoId).then((value) => {
      if (!cancelled && value !== null) setSaved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user, videoId]);

  if (!user) return null;

  const toggle = async () => {
    setBusy(true);
    const result = saved ? await LibraryService.removeFromWatchLater(videoId) : await LibraryService.addToWatchLater(videoId);
    setBusy(false);
    if (result.ok) {
      setSaved(result.saved);
      setMessage(result.saved ? texts.savedToWatchLater : texts.removedFromWatchLater);
    } else {
      setMessage(result.error === 'full' ? texts.watchLaterFull : texts.actionFailed);
    }
  };

  const Icon = saved ? Check : Clock;
  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        data-testid="watch-later-button"
        title={saved ? texts.removeFromWatchLater : texts.saveToWatchLater}
        data-saved={saved ? 'true' : 'false'}
        className={`inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="wa-label">{saved ? texts.removeFromWatchLater : texts.saveToWatchLater}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}

export default WatchLaterButton;
