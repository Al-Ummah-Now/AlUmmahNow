'use client';

import React from 'react';
import NotificationsPage from '@/components/notifications/NotificationsPage';
import NotificationsPageRTL from '@/components/notifications/rtl/NotificationsPage';
import { useLanguage } from '@/hooks/useLanguage';

export default function NotificationsRoute() {
  const { isRTL } = useLanguage();
  return isRTL ? <NotificationsPageRTL /> : <NotificationsPage />;
}
