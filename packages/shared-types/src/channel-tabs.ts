/**
 * Channel tabs configuration types
 */

/**
 * Individual tab configuration
 */
export interface ChannelTab {
  id: string; // Tab identifier (e.g., "home", "videos", "shorts", etc.)
  name: string; // Default display name
  nameLocalized?: Record<string, string>; // Multi-language names {"en": "Videos", "ar": "مرئيات"}
  icon?: string; // Optional icon identifier
  type: 'system' | 'custom'; // System tabs vs future custom tabs
  visible: boolean; // Show/hide toggle
  position: number; // Order position (0-based)
  url?: string; // For custom tabs (future)
  metadata?: Record<string, any>; // Extra config for specific tab types
}

/**
 * Channel tabs configuration
 */
export interface ChannelTabConfig {
  channelId: string; // Channel this config belongs to
  defaultTab: string; // Default tab ID when visiting channel
  tabs: ChannelTab[]; // Ordered list of tabs
  version: number; // Config version for migration support

  // Audit fields
  lastModifiedBy?: string; // User ID who last modified
  dateCreated: string;
  dateModified: string;
}

/**
 * Default tabs for new channels
 */
export const DEFAULT_CHANNEL_TABS: ChannelTab[] = [
  {
    id: 'home',
    name: 'Home',
    nameLocalized: { en: 'Home', ar: 'الرئيسية' },
    type: 'system',
    visible: true,
    position: 0
  },
  {
    id: 'videos',
    name: 'Videos',
    nameLocalized: { en: 'Videos', ar: 'المرئيات' },
    type: 'system',
    visible: true,
    position: 1
  },
  {
    id: 'shorts',
    name: 'Shorts',
    nameLocalized: { en: 'Shorts', ar: 'مقاطع قصيرة' },
    type: 'system',
    visible: true,
    position: 2
  },
  {
    id: 'live',
    name: 'Live',
    nameLocalized: { en: 'Live', ar: 'بث مباشر' },
    type: 'system',
    visible: true,
    position: 3
  },
  {
    id: 'playlists',
    name: 'Playlists',
    nameLocalized: { en: 'Playlists', ar: 'قوائم التشغيل' },
    type: 'system',
    visible: true,
    position: 4
  },
  {
    id: 'community',
    name: 'Community',
    nameLocalized: { en: 'Community', ar: 'المجتمع' },
    type: 'system',
    visible: true,
    position: 5
  },
  {
    id: 'channels',
    name: 'Channels',
    nameLocalized: { en: 'Channels', ar: 'القنوات' },
    type: 'system',
    visible: true,
    position: 6
  },
  {
    id: 'about',
    name: 'About',
    nameLocalized: { en: 'About', ar: 'حول' },
    type: 'system',
    visible: true,
    position: 7
  }
];

/**
 * Request/Response types for API
 */
export interface ChannelTabConfigUpdateRequest {
  defaultTab?: string;
  tabs?: Array<{
    id: string;
    visible?: boolean;
    position?: number;
    nameLocalized?: Record<string, string>; // Allow name customization
  }>;
}

export interface ChannelTabConfigResponse {
  success: boolean;
  config?: ChannelTabConfig;
  error?: string;
}
