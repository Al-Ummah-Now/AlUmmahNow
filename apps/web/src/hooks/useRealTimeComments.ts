import { useState, useEffect, useCallback, useRef } from 'react';
import { Comments } from '@/interfaces';
import { CommentEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';

export interface UseRealTimeCommentsOptions {
  videoId: string;
  initialComments?: Comments[];
  onCommentAdded?: (comment: Comments) => void;
  onCommentUpdated?: (comment: Comments) => void;
  onCommentDeleted?: (commentId: string) => void;
}

export interface UseRealTimeCommentsReturn {
  comments: Comments[];
  addComment: (comment: Omit<Comments, 'id' | 'dateCreated' | 'dateModified' | 'likesCount' | 'dislikesCount' | 'repliesCount' | 'isEdited' | 'isDeleted' | 'isPinned'>) => void;
  updateComment: (commentId: string, updates: Partial<Comments>) => void;
  deleteComment: (commentId: string) => void;
  isConnected: boolean;
  commentsCount: number;
}

export function useRealTimeComments(options: UseRealTimeCommentsOptions): UseRealTimeCommentsReturn {
  const { videoId, initialComments = [], onCommentAdded, onCommentUpdated, onCommentDeleted } = options;
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
    console.log('📥 Real-time comment update:', event);

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
  const addComment = useCallback((commentData: Omit<Comments, 'id' | 'dateCreated' | 'dateModified' | 'likesCount' | 'dislikesCount' | 'repliesCount' | 'isEdited' | 'isDeleted' | 'isPinned'>) => {
    const optimisticComment: Comments = {
      id: `temp_${Date.now()}`,
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
    
    // TODO: Send comment to API
    // The API should broadcast the real comment via WebSocket
    console.log('📤 Adding comment:', optimisticComment);
  }, []);
  
  // Optimistic comment update
  const updateComment = useCallback((commentId: string, updates: Partial<Comments>) => {
    setComments(prevComments => 
      prevComments.map(comment => 
        comment.id === commentId 
          ? { ...comment, ...updates, dateModified: new Date().toISOString() }
          : comment
      )
    );
    
    // TODO: Send update to API
    console.log('📤 Updating comment:', commentId, updates);
  }, []);
  
  // Optimistic comment deletion
  const deleteComment = useCallback((commentId: string) => {
    setComments(prevComments => 
      prevComments.filter(comment => comment.id !== commentId)
    );
    
    // TODO: Send deletion to API
    console.log('📤 Deleting comment:', commentId);
  }, []);
  
  return {
    comments,
    addComment,
    updateComment,
    deleteComment,
    isConnected,
    commentsCount: comments.length
  };
}