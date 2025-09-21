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
      console.log('ProfileManager: 🧹 Clearing profile (no valid user)');
      this.currentUserId = null;
      this.profile = null;
      this.isLoading = false;
      this.fetchPromise = null;
      this.notify();
      return;
    }

    // If same user and already loading, wait for existing promise
    if (this.currentUserId === user.id && this.fetchPromise) {
      console.log('ProfileManager: ⏳ Already loading for this user, waiting...');
      await this.fetchPromise;
      return;
    }

    // If same user and already loaded, do nothing
    if (this.currentUserId === user.id && this.profile && !this.isLoading) {
      console.log('ProfileManager: ✅ Profile already loaded for this user');
      return;
    }

    // New user or need to reload
    console.log('ProfileManager: 🚀 Starting fetch for user:', user.id);
    this.currentUserId = user.id;
    this.isLoading = true;
    this.notify();

    this.fetchPromise = this.performFetch(user);
    await this.fetchPromise;
    this.fetchPromise = null;
  }

  private async performFetch(user: User) {
    try {
      console.log('ProfileManager: 🔥 MAKING ACTUAL API CALL for user:', user.id);
      
      const profile = await ProfilesAPI.getCurrent(user.id, {
        userId: user.id,
        channelId: user.id
      });

      if (profile) {
        console.log('ProfileManager: ✅ API call successful, got profile:', profile.id);
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
      console.log('ProfileManager: Refreshing profile for current user:', this.currentUserId);
      // Find a user object - we'll need to get this from the caller
      // For now, just clear and notify - the components will re-fetch
      this.profile = null;
      this.isLoading = false;
      this.notify();
    }
  }

  // Method to update profile in memory (after successful API update)
  updateProfile(newProfile: Profile) {
    console.log('ProfileManager: Updating profile in memory');
    this.profile = newProfile;
    this.notify();
  }
}

export const profileManager = new ProfileManager();