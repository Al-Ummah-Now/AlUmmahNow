'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { LibraryService } from '@/services/api/library';

interface SavePostButtonProps {
  postId: string;
  postChannelId: string;
  /** Signed-in viewer; the button is hidden for anonymous viewers. */
  userId?: string;
}

/** Save / unsave a community post to the Library (Story 29.6). */
export function SavePostButton({ postId, postChannelId, userId }: SavePostButtonProps) {
  const { t } = useLanguage();
  const texts = t.library;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void LibraryService.isPostSaved(postId).then((value) => {
      if (!cancelled && value !== null) setSaved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [postId, userId]);

  if (!userId) return null;

  const toggle = async () => {
    setBusy(true);
    const ok = saved ? await LibraryService.unsavePost(postId) : await LibraryService.savePost(postId, postChannelId);
    setBusy(false);
    if (ok) {
      setSaved(!saved);
      setMessage(saved ? '' : texts.postSaved);
    } else {
      setMessage(texts.actionFailed);
    }
  };

  const Icon = saved ? BookmarkCheck : Bookmark;
  const label = saved ? texts.unsavePost : texts.savePost;
  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        aria-label={label}
        title={label}
        data-testid="save-post-button"
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Icon className={`h-5 w-5 ${saved ? 'text-[#ffa037]' : ''}`} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}

export default SavePostButton;
