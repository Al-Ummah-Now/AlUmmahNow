import { useState, useEffect, useCallback, useRef } from 'react';
import { NotificationEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveNotificationText } from '@/lib/websocket/notification-text';


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
  /** Ask for browser notification permission; call from a user gesture */
  requestBrowserPermission: () => Promise<NotificationPermission | null>;
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
  const {  maxNotifications = 50, autoRemoveAfter } = options;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { t, lang } = useLanguage();
  const translationsRef = useRef(t);
  const langRef = useRef(lang);
  useEffect(() => {
    translationsRef.current = t;
    langRef.current = lang;
  }, [t, lang]);

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
  // Track pending auto-remove timers so they can be cleared on unmount (prevents
  // leaked timers keeping the event loop alive and setState-after-unmount warnings)
  const autoRemoveTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    removeNotificationRef.current = removeNotification;
    maxNotificationsRef.current = maxNotifications;
    autoRemoveAfterRef.current = autoRemoveAfter;
  }, [removeNotification, maxNotifications, autoRemoveAfter]);

  // Clear any pending auto-remove timers on unmount
  useEffect(() => {
    const timers = autoRemoveTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const handleNotificationUpdate = useCallback((eventData: unknown) => {
    // Type guard to ensure eventData is NotificationEvent
    if (!eventData || typeof eventData !== 'object' || !('type' in eventData)) {
      return;
    }

    const event = eventData as NotificationEvent;
    logger.debug('📥 Real-time notification:', event);

    if (event.type === 'notification') {
      const { title, message } = resolveNotificationText(event, translationsRef.current, langRef.current);
      const notification: Notification = {
        id: event.notificationId,
        title,
        message,
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
        const timerId = setTimeout(() => {
          autoRemoveTimersRef.current.delete(timerId);
          removeNotificationRef.current(notification.id);
        }, autoRemoveAfterRef.current);
        autoRemoveTimersRef.current.add(timerId);
      }

      // Show browser notification if supported and permission granted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.message,
          icon: '/icon-192.png',
          tag: notification.id
        });
      }
    }
  }, []); // Empty deps - all values accessed via refs
  
  // Subscribe to real-time notifications
  // Note: handleNotificationUpdate should NOT be in dependencies as it would cause re-subscriptions
  const isConnected = useWebSocketSubscription(
    // The websocket server auto-subscribes every authenticated session to `user:<id>`
    options.userId ? `user:${options.userId}` : 'notifications',
    handleNotificationUpdate,
    [options.userId]
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

    // Local notifications honour autoRemoveAfter just like server-pushed ones
    if (autoRemoveAfterRef.current) {
      const timerId = setTimeout(() => {
        autoRemoveTimersRef.current.delete(timerId);
        removeNotificationRef.current(notification.id);
      }, autoRemoveAfterRef.current);
      autoRemoveTimersRef.current.add(timerId);
    }
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
  
  // Browser notification permission must be requested from a user gesture:
  // Firefox throws when it is requested on page load, and Chrome suppresses
  // such prompts. Call this from a click (e.g. a notifications setting).
  const requestBrowserPermission = useCallback(async (): Promise<NotificationPermission | null> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return null;
    if (Notification.permission !== 'default') return Notification.permission;
    const permission = await Notification.requestPermission();
    logger.debug('Notification permission:', permission);
    return permission;
  }, []);
  
  const unreadCount = notifications.filter(n => !n.read).length;
  
  return {
    notifications,
    unreadCount,
    requestBrowserPermission,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    isConnected
  };
}