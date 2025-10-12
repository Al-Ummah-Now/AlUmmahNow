/**
 * Presence Tracking
 * Manages user online/offline status using Cloudflare KV
 */

export class PresenceManager {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Mark a user as online
   */
  async setOnline(userId: string, sessionId: string): Promise<void> {
    try {
      const key = `presence:${userId}`;
      const sessions = await this.getUserSessions(userId);
      
      // Add new session
      sessions.add(sessionId);

      // Store with TTL of 5 minutes (will be refreshed by heartbeats)
      await this.kv.put(key, JSON.stringify(Array.from(sessions)), {
        expirationTtl: 300, // 5 minutes
      });
    } catch (error) {
      console.error('Error setting user online:', error);
    }
  }

  /**
   * Mark a user session as offline
   */
  async setOffline(userId: string, sessionId: string): Promise<void> {
    try {
      const key = `presence:${userId}`;
      const sessions = await this.getUserSessions(userId);
      
      // Remove session
      sessions.delete(sessionId);

      if (sessions.size === 0) {
        // User has no active sessions, delete presence
        await this.kv.delete(key);
      } else {
        // Update with remaining sessions
        await this.kv.put(key, JSON.stringify(Array.from(sessions)), {
          expirationTtl: 300,
        });
      }
    } catch (error) {
      console.error('Error setting user offline:', error);
    }
  }

  /**
   * Check if a user is online
   */
  async isOnline(userId: string): Promise<boolean> {
    try {
      const key = `presence:${userId}`;
      const value = await this.kv.get(key);
      return value !== null;
    } catch (error) {
      console.error('Error checking user online status:', error);
      return false;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Set<string>> {
    try {
      const key = `presence:${userId}`;
      const value = await this.kv.get(key);
      
      if (value) {
        const sessions = JSON.parse(value) as string[];
        return new Set(sessions);
      }
      
      return new Set();
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return new Set();
    }
  }

  /**
   * Refresh user presence (called on heartbeat)
   */
  async refresh(userId: string, sessionId: string): Promise<void> {
    try {
      const key = `presence:${userId}`;
      const sessions = await this.getUserSessions(userId);
      
      if (sessions.has(sessionId)) {
        // Refresh TTL
        await this.kv.put(key, JSON.stringify(Array.from(sessions)), {
          expirationTtl: 300,
        });
      }
    } catch (error) {
      console.error('Error refreshing presence:', error);
    }
  }

  /**
   * Get presence status for multiple users
   */
  async getBulkPresence(userIds: string[]): Promise<Map<string, boolean>> {
    const presence = new Map<string, boolean>();
    
    try {
      await Promise.all(
        userIds.map(async (userId) => {
          const isOnline = await this.isOnline(userId);
          presence.set(userId, isOnline);
        })
      );
    } catch (error) {
      console.error('Error getting bulk presence:', error);
    }

    return presence;
  }
}
