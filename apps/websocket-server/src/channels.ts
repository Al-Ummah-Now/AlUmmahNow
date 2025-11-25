/**
 * Channel Management
 * Handles channel subscriptions and message routing
 */

import { SessionData } from './messages';
import { logger } from './lib/logger';

export class ChannelManager {
  // Map of channel -> Set of sessionIds subscribed to that channel
  private channels: Map<string, Set<string>> = new Map();
  
  // Map of sessionId -> SessionData
  private sessions: Map<string, SessionData> = new Map();

  /**
   * Subscribe a session to a channel
   */
  subscribe(sessionId: string, channel: string): boolean {
    try {
      // Get or create channel
      if (!this.channels.has(channel)) {
        this.channels.set(channel, new Set());
      }

      // Add session to channel
      this.channels.get(channel)!.add(sessionId);

      // Update session data
      const session = this.sessions.get(sessionId);
      if (session) {
        session.channels.add(channel);
        session.lastActivity = Date.now();
      }

      return true;
    } catch (error) {
      logger.error('Error subscribing to channel:', error);
      return false;
    }
  }

  /**
   * Unsubscribe a session from a channel
   */
  unsubscribe(sessionId: string, channel: string): boolean {
    try {
      // Remove session from channel
      const channelSessions = this.channels.get(channel);
      if (channelSessions) {
        channelSessions.delete(sessionId);

        // Clean up empty channels
        if (channelSessions.size === 0) {
          this.channels.delete(channel);
        }
      }

      // Update session data
      const session = this.sessions.get(sessionId);
      if (session) {
        session.channels.delete(channel);
        session.lastActivity = Date.now();
      }

      return true;
    } catch (error) {
      logger.error('Error unsubscribing from channel:', error);
      return false;
    }
  }

  /**
   * Get all sessions subscribed to a channel
   */
  getChannelSubscribers(channel: string): Set<string> {
    return this.channels.get(channel) || new Set();
  }

  /**
   * Add a session
   */
  addSession(sessionId: string, userId: string): void {
    this.sessions.set(sessionId, {
      userId,
      sessionId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      channels: new Set(),
    });
  }

  /**
   * Remove a session and unsubscribe from all channels
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Unsubscribe from all channels
      for (const channel of session.channels) {
        this.unsubscribe(sessionId, channel);
      }
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get session data
   */
  getSession(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): SessionData[] {
    const userSessions: SessionData[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }
    return userSessions;
  }

  /**
   * Update session activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Get channel statistics
   */
  getStats(): {
    totalChannels: number;
    totalSessions: number;
    channels: Map<string, number>;
  } {
    const channelCounts = new Map<string, number>();
    for (const [channel, sessions] of this.channels.entries()) {
      channelCounts.set(channel, sessions.size);
    }

    return {
      totalChannels: this.channels.size,
      totalSessions: this.sessions.size,
      channels: channelCounts,
    };
  }
}
