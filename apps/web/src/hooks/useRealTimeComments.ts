/**
 * Video comments with live updates (Story 29.2).
 *
 * - Top-level comments sorted by `top` or `newest` (API ?sort=), paginated
 * - Replies (one level) loaded per thread on demand
 * - Live updates from the `video:<id>` realtime channel: comment_added
 *   (top-level or reply, with author), comment_updated, comment_deleted
 * - Per-video comment settings (on / held / off) reported by the list API
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Comments } from '@/interfaces';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';
import {
  updateVideoComment,
  deleteVideoComment,
  likeVideoComment,
  unlikeVideoComment,
  dislikeVideoComment,
  removeVideoCommentDislike,
  CommentReactionResponse,
} from '@/lib/api/videos';
import {
  approveComment as approveCommentApi,
  createComment,
  listComments,
  listReplies,
  type CommentSettings,
  type CommentSort,
} from '@/lib/api/video-comments';

const COMMENTS_PAGE_SIZE = 20;
const REPLIES_PAGE_SIZE = 20;

export type CommentReaction = 'like' | 'dislike';
export type { CommentSort, CommentSettings };

export interface ReplyThread {
  open: boolean;
  items: Comments[];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
}

export type AddCommentResult = { ok: true; held: boolean } | { ok: false; error: 'comments_disabled' | 'not_found' | 'failed' };

export interface UseRealTimeCommentsOptions {
  videoId: string;
  channelId: string;
  onCommentAdded?: (comment: Comments) => void;
  onCommentUpdated?: (comment: Partial<Comments> & { id: string }) => void;
  onCommentDeleted?: (commentId: string) => void;
  /** Load the first page on mount (default true) */
  loadFromApi?: boolean;
}

export interface UseRealTimeCommentsReturn {
  comments: Comments[];
  replies: Record<string, ReplyThread>;
  sort: CommentSort;
  setSort: (sort: CommentSort) => void;
  commentSettings: CommentSettings;
  addComment: (text: string) => Promise<AddCommentResult>;
  addReply: (parentId: string, text: string) => Promise<AddCommentResult>;
  updateComment: (commentId: string, text: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  approveComment: (commentId: string) => Promise<boolean>;
  toggleReaction: (commentId: string, reaction: CommentReaction) => Promise<boolean>;
  toggleReplies: (parentId: string) => Promise<void>;
  loadMoreReplies: (parentId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadError: boolean;
  isConnected: boolean;
  commentsCount: number;
}

/** Realtime payload (api-videos websocket-notify `data`) */
interface CommentRealtimeEvent {
  type: 'comment_added' | 'comment_updated' | 'comment_deleted';
  videoId: string;
  commentId: string;
  parentCommentId?: string | null;
  comment?: Partial<Comments> & { id: string };
}

const EMPTY_THREAD: ReplyThread = { open: false, items: [], nextCursor: null, loading: false, loaded: false };

function isCommentEvent(data: unknown): data is CommentRealtimeEvent {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return type === 'comment_added' || type === 'comment_updated' || type === 'comment_deleted';
}

export function useRealTimeComments(options: UseRealTimeCommentsOptions): UseRealTimeCommentsReturn {
  const { videoId, channelId, onCommentAdded, onCommentUpdated, onCommentDeleted, loadFromApi = true } = options;
  const [comments, setComments] = useState<Comments[]>([]);
  const [replies, setReplies] = useState<Record<string, ReplyThread>>({});
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sort, setSortState] = useState<CommentSort>('newest');
  const [commentSettings, setCommentSettings] = useState<CommentSettings>('on');
  const [isLoading, setIsLoading] = useState<boolean>(loadFromApi);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Latest state for callbacks that must not be re-created on every change
  const commentsRef = useRef(comments);
  const repliesRef = useRef(replies);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  useEffect(() => { repliesRef.current = replies; }, [replies]);

  const callbacks = useRef({ onCommentAdded, onCommentUpdated, onCommentDeleted });
  useEffect(() => {
    callbacks.current = { onCommentAdded, onCommentUpdated, onCommentDeleted };
  }, [onCommentAdded, onCommentUpdated, onCommentDeleted]);

  const patchEverywhere = useCallback((commentId: string, patch: (c: Comments) => Comments) => {
    setComments((prev) => prev.map((c) => (c.id === commentId ? patch(c) : c)));
    setReplies((prev) => {
      let changed = false;
      const next: Record<string, ReplyThread> = {};
      for (const [parentId, thread] of Object.entries(prev)) {
        if (thread.items.some((r) => r.id === commentId)) {
          changed = true;
          next[parentId] = { ...thread, items: thread.items.map((r) => (r.id === commentId ? patch(r) : r)) };
        } else {
          next[parentId] = thread;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** Insert a reply into its thread (if loaded) and bump the parent's count once. */
  const insertReply = useCallback((parentId: string, reply: Comments) => {
    const thread = repliesRef.current[parentId];
    if (thread?.items.some((r) => r.id === reply.id)) return false;
    setReplies((prev) => {
      const current = prev[parentId] || EMPTY_THREAD;
      if (current.items.some((r) => r.id === reply.id)) return prev;
      return { ...prev, [parentId]: { ...current, items: current.loaded || current.items.length > 0 ? [...current.items, reply] : [reply], loaded: current.loaded } };
    });
    setComments((prev) => prev.map((c) => (c.id === parentId ? { ...c, repliesCount: (c.repliesCount || 0) + 1 } : c)));
    return true;
  }, []);

  const removeEverywhere = useCallback((commentId: string, parentId?: string | null) => {
    const wasTopLevel = commentsRef.current.some((c) => c.id === commentId);
    const owningParent = parentId
      || Object.entries(repliesRef.current).find(([, thread]) => thread.items.some((r) => r.id === commentId))?.[0]
      || null;
    if (wasTopLevel) {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setTotal((n) => Math.max(0, n - 1));
      setReplies((prev) => {
        if (!prev[commentId]) return prev;
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    } else if (owningParent) {
      setReplies((prev) => {
        const thread = prev[owningParent];
        if (!thread) return prev;
        return { ...prev, [owningParent]: { ...thread, items: thread.items.filter((r) => r.id !== commentId) } };
      });
      setComments((prev) => prev.map((c) => (c.id === owningParent ? { ...c, repliesCount: Math.max(0, (c.repliesCount || 0) - 1) } : c)));
    }
  }, []);

  // Live updates for other viewers
  const handleRealtime = useCallback((data: unknown) => {
    if (!isCommentEvent(data) || data.videoId !== videoId) return;
    logger.debug('[useRealTimeComments] Realtime event', { type: data.type, commentId: data.commentId, parentCommentId: data.parentCommentId });

    if (data.type === 'comment_added' && data.comment) {
      const comment = data.comment as Comments;
      if (data.parentCommentId) {
        insertReply(data.parentCommentId, comment);
      } else if (!commentsRef.current.some((c) => c.id === comment.id)) {
        // Pinned comments stay on top
        setComments((prev) => {
          if (prev.some((c) => c.id === comment.id)) return prev;
          const pinned = prev.filter((c) => c.isPinned);
          const rest = prev.filter((c) => !c.isPinned);
          return [...pinned, comment, ...rest];
        });
        setTotal((n) => n + 1);
      }
      callbacks.current.onCommentAdded?.(comment);
    } else if (data.type === 'comment_updated' && data.comment) {
      const update = data.comment;
      patchEverywhere(data.commentId, (c) => ({ ...c, ...update, author: c.author }));
      callbacks.current.onCommentUpdated?.(update);
    } else if (data.type === 'comment_deleted') {
      removeEverywhere(data.commentId, data.parentCommentId);
      callbacks.current.onCommentDeleted?.(data.commentId);
    }
  }, [videoId, insertReply, patchEverywhere, removeEverywhere]);

  const isConnected = useWebSocketSubscription(`video:${videoId}`, handleRealtime, [videoId]);

  // First page (and again when the sort changes)
  useEffect(() => {
    if (!loadFromApi || !videoId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const page = await listComments(videoId, { limit: COMMENTS_PAGE_SIZE, sort });
        if (cancelled) return;
        if (!page) {
          logger.warn('[useRealTimeComments] Failed to load comments', { videoId, sort });
          setLoadError(true);
          return;
        }
        setComments(page.comments);
        setReplies({});
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setCommentSettings(page.commentSettings);
      } catch (error) {
        logger.error('[useRealTimeComments] Error loading comments', { videoId, error });
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, loadFromApi, sort]);

  const setSort = useCallback((next: CommentSort) => {
    setSortState((prev) => (prev === next ? prev : next));
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await listComments(videoId, { limit: COMMENTS_PAGE_SIZE, cursor: nextCursor, sort });
      if (!page) {
        setLoadError(true);
        return;
      }
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.comments.filter((c) => !seen.has(c.id))];
      });
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (error) {
      logger.error('[useRealTimeComments] Error loading more comments', { videoId, error });
      setLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [videoId, nextCursor, sort]);

  const fetchReplies = useCallback(async (parentId: string, cursor: string | null) => {
    setReplies((prev) => ({ ...prev, [parentId]: { ...(prev[parentId] || EMPTY_THREAD), open: true, loading: true } }));
    try {
      const page = await listReplies(videoId, parentId, { limit: REPLIES_PAGE_SIZE, cursor });
      setReplies((prev) => {
        const current = prev[parentId] || EMPTY_THREAD;
        if (!page) return { ...prev, [parentId]: { ...current, loading: false } };
        // First page replaces the thread but keeps replies that arrived live meanwhile
        const merged = cursor ? [...current.items, ...page.replies] : [...page.replies, ...current.items];
        const seen = new Set<string>();
        const items = merged.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
        return {
          ...prev,
          [parentId]: { open: true, loading: false, loaded: true, nextCursor: page.nextCursor, items },
        };
      });
      if (page && !cursor) {
        setComments((prev) => prev.map((c) => (c.id === parentId ? { ...c, repliesCount: Math.max(page.total, c.repliesCount || 0) } : c)));
      }
    } catch (error) {
      logger.error('[useRealTimeComments] Error loading replies', { videoId, parentId, error });
      setReplies((prev) => ({ ...prev, [parentId]: { ...(prev[parentId] || EMPTY_THREAD), loading: false } }));
    }
  }, [videoId]);

  const toggleReplies = useCallback(async (parentId: string) => {
    const thread = repliesRef.current[parentId];
    if (thread?.open) {
      setReplies((prev) => ({ ...prev, [parentId]: { ...thread, open: false } }));
      return;
    }
    if (thread?.loaded) {
      setReplies((prev) => ({ ...prev, [parentId]: { ...thread, open: true } }));
      return;
    }
    await fetchReplies(parentId, null);
  }, [fetchReplies]);

  const loadMoreReplies = useCallback(async (parentId: string) => {
    const cursor = repliesRef.current[parentId]?.nextCursor;
    if (cursor) await fetchReplies(parentId, cursor);
  }, [fetchReplies]);

  const addComment = useCallback(async (text: string): Promise<AddCommentResult> => {
    const result = await createComment(videoId, text, channelId);
    if (result.ok === false) {
      if (result.error === 'comments_disabled') setCommentSettings('off');
      return result;
    }
    const saved = result.comment;
    setComments((prev) => {
      if (prev.some((c) => c.id === saved.id)) return prev;
      const pinned = prev.filter((c) => c.isPinned);
      const rest = prev.filter((c) => !c.isPinned);
      return [...pinned, saved, ...rest];
    });
    if (!commentsRef.current.some((c) => c.id === saved.id)) setTotal((n) => n + 1);
    logger.info('[useRealTimeComments] Comment added', { videoId, commentId: saved.id, held: !!saved.isHeld });
    return { ok: true, held: !!saved.isHeld };
  }, [videoId, channelId]);

  const addReply = useCallback(async (parentId: string, text: string): Promise<AddCommentResult> => {
    const result = await createComment(videoId, text, channelId, parentId);
    if (result.ok === false) {
      if (result.error === 'comments_disabled') setCommentSettings('off');
      return result;
    }
    // Make sure the thread is open and shows the new reply
    const thread = repliesRef.current[parentId];
    if (!thread?.loaded) {
      // The stored reply is normally part of the first page (and its count);
      // keep it visible even if that read raced the write
      await fetchReplies(parentId, null);
      const saved = result.comment;
      setReplies((prev) => {
        const current = prev[parentId] || EMPTY_THREAD;
        if (current.items.some((r) => r.id === saved.id)) return prev;
        return { ...prev, [parentId]: { ...current, open: true, loaded: true, items: [...current.items, saved] } };
      });
    } else {
      insertReply(parentId, result.comment);
      setReplies((prev) => ({ ...prev, [parentId]: { ...(prev[parentId] || EMPTY_THREAD), open: true } }));
    }
    return { ok: true, held: !!result.comment.isHeld };
  }, [videoId, channelId, fetchReplies, insertReply]);

  const findComment = useCallback((commentId: string): Comments | undefined => {
    const top = commentsRef.current.find((c) => c.id === commentId);
    if (top) return top;
    for (const thread of Object.values(repliesRef.current)) {
      const reply = thread.items.find((r) => r.id === commentId);
      if (reply) return reply;
    }
    return undefined;
  }, []);

  // Like/dislike toggle; the API keeps a channel's reaction exclusive
  const toggleReaction = useCallback(async (commentId: string, reaction: CommentReaction): Promise<boolean> => {
    const current = findComment(commentId);
    if (!current) return false;
    const active = reaction === 'like' ? current.isLiked : current.isDisliked;

    let response: CommentReactionResponse | null = null;
    try {
      if (reaction === 'like') {
        response = active
          ? await unlikeVideoComment(videoId, commentId, { channelId })
          : await likeVideoComment(videoId, commentId, { channelId });
      } else {
        response = active
          ? await removeVideoCommentDislike(videoId, commentId, { channelId })
          : await dislikeVideoComment(videoId, commentId, { channelId });
      }
    } catch (error) {
      logger.error('[useRealTimeComments] Reaction failed', { videoId, commentId, reaction, error });
      return false;
    }

    if (!response?.success || !response.result) {
      logger.warn('[useRealTimeComments] Reaction rejected', { videoId, commentId, reaction, error: response?.error });
      return false;
    }

    const r = response.result;
    patchEverywhere(commentId, (c) => ({ ...c, likesCount: r.likesCount, dislikesCount: r.dislikesCount, isLiked: r.isLiked, isDisliked: r.isDisliked }));
    return true;
  }, [videoId, channelId, findComment, patchEverywhere]);

  const updateComment = useCallback(async (commentId: string, text: string): Promise<boolean> => {
    const original = findComment(commentId);
    if (!original) return false;
    patchEverywhere(commentId, (c) => ({ ...c, text, isEdited: c.text !== text ? true : c.isEdited, dateModified: new Date().toISOString() }));
    try {
      const result = await updateVideoComment(videoId, commentId, { content: text }, { channelId });
      if (result?.success) return true;
      logger.warn('[useRealTimeComments] Edit rejected', { videoId, commentId, error: result?.error });
    } catch (error) {
      logger.error('[useRealTimeComments] Edit failed', { videoId, commentId, error });
    }
    patchEverywhere(commentId, () => original);
    return false;
  }, [videoId, channelId, findComment, patchEverywhere]);

  const deleteComment = useCallback(async (commentId: string): Promise<boolean> => {
    try {
      const result = await deleteVideoComment(videoId, commentId, { channelId });
      if (result?.success) {
        removeEverywhere(commentId);
        return true;
      }
      logger.warn('[useRealTimeComments] Delete rejected', { videoId, commentId });
    } catch (error) {
      logger.error('[useRealTimeComments] Delete failed', { videoId, commentId, error });
    }
    return false;
  }, [videoId, channelId, removeEverywhere]);

  const approveComment = useCallback(async (commentId: string): Promise<boolean> => {
    const ok = await approveCommentApi(videoId, commentId);
    if (ok) patchEverywhere(commentId, (c) => ({ ...c, isHeld: false }));
    return ok;
  }, [videoId, patchEverywhere]);

  return {
    comments,
    replies,
    sort,
    setSort,
    commentSettings,
    addComment,
    addReply,
    updateComment,
    deleteComment,
    approveComment,
    toggleReaction,
    toggleReplies,
    loadMoreReplies,
    loadMore,
    hasMore: !!nextCursor,
    isLoading,
    isLoadingMore,
    loadError,
    isConnected,
    commentsCount: Math.max(total, comments.length),
  };
}
