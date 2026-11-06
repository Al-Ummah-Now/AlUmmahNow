"use client";
import React from "react";
import { ThumbsUp, ThumbsDown, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";

export interface CommentProps {
  author: string;
  text: string;
  time: string;
  avatar: string;
  isEdited?: boolean;
  likesCount?: number;
  dislikesCount?: number;
  isLiked?: boolean;
  isDisliked?: boolean;
  /** Reactions are disabled for anonymous viewers / accounts without a channel */
  canReact?: boolean;
  onLike?: () => void;
  onDislike?: () => void;
  onDelete?: () => void;
  /** Extra actions (e.g. report button) */
  actions?: React.ReactNode;
}

const Comment: React.FC<CommentProps> = ({
  author,
  text,
  time,
  avatar,
  isEdited,
  likesCount,
  dislikesCount,
  isLiked,
  isDisliked,
  canReact = false,
  onLike,
  onDislike,
  onDelete,
  actions,
}) => {
  const { t } = useLanguage();
  const showReactions = likesCount !== undefined || onLike !== undefined;

  return (
    <div className="flex items-start space-x-4" dir="ltr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatar} alt={t.comments.authorAvatar.replace('{name}', author)} className="w-10 h-10 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <h4 className="font-bold">{author}</h4>
          <p className="text-sm text-gray-500">
            {time}
            {isEdited && <span className="ml-1">{t.comments.edited}</span>}
          </p>
        </div>
        <p className="whitespace-pre-line break-words">{text}</p>
        {(showReactions || onDelete || actions) && (
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-600 dark:text-gray-400">
            {showReactions && (
              <>
                <button
                  type="button"
                  onClick={onLike}
                  disabled={!canReact}
                  aria-pressed={!!isLiked}
                  aria-label={t.comments.like}
                  title={t.comments.like}
                  className={`flex items-center gap-1 disabled:opacity-50 ${isLiked ? 'text-yellow-600' : 'hover:text-gray-900 dark:hover:text-white'}`}
                >
                  <ThumbsUp className="w-4 h-4" />
                  <span>{likesCount ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={onDislike}
                  disabled={!canReact}
                  aria-pressed={!!isDisliked}
                  aria-label={t.comments.dislike}
                  title={t.comments.dislike}
                  className={`flex items-center gap-1 disabled:opacity-50 ${isDisliked ? 'text-yellow-600' : 'hover:text-gray-900 dark:hover:text-white'}`}
                >
                  <ThumbsDown className="w-4 h-4" />
                  <span>{dislikesCount ?? 0}</span>
                </button>
              </>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={t.comments.deleteComment}
                title={t.comments.deleteComment}
                className="flex items-center gap-1 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

export default Comment;
