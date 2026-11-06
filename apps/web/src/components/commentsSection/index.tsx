'use client';
import { logger } from '@/lib/logger-client';
import React, { useState } from "react";
import Link from "next/link";
import CommentLTR, { CommentProps } from "@/components/comment";
import CommentRTL from "@/components/comment/rtl";
import ReportContentButton from "@/components/moderation/ReportContentButton";
import { Comments } from "@/interfaces";
import { useRealTimeComments, CommentReaction } from "@/hooks/useRealTimeComments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { useLanguage } from "@/hooks/useLanguage";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { User } from "@/interfaces";

export interface CommentsSectionProps {
  videoId: string;
  /** Video owner's user id; the owner may delete any comment */
  videoOwnerId?: string;
  initialComments?: Comments[];
  user: User | null;
}

const DEFAULT_AVATAR = "/avatar.png";

const CommentsSection: React.FC<CommentsSectionProps> = ({
  videoId,
  videoOwnerId,
  initialComments,
  user
}) => {
  const { t, lang, isRTL } = useLanguage();
  const { profile } = useProfile(user || null);
  const { user: account } = useMultiAccount();
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState(false);

  const Comment = isRTL ? CommentRTL : CommentLTR;

  // Comments, likes and dislikes are made by the active channel
  const activeChannel = account?.channel || null;
  const channelId = activeChannel?.id || '';
  const canInteract = !!user && !!channelId;

  const {
    comments,
    addComment,
    deleteComment,
    toggleReaction,
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    loadError,
    isConnected,
    commentsCount
  } = useRealTimeComments({
    videoId,
    channelId,
    initialComments,
    onCommentAdded: (comment) => {
      logger.debug("New comment added:", comment);
    },
    onCommentUpdated: (comment) => {
      logger.debug("Comment updated:", comment);
    },
    onCommentDeleted: (commentId) => {
      logger.debug("Comment deleted:", commentId);
    }
  });

  const handleReaction = async (commentId: string, reaction: CommentReaction) => {
    if (!canInteract) return;
    setActionError(false);
    const ok = await toggleReaction(commentId, reaction);
    if (!ok) setActionError(true);
  };

  const handleDelete = async (commentId: string) => {
    if (!window.confirm(t.comments.confirmDelete)) return;
    await deleteComment(commentId);
  };

  // Map the API comment (with its own author) to the presentational props
  const toCommentProps = (comment: Comments): CommentProps => {
    const isOwnComment = !!user && comment.userId === user.id;
    const isVideoOwner = !!user && !!videoOwnerId && videoOwnerId === user.id;
    const isTemp = comment.id.startsWith('temp_');
    const authorName = comment.author?.displayName
      || (isOwnComment ? (activeChannel?.name || profile?.displayName || '') : '')
      || t.comments.unknownAuthor;
    const authorAvatar = comment.author?.avatarUrl
      || (isOwnComment ? (activeChannel?.avatarUrl || profile?.avatarUrl) : undefined)
      || DEFAULT_AVATAR;

    return {
      author: authorName,
      text: comment.text,
      time: new Date(comment.dateCreated).toLocaleDateString(lang === 'ar' ? 'ar' : 'en'),
      avatar: authorAvatar,
      isEdited: comment.isEdited,
      likesCount: comment.likesCount ?? 0,
      dislikesCount: comment.dislikesCount ?? 0,
      isLiked: comment.isLiked,
      isDisliked: comment.isDisliked,
      canReact: canInteract && !isTemp,
      onLike: () => handleReaction(comment.id, 'like'),
      onDislike: () => handleReaction(comment.id, 'dislike'),
      onDelete: !isTemp && (isOwnComment || isVideoOwner) ? () => handleDelete(comment.id) : undefined,
      actions: !isTemp && !isOwnComment ? (
        <ReportContentButton contentType="comment" contentId={comment.id} contentTitle={comment.text.slice(0, 80)} compact />
      ) : undefined,
    };
  };

  const handleSubmitComment = async () => {
    if (!newCommentText.trim() || !canInteract || isSubmitting) return;

    setIsSubmitting(true);
    setActionError(false);

    try {
      const ok = await addComment({
        userId: user!.id,
        channelId,
        videoId,
        text: newCommentText.trim()
      });

      if (ok) {
        setNewCommentText("");
      } else {
        setActionError(true);
      }
    } catch (error) {
      logger.error("Failed to add comment:", error);
      setActionError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const composerAvatar = activeChannel?.avatarUrl || profile?.avatarUrl || DEFAULT_AVATAR;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
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
      {user && canInteract ? (
        <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={composerAvatar}
              alt={t.comments.yourAvatar}
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
      ) : user ? (
        // Signed in but no channel: comments and reactions are posted as a channel
        <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-3">
            {t.errors.channelRequired}
          </p>
          <Link href={`/${lang}/profile`}>
            <Button size="sm">{t.navigation.createChannel}</Button>
          </Link>
        </div>
      ) : (
        <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-3">
            {t.comments.signInToComment}
          </p>
          <Button
            size="sm"
            onClick={() => window.location.href = `/${lang}/login?redirect=${encodeURIComponent(window.location.pathname)}`}
          >
            {t.comments.signIn}
          </Button>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">{t.comments.actionFailed}</p>
      )}

      {/* Comments list */}
      <div className="space-y-4">
        {isLoading && comments.length === 0 ? (
          <p className="text-gray-500 text-center py-8">{t.comments.loading}</p>
        ) : loadError && comments.length === 0 ? (
          <p className="text-red-600 dark:text-red-400 text-center py-8" role="alert">{t.comments.loadFailed}</p>
        ) : comments.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            {t.comments.noComments}
          </p>
        ) : (
          comments.map((comment) => (
            <Comment
              key={comment.id}
              {...toCommentProps(comment)}
            />
          ))
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t.common.loading : t.comments.loadMore}
          </Button>
        </div>
      )}

      {/* Real-time update indicator */}
      {isConnected && comments.length > 0 && (
        <div className="text-xs text-green-600 text-center py-2">
          {t.comments.liveUpdates}
        </div>
      )}
    </div>
  );
};

export default CommentsSection;
