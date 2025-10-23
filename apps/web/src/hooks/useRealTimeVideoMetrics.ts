import { useState, useEffect, useCallback, useRef } from 'react';
import { LikeEvent, ViewCountEvent, PresenceEvent } from '@/interfaces/websocket';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';

export interface VideoMetrics {
  videoId: string;
  viewCount: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  liveViewers: number;
  lastUpdated: Date;
}

export interface UseRealTimeVideoMetricsOptions {
  videoId: string;
  initialMetrics?: Partial<VideoMetrics>;
  onMetricsUpdate?: (metrics: VideoMetrics) => void;
}

export interface UseRealTimeVideoMetricsReturn {
  metrics: VideoMetrics;
  isConnected: boolean;
  updateMetrics: (updates: Partial<VideoMetrics>) => void;
}

export function useRealTimeVideoMetrics(
  options: UseRealTimeVideoMetricsOptions
): UseRealTimeVideoMetricsReturn {
  const { videoId, initialMetrics = {}, onMetricsUpdate } = options;

  const [metrics, setMetrics] = useState<VideoMetrics>({
    videoId,
    viewCount: 0,
    likesCount: 0,
    dislikesCount: 0,
    commentsCount: 0,
    liveViewers: 0,
    lastUpdated: new Date(),
    ...initialMetrics
  });

  // Store callback in ref to prevent re-subscription on every render
  const onMetricsUpdateRef = useRef(onMetricsUpdate);

  useEffect(() => {
    onMetricsUpdateRef.current = onMetricsUpdate;
  }, [onMetricsUpdate]);

  // Handle real-time metrics updates
  const handleMetricsUpdate = useCallback((eventData: LikeEvent | ViewCountEvent | PresenceEvent) => {
    console.log('📥 Real-time metrics update:', eventData);
    
    setMetrics(prevMetrics => {
      let updatedMetrics = { ...prevMetrics };
      
      switch (eventData.type) {
        case 'video_liked':
        case 'video_unliked':
          const likeEvent = eventData as LikeEvent;
          updatedMetrics = {
            ...updatedMetrics,
            likesCount: likeEvent.likesCount,
            dislikesCount: likeEvent.dislikesCount,
            lastUpdated: new Date()
          };
          break;
          
        case 'view_count_updated':
          const viewEvent = eventData as ViewCountEvent;
          updatedMetrics = {
            ...updatedMetrics,
            viewCount: viewEvent.viewCount,
            lastUpdated: new Date()
          };
          break;
          
        case 'user_joined':
        case 'user_left':
        case 'presence_update':
          const presenceEvent = eventData as PresenceEvent;
          if (presenceEvent.viewerCount !== undefined) {
            updatedMetrics = {
              ...updatedMetrics,
              liveViewers: presenceEvent.viewerCount,
              lastUpdated: new Date()
            };
          }
          break;
      }
      
      // Notify parent component of metrics update
      if (onMetricsUpdateRef.current) {
        onMetricsUpdateRef.current(updatedMetrics);
      }

      return updatedMetrics;
    });
  }, []); // Empty deps - all values accessed via refs
  
  // Subscribe to real-time updates for this video
  const isConnected = useWebSocketSubscription(
    `video:${videoId}`,
    handleMetricsUpdate,
    [videoId]
  );
  
  // Update metrics manually (optimistic updates)
  const updateMetrics = useCallback((updates: Partial<VideoMetrics>) => {
    setMetrics(prevMetrics => ({
      ...prevMetrics,
      ...updates,
      lastUpdated: new Date()
    }));
  }, []);

  // Store initial metrics in ref to avoid infinite loops from object reference changes
  const initialMetricsRef = useRef(initialMetrics);

  useEffect(() => {
    initialMetricsRef.current = initialMetrics;
  }, [initialMetrics]);

  // Update metrics when videoId changes (but not when initialMetrics reference changes)
  useEffect(() => {
    setMetrics(prevMetrics => ({
      ...prevMetrics,
      ...initialMetricsRef.current,
      videoId,
      lastUpdated: new Date()
    }));
  }, [videoId]); // Only re-run when videoId changes, not initialMetrics
  
  return {
    metrics,
    isConnected,
    updateMetrics
  };
}

// Hook for tracking presence in a video/channel
export function useRealTimePresence(channelId: string) {
  const [viewers, setViewers] = useState<{ userId: string; displayName?: string }[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  
  const handlePresenceUpdate = useCallback((eventData: PresenceEvent) => {
    console.log('📥 Real-time presence update:', eventData);
    
    switch (eventData.type) {
      case 'user_joined':
        setViewers(prevViewers => {
          if (prevViewers.some(v => v.userId === eventData.userId)) {
            return prevViewers;
          }
          return [...prevViewers, {
            userId: eventData.userId,
            displayName: eventData.userDisplayName
          }];
        });
        break;
        
      case 'user_left':
        setViewers(prevViewers => 
          prevViewers.filter(viewer => viewer.userId !== eventData.userId)
        );
        break;
        
      case 'presence_update':
        if (eventData.viewerCount !== undefined) {
          setViewerCount(eventData.viewerCount);
        }
        break;
    }
  }, []);
  
  const isConnected = useWebSocketSubscription(
    `channel:${channelId}`,
    handlePresenceUpdate,
    [channelId]
  );
  
  return {
    viewers,
    viewerCount,
    isConnected
  };
}