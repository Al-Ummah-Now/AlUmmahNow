'use client';
import { ListFilter } from 'lucide-react';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { logger } from '@/lib/logger-client';
import React, { useId, useState } from "react";
import CommentLTR, { CommentProps } from "@/components/comment";
import CommentRTL from "@/components/comment/rtl";
import ReportContentButton from "@/components/moderation/ReportContentButton";
import { Comments } from "@/interfaces";
import { useRealTimeComments, CommentSort, AddCommentResult } from "@/hooks/useRealTimeComments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { useLanguage } from "@/hooks/useLanguage";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { User } from "@/interfaces";
import { formatRelativeTime } from '@/lib/format/videoMeta';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';
import { userDisplayName } from '@/lib/display-name';
import { requestAccountMenu } from '@/lib/navigation/account-menu-events';

export interface CommentsSectionProps {
  videoId: string;
  /** Video owner's user id; the owner may delete any comment and approves held ones */
  videoOwnerId?: string;
  /** Kept for callers that pass a preloaded list; comments always load from the API */
  initialComments?: Comments[];
  user: User | null;
}

const DEFAULT_AVATAR = "/avatar.png";

const CommentsSection: React.FC<CommentsSectionProps> = ({
  videoId,
  videoOwnerId,
  user
}) => {
  const { t, lang, isRTL } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { profile } = useProfile(user || null);
  const { user: account } = useMultiAccount();
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState(false);
  // Bot protection: the check failed, or too many comments in a minute
  const [botNotice, setBotNotice] = useState<'human_check' | 'rate_limited' | null>(null);
  const [heldNotice, setHeldNotice] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const composerId = useId();

  const Comment = isRTL ? CommentRTL : CommentLTR;

  // With a channel active, comments and likes are that channel's; without one
  // the member comments and likes as themselves (profile name and avatar, #1151)
  const activeChannel = account?.channel || null;
  const channelId = activeChannel?.id || '';
  const canInteract = !!user;
  const hasChannels = (account?.channels?.length ?? 0) > 0;
  const isVideoOwner = !!user && !!videoOwnerId && videoOwnerId === user.id;

  const {
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
    toggleLike,
    toggleReplies,
    loadMoreReplies,
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    loadError,
    isConnected,
    commentsCount,
    humanChecking,
  } = useRealTimeComments({
    videoId,
    channelId,
    onCommentAdded: (comment) => logger.debug("[CommentsSection] Live comment", { commentId: comment.id }),
  });

  const commentsOff = commentSettings === 'off';

  const reportResult = (result: AddCommentResult) => {
    if (result.ok) {
      setHeldNotice(result.held);
      setBotNotice(null);
      return true;
    }
    if (result.error === 'human_check' || result.error === 'rate_limited') {
      setBotNotice(result.error);
      return false;
    }
    setActionError(result.error !== 'comments_disabled');
    return false;
  };

  const handleLike = async (commentId: string) => {
    if (!canInteract) return;
    setActionError(false);
    const ok = await toggleLike(commentId);
    if (!ok) setActionError(true);
  };

  const handleDelete = async (commentId: string) => {
    const confirmed = await confirm({
      title: t.confirmDialog.deleteCommentTitle,
      description: t.confirmDialog.deleteCommentBody,
      confirmLabel: t.common.delete,
      testId: 'comment-delete-dialog',
    });
    if (!confirmed) return;
    setActionError(false);
    const ok = await deleteComment(commentId);
    if (!ok) setActionError(true);
  };

  const handleEdit = async (commentId: string, text: string) => {
    setActionError(false);
    const ok = await updateComment(commentId, text);
    if (!ok) setActionError(true);
    return ok;
  };

  const handleApprove = async (commentId: string) => {
    setActionError(false);
    const ok = await approveComment(commentId);
    if (!ok) setActionError(true);
  };

  // Map the API comment (with its own author) to the presentational props
  const toCommentProps = (comment: Comments, isReply: boolean): CommentProps => {
    const isOwnComment = !!user && comment.userId === user.id;
    const authorName = comment.author?.displayName?.trim()
      || (isOwnComment ? (activeChannel?.name?.trim() || userDisplayName(profile, lang)) : '')
      || t.comments.unknownAuthor;
    const authorAvatar = comment.author?.avatarUrl
      || (isOwnComment ? (activeChannel?.avatarUrl || profile?.avatarUrl) : undefined)
      || DEFAULT_AVATAR;

    return {
      author: authorName,
      text: comment.text,
      time: formatRelativeTime(comment.dateCreated, lang),
      avatar: authorAvatar,
      isEdited: comment.isEdited,
      isHeld: comment.isHeld,
      isReply,
      videoId,
      likesCount: comment.likesCount ?? 0,
      isLiked: comment.isLiked,
      canReact: canInteract && !comment.isHeld,
      onLike: () => handleLike(comment.id),
      onDelete: isOwnComment || isVideoOwner ? () => handleDelete(comment.id) : undefined,
      onEdit: isOwnComment ? (text) => handleEdit(comment.id, text) : undefined,
      onReply: !isReply && canInteract && !commentsOff && !comment.isHeld
        ? () => { setReplyingTo(comment.id); setReplyText(""); }
        : undefined,
      onApprove: isVideoOwner && comment.isHeld ? () => handleApprove(comment.id) : undefined,
      actions: !isOwnComment ? (
        <ReportContentButton contentType="comment" contentId={comment.id} contentTitle={comment.text.slice(0, 80)} compact />
      ) : undefined,
    };
  };

  const handleSubmitComment = async () => {
    const text = newCommentText.trim();
    if (!text || !canInteract || isSubmitting) return;

    setIsSubmitting(true);
    setActionError(false);
    try {
      if (reportResult(await addComment(text))) setNewCommentText("");
    } catch (error) {
      logger.error("Failed to add comment:", error);
      setActionError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string) => {
    const text = replyText.trim();
    if (!text || replySubmitting) return;
    setReplySubmitting(true);
    setActionError(false);
    try {
      if (reportResult(await addReply(parentId, text))) {
        setReplyText("");
        setReplyingTo(null);
      }
    } catch (error) {
      logger.error("Failed to add reply:", error);
      setActionError(true);
    } finally {
      setReplySubmitting(false);
    }
  };

  const composerAvatar = activeChannel?.avatarUrl || profile?.avatarUrl || DEFAULT_AVATAR;
  // Who the comment will be posted as: the active channel, or the member themselves
  // (their own email only as the last resort: this line is shown to them alone)
  // The channel's name in the page's language, as the account menu shows it
  const composerName = activeChannel?.nameLocalized?.[lang]?.trim() || activeChannel?.name?.trim() || userDisplayName(profile, lang, user?.email);
  const [commentingBefore, commentingAfter = ''] = t.comments.commentingAs.split('{name}');

  const renderThread = (comment: Comments) => {
    const thread = replies[comment.id];
    const count = comment.repliesCount || 0;
    const showToggle = count > 0 || (thread?.items.length ?? 0) > 0;
    return (
      <>
        {showToggle && (
          <button
            type="button"
            onClick={() => toggleReplies(comment.id)}
            aria-expanded={!!thread?.open}
            className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            data-testid="comment-replies-toggle"
          >
            {thread?.open ? t.comments.hideReplies : t.comments.showReplies.replace('{count}', String(Math.max(count, thread?.items.length ?? 0)))}
          </button>
        )}
        {thread?.open && (
          <div className="mt-3 space-y-3 border-s-2 border-gray-200 dark:border-gray-700 ps-4" data-testid="comment-replies">
            {thread.items.map((reply) => (
              <Comment key={reply.id} {...toCommentProps(reply, true)} />
            ))}
            {thread.loading && <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{t.comments.loading}</p>}
            {thread.nextCursor && !thread.loading && (
              <button type="button" onClick={() => loadMoreReplies(comment.id)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                {t.comments.loadMoreReplies}
              </button>
            )}
          </div>
        )}
        {replyingTo === comment.id && (
          <div className="mt-3 space-y-2" data-testid="reply-composer">
            <label htmlFor={`${composerId}-${comment.id}`} className="sr-only">{t.comments.replyPlaceholder}</label>
            <Textarea
              id={`${composerId}-${comment.id}`}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t.comments.replyPlaceholder}
              className="min-h-[60px] resize-none text-base"
              disabled={replySubmitting}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setReplyingTo(null); setReplyText(""); }} disabled={replySubmitting}>
                {t.comments.cancel}
              </Button>
              <Button size="sm" onClick={() => handleSubmitReply(comment.id)} disabled={!replyText.trim() || replySubmitting} data-testid="reply-submit">
                {replySubmitting ? t.comments.replying : t.comments.reply}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'} data-testid="comments-section">
      {confirmDialog}
      {/* Header: count, sort, connection status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold" data-testid="comments-count">
          {t.comments.commentsCount.replace('{count}', commentsCount.toString())}
        </h2>
        <div className="flex items-center gap-3">
          {!commentsOff && (
            <ThemedSelect
              label={t.comments.sortBy}
              value={sort}
              onChange={(v) => setSort(v as CommentSort)}
              options={[{ value: 'top', label: t.comments.sortTop }, { value: 'newest', label: t.comments.sortNewest }]}
              icon={<ListFilter aria-hidden="true" />}
              dir={isRTL ? 'rtl' : 'ltr'}
              testId="comments-sort"
            />
          )}
          {/* Connection status - only show in development */}
          {process.env.NODE_ENV === 'development' && (
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-gray-600 dark:text-gray-400">
                {isConnected ? t.comments.live : t.comments.offline}
              </span>
            </div>
          )}
        </div>
      </div>

      {commentsOff ? (
        <p className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-center" role="status" data-testid="comments-off">
          {t.comments.commentsOff}
        </p>
      ) : user && canInteract ? (
        <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
          {commentSettings === 'held' && !isVideoOwner && (
            <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="comments-held-info">{t.comments.heldForReviewInfo}</p>
          )}
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={composerAvatar}
              alt={t.comments.yourAvatar}
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1">
              {composerName && (
                <p className="mb-1 text-sm font-medium" data-testid="comment-identity" data-as={activeChannel ? 'channel' : 'member'}>
                  {/* The name in its own direction: an English channel name inside Arabic text stays in order */}
                  {commentingBefore}<bdi>{composerName}</bdi>{commentingAfter}
                  {/* With channels to choose from, change who you comment as right here (the account menu's channel list) */}
                  {hasChannels && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="font-medium underline underline-offset-2"
                        aria-label={t.navigation.switchChannel}
                        data-testid="comment-identity-switch"
                        onClick={() => requestAccountMenu({ open: true, view: 'channels', focus: true })}
                      >
                        {t.comments.switchIdentity}
                      </button>
                    </>
                  )}
                </p>
              )}
              <label htmlFor={composerId} className="sr-only">{t.comments.addComment}</label>
              <Textarea
                id={composerId}
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder={t.comments.addComment}
                className="min-h-[80px] resize-none text-base"
                disabled={isSubmitting}
                data-testid="comment-input"
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
              data-testid="comment-submit"
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
            onClick={() => window.location.href = loginRoutePath(window.location.pathname, lang)}
          >
            {t.comments.signIn}
          </Button>
        </div>
      )}

      {heldNotice && (
        <p className="text-sm text-brand-ink dark:text-brand-ink" role="status" data-testid="comment-held-notice">{t.comments.heldNotice}</p>
      )}
      {humanChecking && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="comment-human-check">{t.humanCheck.checking}</p>
      )}
      {botNotice && (
        <p className="text-sm text-destructive" role="alert" data-testid="comment-bot-notice">
          {botNotice === 'rate_limited' ? t.humanCheck.rateLimited : t.humanCheck.failed}
        </p>
      )}
      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">{t.comments.actionFailed}</p>
      )}

      {/* Comments list */}
      {!commentsOff && (
        <div className="space-y-4" data-testid="comments-list">
          {isLoading && comments.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-center py-8">{t.comments.loading}</p>
          ) : loadError && comments.length === 0 ? (
            <p className="text-red-600 dark:text-red-400 text-center py-8" role="alert">{t.comments.loadFailed}</p>
          ) : comments.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-center py-8">
              {t.comments.noComments}
            </p>
          ) : (
            comments.map((comment) => (
              <Comment key={comment.id} {...toCommentProps(comment, false)}>
                {renderThread(comment)}
              </Comment>
            ))
          )}
        </div>
      )}

      {hasMore && !commentsOff && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t.common.loading : t.comments.loadMore}
          </Button>
        </div>
      )}

      {/* Real-time update indicator */}
      {isConnected && comments.length > 0 && !commentsOff && (
        <div className="text-xs text-green-700 dark:text-green-400 text-center py-2">
          {t.comments.liveUpdates}
        </div>
      )}
    </div>
  );
};

export default CommentsSection;
