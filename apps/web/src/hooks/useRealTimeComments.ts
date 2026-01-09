import { useState, useEffect, useCallback, useRef } from 'react';
import { Comments } from '@/interfaces';
import { CommentEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';
import { createVideoComment, updateVideoComment, deleteVideoComment } from '@/lib/api/videos';


export interface UseRealTimeCommentsOptions {
  videoId: string;
  channelId: string;
  initialComments?: Comments[];
  onCommentAdded?: (comment: Comments) => void;
  onCommentUpdated?: (comment: Comments) => void;
  onCommentDeleted?: (commentId: string) => void;
}

export interface UseRealTimeCommentsReturn {
  comments: Comments[];
  addComment: (comment: Omit<Comments, 'id' | 'dateCreated' | 'dateModified' | 'likesCount' | 'dislikesCount' | 'repliesCount' | 'isEdited' | 'isDeleted' | 'isPinned'>) => Promise<void>;
  updateComment: (commentId: string, updates: Partial<Comments>) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  isConnected: boolean;
  commentsCount: number;
}

export function useRealTimeComments(options: UseRealTimeCommentsOptions): UseRealTimeCommentsReturn {
  const { videoId, channelId, initialComments = [], onCommentAdded, onCommentUpdated, onCommentDeleted } = options;
  const [comments, setComments] = useState<Comments[]>(initialComments);

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
    logger.info('Adding comment:', optimisticComment);

    try {
      // Send comment to API - the API broadcasts the real comment via WebSocket
      const result = await createVideoComment(
        videoId,
        { content: commentData.text },
        { channelId }
      );

      if (!result || !result.success) {
        // Rollback on failure
        logger.error('Failed to create comment:', result?.error || 'Unknown error');
        setComments(prevComments => prevComments.filter(c => c.id !== tempId));
      }
    } catch (error) {
      // Rollback on error
      logger.error('Error creating comment:', error);
      setComments(prevComments => prevComments.filter(c => c.id !== tempId));
    }
  }, [videoId, channelId]);

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

    logger.info('Deleting comment:', commentId);

    try {
      // Send deletion to API
      const result = await deleteVideoComment(videoId, commentId, { channelId });

      if (!result || !result.success) {
        // Rollback on failure - restore the deleted comment
        logger.error('Failed to delete comment:', 'Unknown error');
        if (deletedComment) {
          setComments(prevComments => [deletedComment!, ...prevComments]);
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
    isConnected,
    commentsCount: comments.length
  };
}
