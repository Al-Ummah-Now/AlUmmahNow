'use client';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { unsubscribeFromChannel, getUserSubscriptions } from '@/lib/api/channels';
import { Button } from '@/components/ui/button';
import { X, RefreshCw, Users } from 'lucide-react';
import Image from 'next/image';
import { resolveUrl } from '@/lib/utility';
import { Channel } from '@al-ummah/shared-types';

export const SubscriptionManagement: React.FC = () => {
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const isAuthenticated = !!user;
  const [subscriptions, setSubscriptions] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
    try {
      const headers = {
        channelId: profile.channels?.[0] || '',
      };

      const result = await unsubscribeFromChannel(channelId, headers);

      if (result?.success) {
        setSubscriptions(prev => prev.filter(sub => sub.id !== channelId));
      }
    } catch (error) {
      logger.error('Failed to unsubscribe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-6 text-center">
        <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-4">Subscription Management</h2>
        <p className="text-gray-600 dark:text-gray-400">Please log in to manage your subscriptions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Your Subscriptions</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSubscriptions}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading && subscriptions.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading subscriptions...</span>
          </div>
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            No subscriptions yet.
          </p>
          <p className="text-gray-500 dark:text-gray-500 mt-2">
            Subscribe to channels to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 relative rounded-full overflow-hidden bg-gray-200">
                  {channel.avatarUrl && (
                    <Image
                      src={resolveUrl(channel.avatarUrl)}
                      alt={channel.name}
                      fill
                      className="object-cover"
                    />
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-lg">{channel.name}</h3>
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
                className="text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Unsubscribe</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="font-semibold mb-2">Subscription Summary</h3>
        <div className="text-sm">
          <span className="text-gray-600 dark:text-gray-400">Total Subscriptions:</span>
          <span className="font-semibold ml-2">{subscriptions.length}</span>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionManagement;
