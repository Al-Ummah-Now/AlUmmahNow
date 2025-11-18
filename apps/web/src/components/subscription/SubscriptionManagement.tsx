"use client";
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { subscribeToChannel, unsubscribeFromChannel } from '@/lib/api/channels';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, X } from 'lucide-react';
import Image from 'next/image';
import { resolveUrl } from '@/lib/utility';

interface SubscriptionItem {
  id: string;
  name: string;
  avatarUrl?: string;
  subscribersCount: number;
  videosCount: number;
  notificationsEnabled: boolean;
  dateSubscribed: string;
}

export const SubscriptionManagement: React.FC = () => {
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const isAuthenticated = !!user;
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'notifications'>('all');

  useEffect(() => {
    if (isAuthenticated && user) {
      // TODO: Implement API call to fetch user subscriptions
      // const fetchSubscriptions = async () => {
      //   const response = await getUserSubscriptions(user.id);
      //   setSubscriptions(response.subscriptions);
      // };
      // fetchSubscriptions();
    }
  }, [isAuthenticated, user]);

  const toggleNotifications = async (channelId: string, currentState: boolean) => {
    if (!user || !profile) return;

    try {
      const headers = {
        channelId: profile.channels?.[0] || '',
        userId: user.id
      };

      // Resubscribe with updated notification preference
      const result = await subscribeToChannel(
        channelId,
        { notificationsEnabled: !currentState },
        headers
      );

      if (result?.success) {
        setSubscriptions(prev =>
          prev.map(sub =>
            sub.id === channelId
              ? { ...sub, notificationsEnabled: !currentState }
              : sub
          )
        );
      }
    } catch (error) {
      console.error('Failed to toggle notifications:', error);
    }
  };

  const handleUnsubscribe = async (channelId: string) => {
    if (!user || !profile) return;

    setIsLoading(true);
    try {
      const headers = {
        channelId: profile.channels?.[0] || '',
        userId: user.id
      };

      const result = await unsubscribeFromChannel(channelId, headers);

      if (result?.success) {
        setSubscriptions(prev => prev.filter(sub => sub.id !== channelId));
      }
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    if (filter === 'notifications') {
      return sub.notificationsEnabled;
    }
    return true;
  });

  if (!isAuthenticated) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-2xl font-bold mb-4">Subscription Management</h2>
        <p className="text-gray-600 dark:text-gray-400">Please log in to manage your subscriptions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Your Subscriptions</h1>
        <div className="flex gap-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All ({subscriptions.length})
          </Button>
          <Button
            variant={filter === 'notifications' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('notifications')}
          >
            Notifications ({subscriptions.filter(s => s.notificationsEnabled).length})
          </Button>
        </div>
      </div>

      {filteredSubscriptions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            {filter === 'all' ? 'No subscriptions yet.' : 'No channels with notifications enabled.'}
          </p>
          <p className="text-gray-500 dark:text-gray-500 mt-2">
            Subscribe to channels to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSubscriptions.map((subscription) => (
            <div
              key={subscription.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 relative rounded-full overflow-hidden bg-gray-200">
                  {subscription.avatarUrl && (
                    <Image
                      src={resolveUrl(subscription.avatarUrl)}
                      alt={subscription.name}
                      fill
                      className="object-cover"
                    />
                  )}
                </div>
                
                <div>
                  <h3 className="font-semibold text-lg">{subscription.name}</h3>
                  <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <span>{subscription.subscribersCount.toLocaleString()} subscribers</span>
                    <span>{subscription.videosCount} videos</span>
                    <span>Subscribed: {new Date(subscription.dateSubscribed).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleNotifications(subscription.id, subscription.notificationsEnabled)}
                  className="flex items-center gap-1"
                >
                  {subscription.notificationsEnabled ? (
                    <>
                      <Bell className="w-4 h-4" />
                      <span className="hidden sm:inline">Notifications On</span>
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4" />
                      <span className="hidden sm:inline">Notifications Off</span>
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUnsubscribe(subscription.id)}
                  disabled={isLoading}
                  className="text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Unsubscribe</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="font-semibold mb-2">Subscription Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Total Subscriptions:</span>
            <div className="font-semibold">{subscriptions.length}</div>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">With Notifications:</span>
            <div className="font-semibold">{subscriptions.filter(s => s.notificationsEnabled).length}</div>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Total Videos Available:</span>
            <div className="font-semibold">{subscriptions.reduce((sum, sub) => sum + sub.videosCount, 0)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionManagement;