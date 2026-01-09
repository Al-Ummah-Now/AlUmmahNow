'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { takeAction } from '@/lib/api/admin';
import type { ModerationAction } from '@al-ummah/shared-types';

interface ReportActionsProps {
  reportId: string;
}

const actionOptions: { value: ModerationAction; label: string; description: string; color: string }[] = [
  {
    value: 'warning',
    label: 'Issue Warning',
    description: 'Flag content with a warning but keep it visible',
    color: 'bg-yellow-600 hover:bg-yellow-700',
  },
  {
    value: 'removed',
    label: 'Remove Content',
    description: 'Hide content from public view',
    color: 'bg-orange-600 hover:bg-orange-700',
  },
  {
    value: 'banned',
    label: 'Ban Content',
    description: 'Permanently remove content',
    color: 'bg-red-600 hover:bg-red-700',
  },
  {
    value: 'dismissed',
    label: 'Dismiss Report',
    description: 'No action needed, dismiss report',
    color: 'bg-gray-600 hover:bg-gray-700',
  },
];

export function ReportActions({ reportId }: ReportActionsProps) {
  const router = useRouter();
  const [selectedAction, setSelectedAction] = useState<ModerationAction | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selectedAction) return;

    setLoading(true);
    setError(null);

    try {
      await takeAction(reportId, {
        action: selectedAction,
        notes: notes || undefined,
      });
      router.refresh();
      router.push('/moderation');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to take action');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Take Action</h2>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {actionOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelectedAction(option.value)}
            className={`w-full text-left p-3 rounded border-2 transition-colors ${
              selectedAction === option.value
                ? 'border-blue-500 bg-gray-700'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className="font-medium text-white">{option.label}</span>
            <span className="block text-sm text-gray-400">{option.description}</span>
          </button>
        ))}
      </div>

      <div className="mb-6">
        <label className="block text-gray-400 text-sm mb-2">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white resize-none"
          rows={3}
          placeholder="Add moderator notes..."
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!selectedAction || loading}
        className={`w-full py-3 rounded font-medium text-white transition-colors ${
          selectedAction && !loading
            ? actionOptions.find((a) => a.value === selectedAction)?.color
            : 'bg-gray-700 cursor-not-allowed'
        }`}
      >
        {loading ? 'Processing...' : selectedAction ? `Confirm: ${actionOptions.find((a) => a.value === selectedAction)?.label}` : 'Select an action'}
      </button>
    </div>
  );
}
