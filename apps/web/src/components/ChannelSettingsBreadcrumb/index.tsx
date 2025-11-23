'use client';

import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';
import { ChevronRight, Home, Settings, FileEdit, Video, LayoutGrid, Users, Layers } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

interface ChannelSettingsBreadcrumbProps {
  channelId: string;
  channelName: string;
  locale: string;
  currentPage: 'overview' | 'edit' | 'videos' | 'tabs' | 'sections' | 'community';
  className?: string;
}

export default function ChannelSettingsBreadcrumb({
  channelId,
  channelName,
  locale,
  currentPage,
  className = '',
}: ChannelSettingsBreadcrumbProps) {
  const { t, isRTL } = useLanguage();

  const pageIcons = {
    overview: <Settings className="w-4 h-4" />,
    edit: <FileEdit className="w-4 h-4" />,
    videos: <Video className="w-4 h-4" />,
    tabs: <Layers className="w-4 h-4" />,
    sections: <LayoutGrid className="w-4 h-4" />,
    community: <Users className="w-4 h-4" />,
  };

  const pageLabels = {
    overview: t.channel.channelSettings,
    edit: t.channel.editChannel,
    videos: t.video.videoManagement,
    tabs: t.channel.tabs?.manage_tabs || 'Manage Tabs',
    sections: t.channel.manageSections || 'Manage Sections',
    community: t.channel.communitySettings || 'Community',
  };

  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: channelName,
      href: `/${locale}/channels/${channelId}`,
      icon: <Home className="w-4 h-4" />,
    },
    {
      label: t.channel.channelSettings,
      href: currentPage === 'overview' ? undefined : `/${locale}/settings/channel/${channelId}`,
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  if (currentPage !== 'overview') {
    breadcrumbs.push({
      label: pageLabels[currentPage] || '',
      icon: pageIcons[currentPage],
    });
  }

  const Separator = () => (
    <ChevronRight
      className={`w-4 h-4 text-gray-400 dark:text-gray-600 mx-2 ${isRTL ? 'rotate-180' : ''}`}
    />
  );

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center text-sm ${isRTL ? 'flex-row-reverse' : ''} ${className}`}
    >
      <ol className={`flex items-center ${isRTL ? 'flex-row-reverse' : ''}`}>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;

          return (
            <li key={index} className={`flex items-center ${isRTL ? 'flex-row-reverse' : ''}`}>
              {index > 0 && <Separator />}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                >
                  {crumb.icon}
                  <span>{crumb.label}</span>
                </Link>
              ) : (
                <span
                  className={`flex items-center gap-1.5 ${
                    isLast
                      ? 'text-gray-900 dark:text-white font-medium'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {crumb.icon}
                  <span>{crumb.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
