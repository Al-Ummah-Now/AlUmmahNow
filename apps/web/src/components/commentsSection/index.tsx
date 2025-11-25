'use client';
import { logger } from '@/lib/logger-client';
import React, { useState } from "react";
import Comment, { CommentProps } from "@/components/comment";
import { Comments } from "@/interfaces";
import { useRealTimeComments } from "@/hooks/useRealTimeComments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { useLanguage } from "@/hooks/useLanguage";
import { User } from "@/interfaces";

interface CommentsSectionProps {
  videoId: string;
  initialComments?: Comments[];
  user: User | null;
}

const CommentsSection: React.FC<CommentsSectionProps> = ({
  videoId,
  initialComments = [],
  user
}) => {
  const { t } = useLanguage();
  const { profile } = useProfile(user || null);
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    comments,
    addComment,
    isConnected,
    commentsCount
  } = useRealTimeComments({
    videoId,
    initialComments,
    onCommentAdded: (comment) => {
      logger.debug("📢 New comment added:", comment);
    },
    onCommentUpdated: (comment) => {
      logger.debug("📢 Comment updated:", comment);
    },
    onCommentDeleted: (commentId) => {
      logger.debug("📢 Comment deleted:", commentId);
    }
  });

  // Convert Comments interface to CommentProps for the existing Comment component
  const convertToCommentProps = (comment: Comments): CommentProps => ({
    author: profile?.displayName || profile?.firstName || "User",
    text: comment.text,
    time: new Date(comment.dateCreated).toLocaleDateString(),
    avatar: profile?.avatarUrl || "/avatar.png"
  });

  const handleSubmitComment = async () => {
    if (!newCommentText.trim() || !user?.id || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Add comment optimistically
      addComment({
        userId: user.id,
        channelId: profile?.id || user.id,
        videoId,
        text: newCommentText.trim()
      });

      setNewCommentText("");
    } catch (error) {
      logger.error("Failed to add comment:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with connection status */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {t.comments.commentsCount.replace('{count}', commentsCount.toString())}
        </h2>
        {/* Connection status - only show in development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-gray-500">
              {isConnected ? t.comments.live : t.comments.offline}
            </span>
          </div>
        )}
      </div>

      {/* Add comment form */}
      {user && profile ? (
        <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
          <div className="flex items-start space-x-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profile.avatarUrl || "/avatar.png"}
              alt="Your avatar"
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1">
              <Textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder={t.comments.addComment}
                className="min-h-[80px] resize-none"
                disabled={isSubmitting}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewCommentText("")}
              disabled={isSubmitting}
            >
              {t.comments.cancel}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitComment}
              disabled={!newCommentText.trim() || isSubmitting}
            >
              {isSubmitting ? t.comments.commenting : t.comments.comment}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-3">
            {t.comments.signInToComment}
          </p>
          <Button
            size="sm"
            onClick={() => window.location.href = '/login'}
          >
            {t.comments.signIn}
          </Button>
        </div>
      )}

      {/* Comments list */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            {t.comments.noComments}
          </p>
        ) : (
          comments.map((comment) => (
            <Comment
              key={comment.id}
              {...convertToCommentProps(comment)}
            />
          ))
        )}
      </div>

      {/* Real-time update indicator */}
      {isConnected && comments.length > 0 && (
        <div className="text-xs text-green-600 text-center py-2">
          ✨ {t.comments.liveUpdates}
        </div>
      )}
    </div>
  );
};

export default CommentsSection;
