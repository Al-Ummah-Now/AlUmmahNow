import { 
  WebSocketConfig, 
  WebSocketConnectionState, 
  WebSocketMessage, 
  WebSocketSubscription,
  WebSocketEventType 
} from '@/interfaces/websocket';

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private state: WebSocketConnectionState;
  private subscriptions: Map<string, WebSocketSubscription[]> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(config: WebSocketConfig) {
    this.config = {
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      ...config
    };
    
    this.state = {
      status: 'disconnected',
      reconnectAttempts: 0,
      maxReconnectAttempts: this.config.maxReconnectAttempts
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(userId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state.status === 'connected' || this.state.status === 'connecting') {
        resolve();
        return;
      }

      this.state.status = 'connecting';
      
      try {
        // Build WebSocket URL with authentication if available
        let wsUrl = this.config.url;
        const params = new URLSearchParams();
        
        if (userId || this.config.userId) {
          params.append('userId', userId || this.config.userId!);
        }
        
        if (this.config.authToken) {
          params.append('token', this.config.authToken);
        }
        
        if (params.toString()) {
          wsUrl += `?${params.toString()}`;
        }

        console.log('🔌 Connecting to WebSocket:', wsUrl.replace(/token=[^&]+/, 'token=***'));
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
          this.state.status = 'connected';
          this.state.lastConnected = new Date();
          this.state.reconnectAttempts = 0;
          
          this.startHeartbeat();
          this.flushMessageQueue();
          this.notifyStateChange();
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket closed:', event.code, event.reason);
          this.state.status = 'disconnected';
          this.stopHeartbeat();
          this.notifyStateChange();
          
          if (!event.wasClean && this.state.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          this.state.status = 'error';
          this.notifyStateChange();
          reject(error);
        };

      } catch (error) {
        this.state.status = 'error';
        this.notifyStateChange();
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopHeartbeat();
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    this.ws = null;
    this.state.status = 'disconnected';
    this.notifyStateChange();
  }

  /**
   * Subscribe to a channel for real-time updates
   */
  subscribe(channel: string, callback: (data: any) => void): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, []);
    }
    
    const subscription: WebSocketSubscription = { channel, callback };
    this.subscriptions.get(channel)!.push(subscription);
    
    // Send subscription message if connected
    if (this.state.status === 'connected') {
      this.sendMessage('subscribe', { channel });
    }
    
    console.log(`📡 Subscribed to channel: ${channel}`);
    
    // Return unsubscribe function
    return () => {
      const channelSubs = this.subscriptions.get(channel);
      if (channelSubs) {
        const index = channelSubs.findIndex(sub => sub === subscription);
        if (index !== -1) {
          channelSubs.splice(index, 1);
          console.log(`📡 Unsubscribed from channel: ${channel}`);
          
          if (channelSubs.length === 0) {
            this.subscriptions.delete(channel);
            if (this.state.status === 'connected') {
              this.sendMessage('unsubscribe', { channel });
            }
          }
        }
      }
    };
  }

  /**
   * Send a message to the WebSocket server
   */
  sendMessage(type: WebSocketEventType, data: any): void {
    const message: WebSocketMessage = {
      id: this.generateMessageId(),
      type,
      timestamp: Date.now(),
      data
    };

    if (this.state.status === 'connected' && this.ws) {
      try {
        this.ws.send(JSON.stringify(message));
        console.log('📤 Sent message:', type, data);
      } catch (error) {
        console.error('❌ Error sending message:', error);
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
      console.log('📤 Message queued:', type, data);
    }
  }

  /**
   * Add event listener for connection state changes
   */
  onStateChange(callback: (state: WebSocketConnectionState) => void): () => void {
    const listeners = this.eventListeners.get('stateChange') || new Set();
    listeners.add(callback);
    this.eventListeners.set('stateChange', listeners);
    
    return () => {
      listeners.delete(callback);
    };
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketConnectionState {
    return { ...this.state };
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  private handleMessage(message: WebSocketMessage): void {
    console.log('📥 Received message:', message.type, message.data);
    
    // Handle connection acknowledgment
    if (message.type === 'connection_acknowledged') {
      console.log('✅ Connection acknowledged by server');
      return;
    }
    
    // Handle heartbeat
    if (message.type === 'heartbeat') {
      this.sendMessage('heartbeat', { timestamp: Date.now() });
      return;
    }
    
    // Route message to appropriate subscribers
    const channelKey = this.getChannelKeyFromMessage(message);
    if (channelKey) {
      const subscribers = this.subscriptions.get(channelKey);
      if (subscribers) {
        subscribers.forEach(sub => {
          try {
            sub.callback(message.data);
          } catch (error) {
            console.error('❌ Error in subscription callback:', error);
          }
        });
      }
    }
    
    // Broadcast to all subscribers for certain message types
    if (['notification', 'presence_update'].includes(message.type)) {
      this.subscriptions.forEach(subscribers => {
        subscribers.forEach(sub => {
          try {
            sub.callback(message.data);
          } catch (error) {
            console.error('❌ Error in broadcast callback:', error);
          }
        });
      });
    }
  }

  private getChannelKeyFromMessage(message: WebSocketMessage): string | null {
    const { type, data } = message;
    
    switch (type) {
      case 'comment_added':
      case 'comment_updated':
      case 'comment_deleted':
      case 'video_liked':
      case 'video_unliked':
      case 'view_count_updated':
        return data.videoId ? `video:${data.videoId}` : null;
      case 'user_joined':
      case 'user_left':
        return data.channelId ? `channel:${data.channelId}` : null;
      default:
        return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    
    this.state.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.state.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );
    
    console.log(`🔄 Scheduling reconnect attempt ${this.state.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(error => {
        console.error('❌ Reconnect failed:', error);
        if (this.state.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.state.status === 'connected') {
        this.sendMessage('heartbeat', { timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.ws) {
        try {
          this.ws.send(JSON.stringify(message));
          console.log('📤 Sent queued message:', message.type, message.data);
        } catch (error) {
          console.error('❌ Error sending queued message:', error);
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }

  private notifyStateChange(): void {
    const listeners = this.eventListeners.get('stateChange');
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(this.state);
        } catch (error) {
          console.error('❌ Error in state change callback:', error);
        }
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}