import { useState, useEffect, useCallback, useRef } from 'react';
import { NotificationEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';


export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'like' | 'comment' | 'subscription' | 'upload' | 'system';
  actionUrl?: string;
  timestamp: Date;
  read: boolean;
  userId: string;
}

export interface UseRealTimeNotificationsOptions {
  userId?: string;
  maxNotifications?: number;
  autoRemoveAfter?: number; // milliseconds
}

export interface UseRealTimeNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  removeNotification: (notificationId: string) => void;
  clearAll: () => void;
  isConnected: boolean;
}

export function useRealTimeNotifications(
  options: UseRealTimeNotificationsOptions = {}
): UseRealTimeNotificationsReturn {
  const { userId, maxNotifications = 50, autoRemoveAfter } = options;
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Remove specific notification
  const removeNotification = useCallback((notificationId: string) => {
    setNotifications(prevNotifications =>
      prevNotifications.filter(notification => notification.id !== notificationId)
    );
  }, []);

  // Handle real-time notification updates
  // Uses refs for callbacks to avoid re-subscription on every render
  const removeNotificationRef = useRef(removeNotification);
  const maxNotificationsRef = useRef(maxNotifications);
  const autoRemoveAfterRef = useRef(autoRemoveAfter);

  useEffect(() => {
    removeNotificationRef.current = removeNotification;
    maxNotificationsRef.current = maxNotifications;
    autoRemoveAfterRef.current = autoRemoveAfter;
  }, [removeNotification, maxNotifications, autoRemoveAfter]);

  const handleNotificationUpdate = useCallback((eventData: unknown) => {
    // Type guard to ensure eventData is NotificationEvent
    if (!eventData || typeof eventData !== 'object' || !('type' in eventData)) {
      return;
    }

    const event = eventData as NotificationEvent;
    logger.info('📥 Real-time notification:', event);

    if (event.type === 'notification') {
      const notification: Notification = {
        id: event.notificationId,
        title: event.title,
        message: event.message,
        type: event.notificationType,
        actionUrl: event.actionUrl,
        timestamp: new Date(),
        read: false,
        userId: event.userId
      };

      setNotifications(prevNotifications => {
        // Avoid duplicates
        if (prevNotifications.some(n => n.id === notification.id)) {
          return prevNotifications;
        }

        const newNotifications = [notification, ...prevNotifications];

        // Limit the number of notifications
        return newNotifications.slice(0, maxNotificationsRef.current);
      });

      // Auto-remove notification after specified time
      if (autoRemoveAfterRef.current) {
        setTimeout(() => {
          removeNotificationRef.current(notification.id);
        }, autoRemoveAfterRef.current);
      }

      // Show browser notification if supported and permission granted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.message,
          icon: '/logo.png',
          tag: notification.id
        });
      }
    }
  }, []); // Empty deps - all values accessed via refs
  
  // Subscribe to real-time notifications
  // Note: handleNotificationUpdate should NOT be in dependencies as it would cause re-subscriptions
  const isConnected = useWebSocketSubscription(
    userId ? `user:${userId}:notifications` : 'notifications',
    handleNotificationUpdate,
    [userId]
  );
  
  // Add notification manually (for testing or local notifications)
  const addNotification = useCallback((notificationData: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
      ...notificationData
    };
    
    setNotifications(prevNotifications => {
      const newNotifications = [notification, ...prevNotifications];
      return newNotifications.slice(0, maxNotifications);
    });
  }, [maxNotifications]);
  
  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prevNotifications => 
      prevNotifications.map(notification => 
        notification.id === notificationId 
          ? { ...notification, read: true }
          : notification
      )
    );
  }, []);
  
  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prevNotifications =>
      prevNotifications.map(notification => ({ ...notification, read: true }))
    );
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);
  
  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        logger.info('Notification permission:', permission);
      });
    }
  }, []);
  
  const unreadCount = notifications.filter(n => !n.read).length;
  
  return {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    isConnected
  };
}