"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { useLanguage } from '@/hooks/useLanguage';
import { subscribeToChannel, unsubscribeFromChannel } from '@/lib/api/channels';
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
  className = '',
}) => {
  const router = useRouter();
  const { t, lang, dir } = useLanguage();
  const locale = lang;
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
      // Redirect to login page - user context makes it clear why they're being redirected
      router.push(locale === 'ar' ? '/ar' : '/en');
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
        const result = await unsubscribeFromChannel(channelId, headers);
        if (result?.success) {
          setIsSubscribed(false);
          setCurrentSubscribersCount(prev => Math.max(0, prev - 1));
        }
      } else {
        // Subscribe with notifications enabled by default
        const result = await subscribeToChannel(
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
        type="button"
        variant="outline"
        className={`cursor-pointer px-4 py-2 ${className}`}
        onClick={() => router.push(locale === 'ar' ? '/ar' : '/en')}
        dir={dir}
        aria-label={t.channel.subscribe}
      >
        {t.channel.subscribe}
      </Button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${locale === 'ar' ? 'flex-row-reverse' : ''}`} dir={dir}>
      <Button
        type="button"
        variant={isSubscribed ? "secondary" : "default"}
        className={`cursor-pointer px-4 py-2 ${className}`}
        onClick={handleSubscriptionToggle}
        disabled={isLoading}
        aria-label={isSubscribed ? t.channel.subscribed : t.channel.subscribe}
      >
        {isLoading ? (
          t.common.loading
        ) : isSubscribed ? (
          <>
            <Bell className={`w-4 h-4 ${locale === 'ar' ? 'ml-1' : 'mr-1'}`} />
            {t.channel.subscribed}
          </>
        ) : (
          t.channel.subscribe
        )}
      </Button>

      {currentSubscribersCount > 0 && (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {currentSubscribersCount.toLocaleString()} {t.channel.subscribers}
        </span>
      )}
    </div>
  );
};

export default SubscribeButton;
