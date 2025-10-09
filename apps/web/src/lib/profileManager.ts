import { Profile, User } from '@/interfaces';
import { ProfilesAPI } from './api';

class ProfileManager {
  private currentUserId: string | null = null;
  private profile: Profile | null = null;
  private isLoading: boolean = false;
  private listeners: Set<(profile: Profile | null, isLoading: boolean) => void> = new Set();
  private fetchPromise: Promise<void> | null = null;

  subscribe(callback: (profile: Profile | null, isLoading: boolean) => void) {
    this.listeners.add(callback);
    // Immediately call with current state
    callback(this.profile, this.isLoading);
    
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify() {
    this.listeners.forEach(callback => callback(this.profile, this.isLoading));
  }

  async loadProfile(user: User | null) {
    console.log('ProfileManager.loadProfile called with:', { 
      user: !!user, 
      userId: user?.id,
      userIdType: typeof user?.id,
      currentUserId: this.currentUserId,
      isLoading: this.isLoading,
      timestamp: new Date().toISOString()
    });

    // If no user or no user ID, clear everything
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
      this.currentUserId = null;
      this.profile = null;
      this.isLoading = false;
      this.fetchPromise = null;
      this.notify();
      return;
    }

    // If same user and already loading, wait for existing promise
    if (this.currentUserId === user.id && this.fetchPromise) {
      await this.fetchPromise;
      return;
    }

    // If same user and already loaded, do nothing
    if (this.currentUserId === user.id && this.profile && !this.isLoading) {
      return;
    }

    // New user or need to reload
    this.currentUserId = user.id;
    this.isLoading = true;
    this.notify();

    this.fetchPromise = this.performFetch(user);
    await this.fetchPromise;
    this.fetchPromise = null;
  }

  private async performFetch(user: User) {
    try {
      const profile = await ProfilesAPI.getCurrent(user.id, {
        userId: user.id,
        channelId: user.id
      });

      if (profile) {
        this.profile = profile;
      } else {
        console.log('ProfileManager: ⚠️ API returned null/undefined');
        this.profile = null;
      }
    } catch (error) {
      console.error('ProfileManager: ❌ API call failed:', error);
      this.profile = null;
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  getCurrentProfile() {
    return this.profile;
  }

  isCurrentlyLoading() {
    return this.isLoading;
  }

  // Method to refresh the current profile
  async refreshProfile() {
    if (this.currentUserId) {
      // Find a user object - we'll need to get this from the caller
      // For now, just clear and notify - the components will re-fetch
      this.profile = null;
      this.isLoading = false;
      this.notify();
    }
  }

  // Method to update profile in memory (after successful API update)
  updateProfile(newProfile: Profile) {
    this.profile = newProfile;
    this.notify();
  }
}

export const profileManager = new ProfileManager();