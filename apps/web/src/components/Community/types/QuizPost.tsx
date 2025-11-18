'use client';

import { useState } from 'react';
import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';

interface QuizPostProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
}

export default function QuizPost({ post, isRTL = false }: QuizPostProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  if (!post.quiz) return null;

  const { question, options, correctOptionId, explanation, totalAttempts, correctAttempts } = post.quiz;

  const handleOptionClick = (optionId: string) => {
    if (showAnswer) return;
    setSelectedOption(optionId);
  };

  const handleSubmit = () => {
    if (!selectedOption) return;
    setShowAnswer(true);
  };

  const isCorrect = selectedOption === correctOptionId;
  const successRate = totalAttempts > 0 ? (correctAttempts / totalAttempts) * 100 : 0;

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

      {/* Quiz Question */}
      <div className={cn(
        'font-semibold text-lg text-gray-900 dark:text-gray-100',
        isRTL && 'text-right'
      )}>
        {question}
      </div>

      {/* Quiz Options */}
      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = selectedOption === option.id;
          const isCorrectOption = option.id === correctOptionId;

          return (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option.id)}
              disabled={showAnswer}
              className={cn(
                'w-full relative rounded-lg border-2 transition-all text-left',
                isRTL && 'text-right',
                showAnswer
                  ? isCorrectOption
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : isSelected
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                  : isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                showAnswer && 'cursor-default'
              )}
            >
              <div className={cn(
                'p-4 flex items-center gap-3',
                isRTL && 'flex-row-reverse'
              )}>
                {/* Icon */}
                <div className={cn(
                  'flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center',
                  showAnswer
                    ? isCorrectOption
                      ? 'border-green-500 bg-green-500'
                      : isSelected
                      ? 'border-red-500 bg-red-500'
                      : 'border-gray-300 dark:border-gray-600'
                    : isSelected
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-300 dark:border-gray-600'
                )}>
                  {showAnswer && isCorrectOption && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {showAnswer && isSelected && !isCorrectOption && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                  {!showAnswer && isSelected && (
                    <div className="w-2 h-2 bg-white rounded-full" />
                  )}
                </div>

                {/* Option Text/Image */}
                {option.image ? (
                  <div className="flex-1 min-w-0">
                    <img
                      src={option.image.url}
                      alt={option.text}
                      className="w-full h-24 object-cover rounded"
                    />
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                      {option.text}
                    </p>
                  </div>
                ) : (
                  <span className="flex-1 text-gray-900 dark:text-gray-100">
                    {option.text}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit Button */}
      {!showAnswer && (
        <button
          onClick={handleSubmit}
          disabled={!selectedOption}
          className={cn(
            'w-full py-3 px-6 rounded-lg font-medium transition-colors',
            'bg-blue-600 hover:bg-blue-700 text-white',
            'disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed',
            'dark:bg-blue-500 dark:hover:bg-blue-600'
          )}
        >
          {isRTL ? 'إرسال' : 'Submit'}
        </button>
      )}

      {/* Result and Explanation */}
      {showAnswer && (
        <div className={cn(
          'p-4 rounded-lg',
          isCorrect
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
        )}>
          <div className={cn(
            'flex items-center gap-2 mb-2',
            isRTL && 'flex-row-reverse'
          )}>
            {isCorrect ? (
              <>
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="font-semibold text-green-900 dark:text-green-100">
                  {isRTL ? 'صحيح!' : 'Correct!'}
                </span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="font-semibold text-red-900 dark:text-red-100">
                  {isRTL ? 'خطأ' : 'Incorrect'}
                </span>
              </>
            )}
          </div>
          {explanation && (
            <p className={cn(
              'text-gray-700 dark:text-gray-300',
              isRTL && 'text-right'
            )}>
              {explanation}
            </p>
          )}
        </div>
      )}

      {/* Quiz Stats */}
      <div className={cn(
        'text-sm text-gray-500 dark:text-gray-400',
        isRTL && 'text-right'
      )}>
        {totalAttempts} {isRTL ? 'محاولة' : totalAttempts === 1 ? 'attempt' : 'attempts'} • {' '}
        {successRate.toFixed(0)}% {isRTL ? 'نسبة النجاح' : 'success rate'}
      </div>
    </div>
  );
}
