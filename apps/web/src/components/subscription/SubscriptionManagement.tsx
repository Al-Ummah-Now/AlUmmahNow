'use client';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { useLanguage } from '@/hooks/useLanguage';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { unsubscribeFromChannel, getUserSubscriptions } from '@/lib/api/channels';
import { Button } from '@/components/ui/button';
import { X, RefreshCw, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { resolveUrl } from '@/lib/utility';
import { Channel } from '@al-ummah/shared-types';

export const SubscriptionManagement: React.FC = () => {
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const { t, dir, lang } = useLanguage();
  const s = t.subscriptions;
  const isAuthenticated = !!user;
  const [subscriptions, setSubscriptions] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [unsubscribeError, setUnsubscribeError] = useState(false);

  const fetchSubscriptions = useCallback(async () => {
    if (!isAuthenticated || !user) return;

    setIsLoading(true);
    try {
      const response = await getUserSubscriptions({ page: 1, pageSize: 100 });
      if (response?.success && response.data) {
        setSubscriptions(response.data);
      }
    } catch (error) {
      logger.error('Failed to fetch subscriptions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleUnsubscribe = async (channelId: string) => {
    if (!user || !profile) return;

    setIsLoading(true);
    setUnsubscribeError(false);
    try {
      const headers = {
        channelId: profile.channels?.[0] || '',
      };

      const result = await unsubscribeFromChannel(channelId, headers);

      if (result?.success) {
        setSubscriptions(prev => prev.filter(sub => sub.id !== channelId));
      } else {
        setUnsubscribeError(true);
      }
    } catch (error) {
      logger.error('Failed to unsubscribe:', error);
      setUnsubscribeError(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return <SignInPrompt title={s.mySubscriptions} message={s.signInToManage} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6" dir={dir}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">{s.mySubscriptions}</h1>
          <Link href={`/${lang}/feed`} data-testid="subscriptions-feed-link" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">{t.subscriptions.subscriptionFeed}</Link>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSubscriptions}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {s.refresh}
        </Button>
      </div>

      {isLoading && subscriptions.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>{s.loadingSubscriptions}</span>
          </div>
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="text-center py-12" data-testid="subscriptions-empty">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            {s.noSubscriptions}
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {s.noSubscriptionsHint}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((channel) => (
            <div
              key={channel.id}
              data-testid="subscription-item"
              data-channel-id={channel.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-16 h-16 shrink-0 aspect-square relative rounded-full overflow-hidden bg-gray-200" data-testid="subscription-avatar">
                  {channel.avatarUrl && (
                    <Image
                      src={resolveUrl(channel.avatarUrl)}
                      alt={channel.name}
                      fill
                      className="object-cover"
                    />
                  )}
                </div>

                <div className="min-w-0">
                  <h2 className="font-semibold text-lg truncate">{channel.name}</h2>
                  {channel.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
                      {channel.description}
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUnsubscribe(channel.id)}
                disabled={isLoading}
                aria-label={s.unsubscribeFrom.replace('{name}', channel.name)}
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">{s.unsubscribe}</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      {unsubscribeError && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{s.unsubscribeFailed}</p>
      )}

      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h2 className="font-semibold mb-2">{s.summaryTitle}</h2>
        <div className="text-sm">
          <span className="text-gray-600 dark:text-gray-400">{s.totalSubscriptions}</span>
          <span className="font-semibold ms-2" data-testid="subscriptions-total">{subscriptions.length}</span>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionManagement;
