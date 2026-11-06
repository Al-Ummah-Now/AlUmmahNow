'use client';

interface SectionEmptyStateProps {
  message: string;
}

/**
 * Dashed placeholder shown when a channel section has no content
 */
export function SectionEmptyState({ message }: SectionEmptyStateProps) {
  return (
    <div
      role="status"
      className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700"
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center">{message}</p>
    </div>
  );
}
