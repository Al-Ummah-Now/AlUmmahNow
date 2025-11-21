/**
 * Upload Defaults / Templates Types
 * Shared types for template-based upload defaults system
 */

import { Timestamps } from './common';

/**
 * Video categories specific to Islamic content
 */
export enum VideoCategory {
  QURAN_RECITATION = 'quran_recitation',
  QURAN_TAFSIR = 'quran_tafsir',
  HADITH_STUDIES = 'hadith_studies',
  ISLAMIC_HISTORY = 'islamic_history',
  FIQH = 'fiqh',
  AQEEDAH = 'aqeedah',
  DAWAH = 'dawah',
  KHUTBAH = 'khutbah',
  ISLAMIC_LECTURES = 'islamic_lectures',
  ISLAMIC_NASHEED = 'islamic_nasheed',
  ISLAMIC_KIDS = 'islamic_kids',
  ISLAMIC_NEWS = 'islamic_news',
  HAJJ_UMRAH = 'hajj_umrah',
  RAMADAN = 'ramadan',
  ISLAMIC_LIFESTYLE = 'islamic_lifestyle',
}

/**
 * Comment moderation settings
 */
export type CommentModeration = 'all' | 'none' | 'hold_all' | 'hold_inappropriate';

/**
 * Video visibility options
 */
export type VideoVisibility = 'public' | 'private' | 'unlisted';

/**
 * Video license types
 */
export type VideoLicense = 'standard' | 'creative_commons';

/**
 * Comment settings for templates
 */
export interface CommentSettings {
  enabled: boolean;
  moderation?: CommentModeration;
}

/**
 * Location data for videos
 */
export interface LocationData {
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
}

/**
 * Scheduled publishing defaults
 */
export interface ScheduleDefaults {
  publishTime?: string;  // Default time of day (e.g., "14:00")
  timezone?: string;     // User's timezone
  premiereEnabled?: boolean;
}

/**
 * Localized text container
 */
export interface LocalizedText {
  en: string;
  ar: string;
}

/**
 * Template fields that can be pre-filled
 */
export interface TemplateFields {
  // Title template with variables
  title?: string;
  titleLocalized?: LocalizedText;

  // Description template
  description?: string;
  descriptionLocalized?: LocalizedText;

  // Tags (array of strings)
  tags?: string[];

  // Category (from predefined list)
  category?: VideoCategory;

  // Visibility
  visibility?: VideoVisibility;

  // Language
  language?: 'en' | 'ar' | 'ur' | 'fr';

  // Comment settings
  commentSettings?: CommentSettings;

  // Age restriction
  ageRestricted?: boolean;
  madeForKids?: boolean;

  // Location (future)
  location?: LocationData;

  // Advanced settings
  license?: VideoLicense;
  recordingDate?: string;
  paidPromotion?: boolean;

  // Scheduled publishing defaults
  scheduleDefaults?: ScheduleDefaults;
}

/**
 * Main upload template object
 */
export interface UploadTemplate extends Timestamps {
  id: string;                    // UUID
  userId: string;                 // Owner's user ID
  channelId?: string;            // Optional channel-specific template
  name: string;                  // Template name
  nameLocalized?: LocalizedText; // Localized template names
  description?: string;          // Template description
  isDefault: boolean;            // Is this the default template?
  isActive: boolean;             // Is template active/enabled?

  // Template Fields
  template: TemplateFields;

  // Metadata
  createdAt: string;            // ISO 8601 (from Timestamps)
  updatedAt: string;            // ISO 8601 (from Timestamps)
  usageCount: number;           // Times this template has been used
  lastUsedAt?: string;          // ISO 8601
}

/**
 * Request to create a new template
 */
export interface CreateTemplateRequest {
  name: string;
  nameLocalized?: LocalizedText;
  description?: string;
  channelId?: string;
  isDefault?: boolean;
  template: Partial<TemplateFields>;
}

/**
 * Request to update an existing template
 */
export interface UpdateTemplateRequest {
  name?: string;
  nameLocalized?: LocalizedText;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  template?: Partial<TemplateFields>;
}

/**
 * Response when listing templates
 */
export interface TemplateListResponse {
  templates: UploadTemplate[];
  defaultTemplateId?: string;
  cursor?: string;
}

/**
 * Category definition with labels
 */
export interface CategoryDefinition {
  value: VideoCategory;
  label: LocalizedText;
  description?: LocalizedText;
}

/**
 * Predefined category definitions
 */
export const VIDEO_CATEGORIES: CategoryDefinition[] = [
  {
    value: VideoCategory.QURAN_RECITATION,
    label: { en: 'Quran Recitation', ar: 'تلاوة القرآن' },
  },
  {
    value: VideoCategory.QURAN_TAFSIR,
    label: { en: 'Quran Tafsir', ar: 'تفسير القرآن' },
  },
  {
    value: VideoCategory.HADITH_STUDIES,
    label: { en: 'Hadith Studies', ar: 'دراسات الحديث' },
  },
  {
    value: VideoCategory.ISLAMIC_HISTORY,
    label: { en: 'Islamic History', ar: 'التاريخ الإسلامي' },
  },
  {
    value: VideoCategory.FIQH,
    label: { en: 'Fiqh', ar: 'الفقه' },
  },
  {
    value: VideoCategory.AQEEDAH,
    label: { en: 'Aqeedah', ar: 'العقيدة' },
  },
  {
    value: VideoCategory.DAWAH,
    label: { en: 'Dawah', ar: 'الدعوة' },
  },
  {
    value: VideoCategory.KHUTBAH,
    label: { en: 'Friday Sermon', ar: 'خطبة الجمعة' },
  },
  {
    value: VideoCategory.ISLAMIC_LECTURES,
    label: { en: 'Islamic Lectures', ar: 'محاضرات إسلامية' },
  },
  {
    value: VideoCategory.ISLAMIC_NASHEED,
    label: { en: 'Islamic Nasheed', ar: 'الأناشيد الإسلامية' },
  },
  {
    value: VideoCategory.ISLAMIC_KIDS,
    label: { en: 'Islamic Kids Content', ar: 'محتوى إسلامي للأطفال' },
  },
  {
    value: VideoCategory.ISLAMIC_NEWS,
    label: { en: 'Islamic News', ar: 'أخبار إسلامية' },
  },
  {
    value: VideoCategory.HAJJ_UMRAH,
    label: { en: 'Hajj & Umrah', ar: 'الحج والعمرة' },
  },
  {
    value: VideoCategory.RAMADAN,
    label: { en: 'Ramadan', ar: 'رمضان' },
  },
  {
    value: VideoCategory.ISLAMIC_LIFESTYLE,
    label: { en: 'Islamic Lifestyle', ar: 'نمط الحياة الإسلامي' },
  },
];
