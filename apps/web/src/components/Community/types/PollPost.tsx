import { logger } from '@/lib/logger-client';

import { useState } from 'react';
import Image from 'next/image';
import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import { voteOnPoll } from '@/lib/api/community-posts';

interface PollPostProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
}

export default function PollPost({ post, isRTL = false }: PollPostProps) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [voting, setVoting] = useState(false);

  if (!post.poll) return null;

  const { question, options, totalVotes, multipleChoice, votingEndsAt } = post.poll;

  const isVotingEnded = votingEndsAt && new Date(votingEndsAt) < new Date();

  const handleOptionClick = (optionId: string) => {
    if (hasVoted || isVotingEnded || voting) return;

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
    if (selectedOptions.length === 0 || voting) return;

    setVoting(true);
    try {
      const result = await voteOnPoll(
        post.channelId,
        post.id,
        { optionIds: selectedOptions },
        { channelId: post.channelId }
      );

      if (result?.success) {
        setHasVoted(true);
      }
    } catch (error) {
      logger.error('Failed to vote:', error);
    } finally {
      setVoting(false);
    }
  };

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

          return (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option.id)}
              disabled={hasVoted || isVotingEnded || voting}
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
                        alt={option.image.caption || option.text || 'Poll option'}
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
      {!hasVoted && !isVotingEnded && (
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
          {voting
            ? (isRTL ? 'جاري التصويت...' : 'Voting...')
            : (isRTL ? 'تصويت' : 'Vote')}
        </button>
      )}

      {/* Poll Info */}
      <div className={cn(
        'flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400',
        isRTL && 'flex-row-reverse'
      )}>
        <span>
          {totalVotes} {isRTL ? 'صوت' : totalVotes === 1 ? 'vote' : 'votes'}
        </span>
        {votingEndsAt && (
          <span>
            {isVotingEnded
              ? (isRTL ? 'انتهى التصويت' : 'Voting ended')
              : (isRTL ? 'ينتهي التصويت في' : 'Voting ends') + ' ' + new Date(votingEndsAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
