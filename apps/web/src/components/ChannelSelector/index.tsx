/**
 * Channel Selector Component
 *
 * Displays current channel and allows switching between
 * user's channels or creating new ones.
 */

'use client';

import { useState } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { Tv, Plus, Check, ChevronDown, Crown } from 'lucide-react';

export function ChannelSelector() {
  const {
    user,
    channel,
    channels,
    loading,
    error,
    switchToChannel,
    createChannel,
    reloadChannels,
  } = useMultiAccount();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  if (loading || !user) {
    return null;
  }

  // Don't show selector if user has no channels or only one channel
  if (channels.length === 0) {
    return (
      <button
        onClick={() => setIsCreating(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
      >
        <Plus className="h-4 w-4" />
        Create Channel
      </button>
    );
  }

  if (channels.length === 1 && !isCreating) {
    return null;
  }

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;

    const created = await createChannel({
      name: newChannelName.trim(),
    });

    if (created) {
      setNewChannelName('');
      setIsCreating(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label="Channel menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {channel ? (
          <>
            <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
              {channel.name[0].toUpperCase()}
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {channel.name}
            </span>
            {channel.isMain && (
              <span title="Main Channel">
                <Crown className="h-3 w-3 text-yellow-500" />
              </span>
            )}
          </>
        ) : (
          <>
            <Tv className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Select Channel
            </span>
          </>
        )}
        <ChevronDown className="h-4 w-4 text-gray-500 ml-auto" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setIsCreating(false);
              setNewChannelName('');
            }}
            aria-hidden="true"
          />

          {/* Menu */}
          <div
            className="absolute left-0 mt-2 w-72 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Channel List */}
            <div className="p-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                YOUR CHANNELS ({channels.length})
              </div>

              {/* Option to work without channel */}
              <button
                onClick={() => {
                  switchToChannel(null);
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                role="menuitem"
              >
                <div className="h-8 w-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center">
                  <Tv className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    No Channel
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Browse without a channel
                  </div>
                </div>
                {!channel && (
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                )}
              </button>

              {/* User's Channels */}
              {channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    switchToChannel(ch.id);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  role="menuitem"
                >
                  <div className="relative">
                    {ch.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ch.avatarUrl}
                        alt={ch.name}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                        {ch.name[0].toUpperCase()}
                      </div>
                    )}
                    {ch.isMain && (
                      <Crown className="absolute -bottom-1 -right-1 h-3 w-3 text-yellow-500 bg-white dark:bg-gray-900 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {ch.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {ch.isMain ? 'Main Channel' : 'Channel'}
                    </div>
                  </div>
                  {channel?.id === ch.id && (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  )}
                </button>
              ))}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700" />

            {/* Create Channel Section */}
            <div className="p-2">
              {!isCreating ? (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  role="menuitem"
                >
                  <div className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                    <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Create New Channel
                  </span>
                </button>
              ) : (
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Channel Name
                  </label>
                  <input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="Enter channel name"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100"
                    autoFocus
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleCreateChannel();
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={handleCreateChannel}
                      disabled={!newChannelName.trim()}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => {
                        setIsCreating(false);
                        setNewChannelName('');
                      }}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Refresh Channels */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-2">
              <button
                onClick={() => {
                  reloadChannels();
                }}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 py-1"
              >
                Refresh channel list
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                <div className="p-3 bg-red-50 dark:bg-red-900/20">
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}