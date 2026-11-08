'use client';

/**
 * Read-only comment thread frame (Epic 26 v1, docs/embeds/README.md §7).
 * Shows the video's shared public thread, newest first, with "load more" and
 * a link to join the discussion on the watch page. Reports its height to the
 * parent (aun:v1:resize) so the widget can size the iframe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Pin, ThumbsUp } from 'lucide-react';
import { logger } from '@/lib/logger-client';
import { readAncestorOrigins, resolvePartnerOrigin, RESIZE_TYPE } from '@/lib/embed/messaging';
import type { EmbedLang } from '@/lib/embed/params';
import { embedStrings, fill } from '@/lib/embed/strings';
import type { EmbedComment } from '@/lib/embed/content';

interface CommentsFrameProps {
  videoId: string;
  videoTitle: string;
  lang: EmbedLang;
  origin: string | null;
  initial: { comments: EmbedComment[]; nextCursor: string | null; total: number };
}

interface RuntimeConfigWindow extends Window {
  __RUNTIME_CONFIG__?: { API_URL?: string };
}

function formatDate(iso: string, lang: EmbedLang): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium' }).format(date);
}

export default function CommentsFrame({ videoId, videoTitle, lang, origin, initial }: CommentsFrameProps) {
  const s = embedStrings(lang);
  const [comments, setComments] = useState(initial.comments);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Report our height to the embedding page (only to the resolved partner origin)
  useEffect(() => {
    if (window.parent === window) return undefined;
    const target = resolvePartnerOrigin({ originParam: origin, ancestorOrigins: readAncestorOrigins(), referrer: document.referrer });
    const root = rootRef.current;
    if (!target || !root) return undefined;
    const post = () => window.parent.postMessage({ type: RESIZE_TYPE, height: Math.ceil(root.getBoundingClientRect().height) }, target);
    post();
    const observer = new ResizeObserver(post);
    observer.observe(root);
    return () => observer.disconnect();
  }, [origin]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const api = ((window as RuntimeConfigWindow).__RUNTIME_CONFIG__?.API_URL || '').replace(/\/+$/, '');
      const query = new URLSearchParams({ limit: '20', sort: 'newest', cursor });
      const response = await fetch(`${api}/api/videos/${encodeURIComponent(videoId)}/comments?${query}`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { result?: { comments?: Array<Record<string, unknown>>; nextCursor?: string | null } };
      const more = (body.result?.comments || [])
        .filter((c) => !c.isDeleted && !c.isHeld && c.text)
        .map((c) => ({
          id: String(c.id),
          text: String(c.text),
          dateCreated: String(c.dateCreated || ''),
          likesCount: Number(c.likesCount) || 0,
          repliesCount: Number(c.repliesCount) || 0,
          isPinned: !!c.isPinned,
          authorName: String((c.author as { displayName?: string } | undefined)?.displayName || ''),
          authorAvatar: (c.author as { avatarUrl?: string } | undefined)?.avatarUrl,
        }));
      setComments((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.id === m.id))]);
      setCursor(body.result?.nextCursor ?? null);
    } catch (error) {
      logger.warn('[embed comments] load more failed', { videoId, error });
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, videoId]);

  const watchHref = `/${lang}/video/${encodeURIComponent(videoId)}#comments`;

  return (
    <main
      ref={rootRef}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      data-testid="embed-comments"
      className="bg-white p-4 text-gray-900 dark:bg-gray-900 dark:text-gray-100"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
          <span>{s.comments}</span>
          <span className="text-sm font-normal text-gray-500">({initial.total})</span>
        </h1>
        <a
          href={watchHref}
          target="_blank"
          rel="noopener"
          className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
          title={videoTitle}
        >
          {s.joinDiscussion}
        </a>
      </header>
      {comments.length === 0 ? (
        <p className="text-sm text-gray-500">{s.noComments}</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3" data-testid="embed-comment">
              {comment.authorAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={comment.authorAvatar} alt="" className="h-9 w-9 shrink-0 rounded-full bg-gray-300 object-cover" loading="lazy" />
              ) : (
                <span className="h-9 w-9 shrink-0 rounded-full bg-gray-300" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{comment.authorName}</span>
                  <time dateTime={comment.dateCreated}>{formatDate(comment.dateCreated, lang)}</time>
                  {comment.isPinned && (
                    <span className="inline-flex items-center gap-1"><Pin className="h-3 w-3" aria-hidden="true" />{s.pinned}</span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm">{comment.text}</p>
                <p className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  {comment.likesCount > 0 && (
                    <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" aria-hidden="true" />{comment.likesCount}</span>
                  )}
                  {comment.repliesCount > 0 && <span>{fill(s.replies, { count: comment.repliesCount })}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-4 w-full rounded border border-gray-300 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {s.loadMore}
        </button>
      )}
    </main>
  );
}
