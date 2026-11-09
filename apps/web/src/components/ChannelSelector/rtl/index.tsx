/**
 * Channel Selector Component (RTL/Arabic)
 *
 * Displays current channel and allows switching between
 * user's channels or creating new ones.
 */

'use client';

import { useState } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { Tv, Plus, Check, ChevronDown, Crown } from 'lucide-react';

export default function ChannelSelectorRTL() {
  const { t } = useLanguage();

  const {
    user,
    loading,
    error,
    switchToChannel,
    createChannel,
    creatingChannel,
    reloadChannels,
  } = useMultiAccount();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  if (loading || !user) {
    return null;
  }

  const channel = user.channel;
  const channels = user.channels;

  // Don't show selector if user has no channels or only one channel
  if (channels.length === 0) {
    return (
      <button
        onClick={() => setIsCreating(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
      >
        <Plus className="h-4 w-4" />
        {t.channel.createChannel}
      </button>
    );
  }

  if (channels.length === 1 && !isCreating) {
    return null;
  }

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || creatingChannel) return;

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
    <div className="relative" dir="rtl">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label="قائمة القنوات"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <ChevronDown className="h-4 w-4 text-gray-500 mr-auto" />
        {channel ? (
          <>
            {channel.isMain && (
              <span title="القناة الرئيسية">
                <Crown className="h-3 w-3 text-brand-ink" />
              </span>
            )}
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {channel.name}
            </span>
            <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
              {channel.name[0].toUpperCase()}
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t.channel.selectChannel}
            </span>
            <Tv className="h-4 w-4 text-gray-500" />
          </>
        )}
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
            className="absolute right-0 mt-2 w-72 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Channel List */}
            <div className="p-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                {t.channel.myChannels} ({channels.length})
              </div>

              {/* Option to work without channel */}
              <button
                onClick={() => {
                  switchToChannel(null);
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                role="menuitem"
              >
                {!channel && (
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                )}
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t.header.noChannelSelected}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    تصفح بدون قناة
                  </div>
                </div>
                <div className="h-8 w-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center">
                  <Tv className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                </div>
              </button>

              {/* User's Channels */}
              {channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    switchToChannel(ch.id);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  role="menuitem"
                >
                  {channel?.id === ch.id && (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {ch.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {ch.isMain ? t.channel.mainChannel : 'قناة'}
                    </div>
                  </div>
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
                      <Crown className="absolute -bottom-1 -left-1 h-3 w-3 text-brand-ink bg-white dark:bg-gray-900 rounded-full" />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700" />

            {/* Create Channel Section */}
            <div className="p-2">
              {!isCreating ? (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  role="menuitem"
                >
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t.channel.createChannel}
                  </span>
                  <div className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                    <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </div>
                </button>
              ) : (
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t.channel.channelName}
                  </label>
                  <input
                    type="text"
                    value={newChannelName}
                              disabled={creatingChannel}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="أدخل اسم القناة"
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
                      onClick={() => {
                        setIsCreating(false);
                        setNewChannelName('');
                      }}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      onClick={handleCreateChannel}
                      disabled={!newChannelName.trim() || creatingChannel}
                                aria-busy={creatingChannel}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                    >
                      {creatingChannel ? t.channel.creating : t.common.create}
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
                تحديث قائمة القنوات
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
