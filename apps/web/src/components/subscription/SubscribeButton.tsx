"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { subscribeToChannel, unsubscribeFromChannel } from '@/lib/api/channels';
import { Bell } from 'lucide-react';

interface SubscribeButtonProps {
  channelId: string;
  channelName: string;
  initialSubscribed?: boolean;
  subscribersCount?: number;
  className?: string;
  lang?: 'en' | 'ar';
}

export const SubscribeButton: React.FC<SubscribeButtonProps> = ({
  channelId,
  initialSubscribed = false,
  subscribersCount = 0,
  className = '',
  lang = 'en'
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
      // Redirect to login page - user context makes it clear why they're being redirected
      router.push(lang === 'ar' ? '/ar' : '/en');
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

  const isRTL = lang === 'ar';
  const texts = {
    subscribe: isRTL ? 'اشتراك' : 'Subscribe',
    subscribed: isRTL ? 'مشترك' : 'Subscribed',
    loading: isRTL ? 'جاري التحميل...' : 'Loading...',
    subscribers: isRTL ? 'مشترك' : 'subscribers'
  };

  if (!isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => router.push(lang === 'ar' ? '/ar' : '/en')}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {texts.subscribe}
      </Button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <Button
        variant={isSubscribed ? "secondary" : "default"}
        size="sm"
        className={className}
        onClick={handleSubscriptionToggle}
        disabled={isLoading}
      >
        {isLoading ? (
          texts.loading
        ) : isSubscribed ? (
          <>
            <Bell className={`w-4 h-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
            {texts.subscribed}
          </>
        ) : (
          texts.subscribe
        )}
      </Button>

      {currentSubscribersCount > 0 && (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {currentSubscribersCount.toLocaleString()} {texts.subscribers}
        </span>
      )}
    </div>
  );
};

export default SubscribeButton;