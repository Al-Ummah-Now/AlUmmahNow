'use client';

import { Card } from '@/components/ui/card';
import { Eye, ThumbsUp, MessageSquare, Share2, TrendingUp } from 'lucide-react';

interface PostAnalyticsProps {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  locale: string;
}

export function PostAnalytics({ views, likes, comments, shares, locale }: PostAnalyticsProps) {
  const isRTL = locale === 'ar';

  const engagementRate = views > 0
    ? ((likes + comments + shares) / views) * 100
    : 0;

  const metrics = [
    {
      label: isRTL ? 'المشاهدات' : 'Views',
      value: views.toLocaleString(isRTL ? 'ar-SA' : 'en-US'),
      icon: Eye,
      color: 'text-blue-500'
    },
    {
      label: isRTL ? 'الإعجابات' : 'Likes',
      value: likes.toLocaleString(isRTL ? 'ar-SA' : 'en-US'),
      icon: ThumbsUp,
      color: 'text-green-500'
    },
    {
      label: isRTL ? 'التعليقات' : 'Comments',
      value: comments.toLocaleString(isRTL ? 'ar-SA' : 'en-US'),
      icon: MessageSquare,
      color: 'text-orange-500'
    },
    {
      label: isRTL ? 'المشاركات' : 'Shares',
      value: shares.toLocaleString(isRTL ? 'ar-SA' : 'en-US'),
      icon: Share2,
      color: 'text-purple-500'
    }
  ];

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="
        grid
        grid-cols-2       /* Mobile: 2 columns */
        sm:grid-cols-4    /* Desktop: 4 columns */
        gap-3 md:gap-4
      ">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label} className="p-3 md:p-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${metric.color}`} />
                  <span className="text-xs md:text-sm text-muted-foreground">
                    {metric.label}
                  </span>
                </div>
                <p className="text-lg md:text-2xl font-bold">
                  {metric.value}
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-3 md:p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-xs md:text-sm text-muted-foreground">
              {isRTL ? 'معدل التفاعل' : 'Engagement Rate'}
            </span>
          </div>
          <p className="text-lg md:text-xl font-bold text-primary">
            {engagementRate.toFixed(1)}%
          </p>
        </div>
      </Card>
    </div>
  );
}
