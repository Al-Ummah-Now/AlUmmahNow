import { useState, useEffect, useCallback, useRef } from 'react';
import { Comments } from '@/interfaces';
import { CommentEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';
import {
  createVideoComment,
  updateVideoComment,
  deleteVideoComment,
  listVideoComments,
  likeVideoComment,
  unlikeVideoComment,
  dislikeVideoComment,
  removeVideoCommentDislike,
  CommentReactionResponse,
} from '@/lib/api/videos';

const COMMENTS_PAGE_SIZE = 20;
// Stable default so the initialComments sync effect does not reset state on every render
const EMPTY_COMMENTS: Comments[] = [];


export interface UseRealTimeCommentsOptions {
  videoId: string;
  channelId: string;
  initialComments?: Comments[];
  onCommentAdded?: (comment: Comments) => void;
  onCommentUpdated?: (comment: Comments) => void;
  onCommentDeleted?: (commentId: string) => void;
  /** Load the first page from GET /api/videos/:id/comments on mount (default true) */
  loadFromApi?: boolean;
}

export type CommentReaction = 'like' | 'dislike';

export interface UseRealTimeCommentsReturn {
  comments: Comments[];
  addComment: (comment: Omit<Comments, 'id' | 'dateCreated' | 'dateModified' | 'likesCount' | 'dislikesCount' | 'repliesCount' | 'isEdited' | 'isDeleted' | 'isPinned'>) => Promise<boolean>;
  updateComment: (commentId: string, updates: Partial<Comments>) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  toggleReaction: (commentId: string, reaction: CommentReaction) => Promise<boolean>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadError: boolean;
  isConnected: boolean;
  commentsCount: number;
}

export function useRealTimeComments(options: UseRealTimeCommentsOptions): UseRealTimeCommentsReturn {
  const { videoId, channelId, initialComments = EMPTY_COMMENTS, onCommentAdded, onCommentUpdated, onCommentDeleted, loadFromApi = true } = options;
  const [comments, setComments] = useState<Comments[]>(initialComments);
  const [total, setTotal] = useState<number>(initialComments.length);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(loadFromApi);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Store callbacks in refs to prevent re-subscription on every render
  const onCommentAddedRef = useRef(onCommentAdded);
  const onCommentUpdatedRef = useRef(onCommentUpdated);
  const onCommentDeletedRef = useRef(onCommentDeleted);

  useEffect(() => {
    onCommentAddedRef.current = onCommentAdded;
    onCommentUpdatedRef.current = onCommentUpdated;
    onCommentDeletedRef.current = onCommentDeleted;
  }, [onCommentAdded, onCommentUpdated, onCommentDeleted]);

  // Handle real-time comment updates
  const handleCommentUpdate = useCallback((eventData: unknown) => {
    // Type guard to ensure eventData is CommentEvent
    if (!eventData || typeof eventData !== 'object' || !('type' in eventData)) {
      return;
    }

    const event = eventData as CommentEvent;
    logger.info('Real-time comment update:', event);

    switch (event.type) {
      case 'comment_added':
        if (event.comment) {
          setComments(prevComments => {
            // Avoid duplicates
            if (prevComments.some(c => c.id === event.comment!.id)) {
              return prevComments;
            }
            const newComments = [event.comment!, ...prevComments];
            onCommentAddedRef.current?.(event.comment!);
            return newComments;
          });
        }
        break;

      case 'comment_updated':
        if (event.comment) {
          setComments(prevComments =>
            prevComments.map(comment =>
              comment.id === event.comment!.id
                ? { ...comment, ...event.comment! }
                : comment
            )
          );
          onCommentUpdatedRef.current?.(event.comment!);
        }
        break;

      case 'comment_deleted':
        setComments(prevComments =>
          prevComments.filter(comment => comment.id !== event.commentId)
        );
        onCommentDeletedRef.current?.(event.commentId);
        break;
    }
  }, []);

  // Subscribe to real-time updates for this video
  const isConnected = useWebSocketSubscription(
    `video:${videoId}`,
    handleCommentUpdate,
    [videoId]
  );

  // Update comments when initial comments change
  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  // Load the first page of comments from the API
  useEffect(() => {
    if (!loadFromApi || !videoId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const response = await listVideoComments(videoId, { limit: COMMENTS_PAGE_SIZE });
        if (cancelled) return;
        if (!response?.success || !response.result) {
          logger.warn('[useRealTimeComments] Failed to load comments', { videoId });
          setLoadError(true);
          return;
        }
        setComments(response.result.comments);
        setTotal(response.result.total);
        setNextCursor(response.result.nextCursor);
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
  }, [videoId, loadFromApi]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const response = await listVideoComments(videoId, { limit: COMMENTS_PAGE_SIZE, cursor: nextCursor });
      if (!response?.success || !response.result) {
        setLoadError(true);
        return;
      }
      const page = response.result;
      setComments(prev => {
        const seen = new Set(prev.map(c => c.id));
        return [...prev, ...page.comments.filter(c => !seen.has(c.id))];
      });
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (error) {
      logger.error('[useRealTimeComments] Error loading more comments', { videoId, error });
      setLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [videoId, nextCursor]);

  // Optimistic comment addition
  const addComment = useCallback(async (commentData: Omit<Comments, 'id' | 'dateCreated' | 'dateModified' | 'likesCount' | 'dislikesCount' | 'repliesCount' | 'isEdited' | 'isDeleted' | 'isPinned'>) => {
    const tempId = `temp_${Date.now()}`;
    const optimisticComment: Comments = {
      id: tempId,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      likesCount: 0,
      dislikesCount: 0,
      repliesCount: 0,
      isEdited: false,
      isDeleted: false,
      isPinned: false,
      ...commentData
    };

    // Add optimistically to local state
    setComments(prevComments => [optimisticComment, ...prevComments]);
    setTotal(n => n + 1);
    logger.info('Adding comment:', optimisticComment);

    try {
      const result = await createVideoComment(
        videoId,
        { content: commentData.text },
        { channelId }
      );

      if (!result || !result.success || !result.result?.comment) {
        // Rollback on failure
        logger.error('Failed to create comment:', result?.error || 'Unknown error');
        setComments(prevComments => prevComments.filter(c => c.id !== tempId));
        setTotal(n => Math.max(0, n - 1));
        return false;
      }

      // Replace the optimistic entry with the stored comment (real id + author)
      const saved = result.result.comment;
      setComments(prevComments => {
        const withoutTemp = prevComments.filter(c => c.id !== tempId);
        return withoutTemp.some(c => c.id === saved.id) ? withoutTemp : [saved, ...withoutTemp];
      });
      return true;
    } catch (error) {
      // Rollback on error
      logger.error('Error creating comment:', error);
      setComments(prevComments => prevComments.filter(c => c.id !== tempId));
      setTotal(n => Math.max(0, n - 1));
      return false;
    }
  }, [videoId, channelId]);

  // Like/dislike toggle; the API keeps a channel's reaction exclusive
  const toggleReaction = useCallback(async (commentId: string, reaction: CommentReaction): Promise<boolean> => {
    const current = comments.find(c => c.id === commentId);
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
    setComments(prev => prev.map(c => c.id === commentId
      ? { ...c, likesCount: r.likesCount, dislikesCount: r.dislikesCount, isLiked: r.isLiked, isDisliked: r.isDisliked }
      : c));
    return true;
  }, [comments, videoId, channelId]);

  // Optimistic comment update
  const updateComment = useCallback(async (commentId: string, updates: Partial<Comments>) => {
    // Store original comment for rollback
    let originalComment: Comments | undefined;

    setComments(prevComments => {
      originalComment = prevComments.find(c => c.id === commentId);
      return prevComments.map(comment =>
        comment.id === commentId
          ? { ...comment, ...updates, dateModified: new Date().toISOString() }
          : comment
      );
    });

    logger.info('Updating comment:', { commentId, updates });

    try {
      // Send update to API - map 'text' field to 'content' for API
      const result = await updateVideoComment(
        videoId,
        commentId,
        { content: updates.text || '' },
        { channelId }
      );

      if (!result || !result.success) {
        // Rollback on failure
        logger.error('Failed to update comment:', result?.error || 'Unknown error');
        if (originalComment) {
          setComments(prevComments =>
            prevComments.map(c => c.id === commentId ? originalComment! : c)
          );
        }
      }
    } catch (error) {
      // Rollback on error
      logger.error('Error updating comment:', error);
      if (originalComment) {
        setComments(prevComments =>
          prevComments.map(c => c.id === commentId ? originalComment! : c)
        );
      }
    }
  }, [videoId, channelId]);

  // Optimistic comment deletion
  const deleteComment = useCallback(async (commentId: string) => {
    // Store original comment for rollback
    let deletedComment: Comments | undefined;

    setComments(prevComments => {
      deletedComment = prevComments.find(c => c.id === commentId);
      return prevComments.filter(comment => comment.id !== commentId);
    });
    setTotal(n => Math.max(0, n - 1));

    logger.info('Deleting comment:', commentId);

    try {
      // Send deletion to API
      const result = await deleteVideoComment(videoId, commentId, { channelId });

      if (!result || !result.success) {
        // Rollback on failure - restore the deleted comment
        logger.error('Failed to delete comment:', 'Unknown error');
        if (deletedComment) {
          setComments(prevComments => [deletedComment!, ...prevComments]);
          setTotal(n => n + 1);
        }
      }
    } catch (error) {
      // Rollback on error - restore the deleted comment
      logger.error('Error deleting comment:', error);
      if (deletedComment) {
        setComments(prevComments => [deletedComment!, ...prevComments]);
      }
    }
  }, [videoId, channelId]);

  return {
    comments,
    addComment,
    updateComment,
    deleteComment,
    toggleReaction,
    loadMore,
    hasMore: !!nextCursor,
    isLoading,
    isLoadingMore,
    loadError,
    isConnected,
    commentsCount: Math.max(total, comments.length)
  };
}
