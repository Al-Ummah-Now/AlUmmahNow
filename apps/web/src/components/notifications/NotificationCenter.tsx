'use client';

import React, { useEffect, useState } from 'react';
import { useRealTimeNotifications, Notification } from '@/hooks/useRealTimeNotifications';
import { User } from '@/interfaces';
import { X, Bell, Heart, MessageCircle, UserPlus, Video, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NotificationToastProps {
  notification: Notification;
  onClose: (id: string) => void;
  onAction?: (notification: Notification) => void;
}

function NotificationToast({ notification, onClose, onAction }: NotificationToastProps) {
  const [_isVisible, _setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Auto-close after 5 seconds
    const timer = setTimeout(() => {
      handleClose();
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(notification.id);
    }, 300); // Match animation duration
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'like':
        return <Heart className="w-5 h-5 text-red-500" />;
      case 'comment':
        return <MessageCircle className="w-5 h-5 text-blue-500" />;
      case 'subscription':
        return <UserPlus className="w-5 h-5 text-green-500" />;
      case 'upload':
        return <Video className="w-5 h-5 text-purple-500" />;
      case 'system':
        return <AlertCircle className="w-5 h-5 text-orange-500" />;
      default:
        return <Bell className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div
      className={`
        fixed top-4 right-4 z-50 bg-white dark:bg-gray-800 
        border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg 
        p-4 min-w-[320px] max-w-[400px]
        transform transition-all duration-300 ease-in-out
        ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>
        
        <div className="flex-1">
          <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {notification.title}
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {notification.message}
          </p>
          
          {notification.actionUrl && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onAction?.(notification)}
            >
              View
            </Button>
          )}
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          className="flex-shrink-0 h-auto p-1"
          onClick={handleClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="text-xs text-gray-400 mt-2">
        {notification.timestamp.toLocaleTimeString()}
      </div>
    </div>
  );
}

interface NotificationCenterProps {
  user?: User | null;
}

export function NotificationCenter({ user }: NotificationCenterProps) {
  const {
    notifications,
    unreadCount,
    markAsRead,
    removeNotification: _removeNotification,
    isConnected
  } = useRealTimeNotifications({
    userId: user?.id,
    maxNotifications: 10,
    autoRemoveAfter: 10000 // 10 seconds
  });

  const [visibleToasts, setVisibleToasts] = useState<string[]>([]);

  // Show toasts for new unread notifications
  useEffect(() => {
    const newUnreadNotifications = notifications
      .filter(n => !n.read && !visibleToasts.includes(n.id))
      .slice(0, 3); // Limit to 3 simultaneous toasts

    if (newUnreadNotifications.length > 0) {
      const newToastIds = newUnreadNotifications.map(n => n.id);
      setVisibleToasts(prev => [...prev, ...newToastIds]);
    }
  }, [notifications, visibleToasts]);

  const handleCloseToast = (notificationId: string) => {
    setVisibleToasts(prev => prev.filter(id => id !== notificationId));
    markAsRead(notificationId);
  };

  const handleNotificationAction = (notification: Notification) => {
    if (notification.actionUrl) {
      // Navigate to the action URL
      window.location.href = notification.actionUrl;
    }
    handleCloseToast(notification.id);
  };

  return (
    <>
      {/* Connection status indicator */}
      {process.env.NODE_ENV === 'development' && (
        <div className={`fixed top-2 right-2 z-40 text-xs px-2 py-1 rounded ${
          isConnected ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {isConnected ? '🟢 Live' : '🔴 Offline'}
        </div>
      )}

      {/* Notification badge (for header integration) */}
      {unreadCount > 0 && (
        <div className="fixed top-4 left-4 z-40">
          <div className="flex items-center gap-2 bg-blue-500 text-white px-3 py-1 rounded-full text-sm">
            <Bell className="w-4 h-4" />
            <span>{unreadCount} new</span>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {notifications
          .filter(n => visibleToasts.includes(n.id))
          .slice(0, 3) // Only show 3 toasts at a time
          .map((notification, index) => (
            <div
              key={notification.id}
              style={{ 
                transform: `translateY(${index * 10}px)`,
                zIndex: 50 - index
              }}
            >
              <NotificationToast
                notification={notification}
                onClose={handleCloseToast}
                onAction={handleNotificationAction}
              />
            </div>
          ))}
      </div>
    </>
  );
}