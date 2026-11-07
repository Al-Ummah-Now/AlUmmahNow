"use client";

/**
 * Shared comment rendering for the LTR (components/comment) and RTL
 * (components/comment/rtl) variants: author line with "edited" and "held"
 * markers, text with clickable timestamps, reactions, reply, edit, delete,
 * approve, and a slot for replies.
 */

import React, { useId, useState } from "react";
import { ThumbsUp, ThumbsDown, Trash2, Pencil, MessageSquare, Check } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { dispatchPlayerSeek, parseCommentTimestamps } from "@/lib/video/comment-timestamps";

export interface CommentProps {
  author: string;
  text: string;
  time: string;
  avatar: string;
  isEdited?: boolean;
  /** Held for the video owner's review (shown to the author and the owner) */
  isHeld?: boolean;
  likesCount?: number;
  dislikesCount?: number;
  isLiked?: boolean;
  isDisliked?: boolean;
  /** Reactions are disabled for anonymous viewers / accounts without a channel */
  canReact?: boolean;
  onLike?: () => void;
  onDislike?: () => void;
  onDelete?: () => void;
  /** Save an edit; resolves true when stored */
  onEdit?: (text: string) => Promise<boolean>;
  /** Start a reply (top-level comments only) */
  onReply?: () => void;
  /** Video owner approves a held comment */
  onApprove?: () => void;
  /** Video the comment belongs to: timestamps seek its player */
  videoId?: string;
  /** Extra actions (e.g. report button) */
  actions?: React.ReactNode;
  /** Replies and the reply composer, rendered under the comment */
  children?: React.ReactNode;
  /** Smaller avatar for replies */
  isReply?: boolean;
  testId?: string;
}

interface CommentBodyProps extends CommentProps {
  dir: 'ltr' | 'rtl';
}

export function CommentText({ text, videoId }: { text: string; videoId?: string }) {
  const { t } = useLanguage();
  if (!videoId) return <>{text}</>;
  return (
    <>
      {parseCommentTimestamps(text).map((segment, index) =>
        segment.type === 'text' ? (
          <React.Fragment key={index}>{segment.value}</React.Fragment>
        ) : (
          <a
            key={index}
            href={`?t=${segment.seconds}`}
            dir="ltr"
            onClick={(e) => {
              e.preventDefault();
              dispatchPlayerSeek({ videoId, seconds: segment.seconds });
            }}
            aria-label={t.comments.seekTo.replace('{time}', segment.value)}
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            data-testid="comment-timestamp"
            data-seconds={segment.seconds}
          >
            {segment.value}
          </a>
        )
      )}
    </>
  );
}

export function CommentBody({
  dir,
  author,
  text,
  time,
  avatar,
  isEdited,
  isHeld,
  likesCount,
  dislikesCount,
  isLiked,
  isDisliked,
  canReact = false,
  onLike,
  onDislike,
  onDelete,
  onEdit,
  onReply,
  onApprove,
  videoId,
  actions,
  children,
  isReply,
  testId,
}: CommentBodyProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const editId = useId();
  const showReactions = likesCount !== undefined || onLike !== undefined;
  const avatarSize = isReply ? 'w-8 h-8' : 'w-10 h-10';

  const saveEdit = async () => {
    const next = draft.trim();
    if (!onEdit || !next || saving) return;
    setSaving(true);
    const ok = await onEdit(next);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div className="flex items-start gap-3" dir={dir} data-testid={testId || (isReply ? 'comment-reply' : 'comment')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatar} alt={t.comments.authorAvatar.replace('{name}', author)} className={`${avatarSize} rounded-full flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 className="font-bold">{author}</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {time}
            {isEdited && <span className="ms-1" data-testid="comment-edited">{t.comments.edited}</span>}
          </p>
          {isHeld && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" data-testid="comment-held">
              {t.comments.heldBadge}
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1 space-y-2">
            <label htmlFor={editId} className="sr-only">{t.comments.editComment}</label>
            <textarea
              id={editId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 text-base"
              disabled={saving}
              data-testid="comment-edit-input"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving || !draft.trim()}
                className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
                data-testid="comment-edit-save"
              >
                {saving ? t.comments.saving : t.comments.save}
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setDraft(text); }}
                disabled={saving}
                className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600"
              >
                {t.comments.cancel}
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-line break-words" data-testid="comment-text">
            <CommentText text={text} videoId={videoId} />
          </p>
        )}

        {(showReactions || onDelete || onEdit || onReply || onApprove || actions) && !editing && (
          <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-gray-600 dark:text-gray-400">
            {showReactions && (
              <>
                <button
                  type="button"
                  onClick={onLike}
                  disabled={!canReact}
                  aria-pressed={!!isLiked}
                  // The visible count must be part of the accessible name (WCAG 2.5.3)
                  aria-label={`${t.comments.like} ${likesCount ?? 0}`}
                  title={t.comments.like}
                  className={`flex items-center gap-1 disabled:opacity-50 ${isLiked ? 'text-yellow-600' : 'hover:text-gray-900 dark:hover:text-white'}`}
                >
                  <ThumbsUp className="w-4 h-4" aria-hidden="true" />
                  <span>{likesCount ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={onDislike}
                  disabled={!canReact}
                  aria-pressed={!!isDisliked}
                  aria-label={`${t.comments.dislike} ${dislikesCount ?? 0}`}
                  title={t.comments.dislike}
                  className={`flex items-center gap-1 disabled:opacity-50 ${isDisliked ? 'text-yellow-600' : 'hover:text-gray-900 dark:hover:text-white'}`}
                >
                  <ThumbsDown className="w-4 h-4" aria-hidden="true" />
                  <span>{dislikesCount ?? 0}</span>
                </button>
              </>
            )}
            {onReply && (
              <button type="button" onClick={onReply} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white" data-testid="comment-reply-button">
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
                {t.comments.reply}
              </button>
            )}
            {onApprove && (
              <button type="button" onClick={onApprove} className="flex items-center gap-1 text-green-700 dark:text-green-400 hover:underline" data-testid="comment-approve">
                <Check className="w-4 h-4" aria-hidden="true" />
                {t.comments.approve}
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() => { setDraft(text); setEditing(true); }}
                aria-label={t.comments.editComment}
                title={t.comments.edit}
                className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white"
                data-testid="comment-edit"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={t.comments.deleteComment}
                title={t.comments.deleteComment}
                className="flex items-center gap-1 hover:text-red-600"
                data-testid="comment-delete"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {actions}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
