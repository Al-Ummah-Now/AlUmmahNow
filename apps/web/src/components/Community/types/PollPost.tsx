'use client';

import { logger } from '@/lib/logger-client';

import { useState } from 'react';
import Image from 'next/image';
import { CommunityPost, PollOption } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import { voteOnPoll } from '@/lib/api/community-posts';
import { useLanguage } from '@/hooks/useLanguage';

interface PollPostProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
  /** Viewer's active channel (acting identity for the vote) */
  channelId?: string;
  /** Viewer's user ID; voting requires a signed-in viewer */
  userId?: string;
}

export default function PollPost({ post, isRTL = false, locale = 'en', channelId, userId }: PollPostProps) {
  const { t } = useLanguage();
  const viewerVote = post.viewerPollVote ?? [];
  const [selectedOptions, setSelectedOptions] = useState<string[]>(viewerVote);
  const [hasVoted, setHasVoted] = useState(viewerVote.length > 0);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState(false);
  const [options, setOptions] = useState<PollOption[]>(post.poll?.options ?? []);
  const [totalVotes, setTotalVotes] = useState(post.poll?.totalVotes ?? 0);

  if (!post.poll) return null;

  const { question, multipleChoice, votingEndsAt } = post.poll;

  const isVotingEnded = Boolean(votingEndsAt && new Date(votingEndsAt) < new Date());
  const canVote = Boolean(userId && channelId);

  const handleOptionClick = (optionId: string) => {
    if (hasVoted || isVotingEnded || voting || !canVote) return;

    if (multipleChoice) {
      setSelectedOptions((prev) =>
        prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId]
      );
    } else {
      setSelectedOptions([optionId]);
    }
  };

  const handleVote = async () => {
    if (selectedOptions.length === 0 || voting || !channelId || !userId) return;

    setVoting(true);
    setVoteError(false);
    try {
      const result = await voteOnPoll(
        post.channelId,
        post.id,
        { optionIds: selectedOptions },
        { channelId }
      );

      if (result?.success) {
        setHasVoted(true);
        if (result.results) {
          const byId = new Map(result.results.options.map((opt) => [opt.id, opt]));
          setOptions((prev) =>
            prev.map((opt) => ({
              ...opt,
              votes: byId.get(opt.id)?.votes ?? opt.votes,
              percentage: byId.get(opt.id)?.percentage ?? opt.percentage,
            }))
          );
          setTotalVotes(result.results.totalVotes);
        }
      } else {
        setVoteError(true);
      }
    } catch (error) {
      logger.error('[PollPost] Failed to vote', { postId: post.id, error });
      setVoteError(true);
    } finally {
      setVoting(false);
    }
  };

  const voteCountLabel = totalVotes === 1
    ? t.community.voteCountOne
    : t.community.voteCountMany.replace('{count}', totalVotes.toLocaleString(locale));

  return (
    <div className="space-y-4">
      {/* Text content */}
      {post.content && (
        <p className={cn(
          'text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words',
          isRTL && 'text-right'
        )}>
          {post.content}
        </p>
      )}

      {/* Poll Question */}
      <div className={cn(
        'font-semibold text-lg text-gray-900 dark:text-gray-100',
        isRTL && 'text-right'
      )}>
        {question}
      </div>

      {/* Poll Options */}
      <div className="space-y-3">
        {options.map((option) => {
          const percentage = option.percentage || 0;
          const isSelected = selectedOptions.includes(option.id);
          const showResults = hasVoted || post.poll?.showResults || isVotingEnded;
          const optionLabel = option.text || option.image?.caption || t.community.pollOption;

          return (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option.id)}
              disabled={hasVoted || isVotingEnded || voting || !canVote}
              aria-pressed={isSelected}
              aria-label={showResults ? `${optionLabel} ${percentage.toFixed(1)}%` : optionLabel}
              className={cn(
                'w-full relative rounded-lg border-2 transition-all text-left',
                isRTL && 'text-right',
                showResults
                  ? 'border-gray-200 dark:border-gray-700 cursor-default'
                  : isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                (hasVoted || isVotingEnded) && 'cursor-not-allowed'
              )}
            >
              {/* Progress Bar */}
              {showResults && (
                <div
                  className={cn(
                    'absolute inset-0 bg-blue-100 dark:bg-blue-900/30 rounded-lg transition-all',
                    isRTL && 'right-0'
                  )}
                  style={{
                    width: `${percentage}%`,
                    [isRTL ? 'right' : 'left']: 0,
                  }}
                />
              )}

              {/* Option Content */}
              <div className={cn(
                'relative p-4 flex items-center gap-3',
                isRTL && 'flex-row-reverse'
              )}>
                {/* Checkbox/Radio */}
                <div className={cn(
                  'flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center',
                  multipleChoice ? 'rounded' : 'rounded-full',
                  isSelected
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-300 dark:border-gray-600'
                )}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>

                {/* Option Text/Image */}
                {option.image ? (
                  <div className="flex-1 min-w-0">
                    <div className="relative w-full h-32">
                      <Image
                        src={option.image.url}
                        alt={optionLabel}
                        fill
                        className="object-cover rounded"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    </div>
                    {option.image.caption && (
                      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        {option.image.caption}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="flex-1 text-gray-900 dark:text-gray-100">
                    {option.text}
                  </span>
                )}

                {/* Percentage */}
                {showResults && (
                  <span className={cn(
                    'font-semibold text-gray-700 dark:text-gray-300',
                    isRTL ? 'mr-auto' : 'ml-auto'
                  )}>
                    {percentage.toFixed(1)}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Vote Button */}
      {!hasVoted && !isVotingEnded && !canVote && (
        <p className={cn('text-sm text-gray-500 dark:text-gray-400', isRTL && 'text-right')}>
          {t.community.signInToVote}
        </p>
      )}

      {voteError && (
        <p role="alert" className={cn('text-sm text-red-600 dark:text-red-400', isRTL && 'text-right')}>
          {t.community.voteFailed}
        </p>
      )}

      {!hasVoted && !isVotingEnded && canVote && (
        <button
          onClick={handleVote}
          disabled={selectedOptions.length === 0 || voting}
          className={cn(
            'w-full py-3 px-6 rounded-lg font-medium transition-colors',
            'bg-blue-600 hover:bg-blue-700 text-white',
            'disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed',
            'dark:bg-blue-500 dark:hover:bg-blue-600'
          )}
        >
          {voting ? t.community.voting : t.community.vote}
        </button>
      )}

      {/* Poll Info */}
      <div className={cn(
        'flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400',
        isRTL && 'flex-row-reverse'
      )}>
        <span>
          {voteCountLabel}
        </span>
        {votingEndsAt && (
          <span>
            {isVotingEnded
              ? t.community.votingEnded
              : t.community.votingEnds.replace('{date}', new Date(votingEndsAt).toLocaleDateString(locale))}
          </span>
        )}
      </div>
    </div>
  );
}
