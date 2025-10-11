"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { ChannelsAPI } from '@/lib/api/channels';
import { Bell } from 'lucide-react';

interface SubscribeButtonProps {
  channelId: string;
  channelName: string;
  initialSubscribed?: boolean;
  subscribersCount?: number;
  className?: string;
}

export const SubscribeButton: React.FC<SubscribeButtonProps> = ({
  channelId,
  initialSubscribed = false,
  subscribersCount = 0,
  className = ''
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const isAuthenticated = !!user;
  const [isSubscribed, setIsSubscribed] = useState(initialSubscribed);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSubscribersCount, setCurrentSubscribersCount] = useState(subscribersCount);

  // Check subscription status on mount
  useEffect(() => {
    setIsSubscribed(initialSubscribed);
  }, [initialSubscribed]);

  const handleSubscriptionToggle = async () => {
    if (!isAuthenticated || !user || !profile) {
      // Redirect to login page
      alert('Please log in to subscribe to channels');
      router.push('/en');
      return;
    }

    setIsLoading(true);
    
    try {
      const headers = {
        channelId: profile.channels?.[0] || '',
        userId: user.id
      };

      if (isSubscribed) {
        // Unsubscribe
        const result = await ChannelsAPI.unsubscribe(channelId, headers);
        if (result?.success) {
          setIsSubscribed(false);
          setCurrentSubscribersCount(prev => Math.max(0, prev - 1));
        }
      } else {
        // Subscribe with notifications enabled by default
        const result = await ChannelsAPI.subscribe(
          channelId,
          { notificationsEnabled: true },
          headers
        );
        if (result?.success) {
          setIsSubscribed(true);
          setCurrentSubscribersCount(prev => prev + 1);
        }
      }
    } catch (error) {
      console.error('Subscription toggle failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => {
          alert('Please log in to subscribe to channels');
          router.push('/en');
        }}
      >
        Subscribe
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={isSubscribed ? "secondary" : "default"}
        size="sm"
        className={className}
        onClick={handleSubscriptionToggle}
        disabled={isLoading}
      >
        {isLoading ? (
          "Loading..."
        ) : isSubscribed ? (
          <>
            <Bell className="w-4 h-4 mr-1" />
            Subscribed
          </>
        ) : (
          "Subscribe"
        )}
      </Button>
      
      {currentSubscribersCount > 0 && (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {currentSubscribersCount.toLocaleString()} subscribers
        </span>
      )}
    </div>
  );
};

export default SubscribeButton;