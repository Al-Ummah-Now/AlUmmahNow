/**
 * Template Variable Processing (Client-Side)
 *
 * Utilities for processing template variables in upload defaults.
 * This file contains synchronous, client-side functions.
 */

import { UploadTemplate, VideoCategory } from '@al-ummah/shared-types';

/**
 * Context for processing template variables
 */
export interface VariableContext {
  channelName?: string;
  uploaderName?: string;
  videoTitle?: string;
  videoDuration?: string;
  uploadDate?: string;
  // User-provided values for prompts
  episode?: string;
  season?: string;
  part?: string;
  seriesName?: string;
  surah?: string;
  ayah?: string;
  juz?: string;
}

/**
 * Processed video metadata from template
 */
export interface ProcessedMetadata {
  title: string;
  titleLocalized?: { en?: string; ar?: string };
  description?: string;
  descriptionLocalized?: { en?: string; ar?: string };
  tags?: string[];
  category?: VideoCategory;
  visibility?: 'public' | 'private' | 'unlisted';
  language?: 'en' | 'ar' | 'ur' | 'fr';
}

/**
 * Process template variables and return video metadata
 */
export function processTemplateVariables(
  template: UploadTemplate,
  context: VariableContext
): ProcessedMetadata {
  const now = new Date();

  // Variable replacement map
  const variables: Record<string, string> = {
    // Date/Time
    '{{date}}': now.toLocaleDateString(),
    '{{time}}': now.toLocaleTimeString(),
    '{{datetime}}': now.toLocaleString(),
    '{{year}}': now.getFullYear().toString(),
    '{{month}}': (now.getMonth() + 1).toString().padStart(2, '0'),
    '{{day}}': now.getDate().toString().padStart(2, '0'),
    '{{weekday}}': now.toLocaleDateString('en-US', { weekday: 'long' }),

    // Islamic dates (approximate - should use Hijri calendar library in production)
    '{{hijri_date}}': getHijriDate(now),
    '{{hijri_year}}': getHijriYear(now).toString(),
    '{{hijri_month}}': getHijriMonth(now),
    '{{islamic_month}}': getIslamicMonth(now),

    // Episode/Series
    '{{episode}}': context.episode || '',
    '{{season}}': context.season || '',
    '{{series_name}}': context.seriesName || '',
    '{{part}}': context.part || '',

    // Quran
    '{{surah}}': context.surah || '',
    '{{ayah}}': context.ayah || '',
    '{{juz}}': context.juz || '',

    // Channel
    '{{channel_name}}': context.channelName || '',
    '{{uploader_name}}': context.uploaderName || '',

    // Video
    '{{video_title}}': context.videoTitle || '',
    '{{video_duration}}': context.videoDuration || '',
    '{{upload_date}}': context.uploadDate || now.toLocaleDateString(),
  };

  // Replace variables in text
  const replaceVariables = (text: string | undefined): string => {
    if (!text) return '';
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    });
    return result;
  };

  // Process template fields
  return {
    title: replaceVariables(template.template.title),
    titleLocalized: template.template.titleLocalized
      ? {
          en: replaceVariables(template.template.titleLocalized.en),
          ar: replaceVariables(template.template.titleLocalized.ar),
        }
      : undefined,
    description: replaceVariables(template.template.description),
    descriptionLocalized: template.template.descriptionLocalized
      ? {
          en: replaceVariables(template.template.descriptionLocalized.en),
          ar: replaceVariables(template.template.descriptionLocalized.ar),
        }
      : undefined,
    tags: template.template.tags,
    category: template.template.category,
    visibility: template.template.visibility,
    language: template.template.language,
  };
}

/**
 * Get Hijri date (simplified - use proper Hijri calendar library in production)
 */
function getHijriDate(date: Date): string {
  // Simplified approximation - offset by ~622 years
  const hijriYear = date.getFullYear() - 579;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${day}/${month}/${hijriYear}`;
}

/**
 * Get Hijri year (simplified)
 */
function getHijriYear(date: Date): number {
  return date.getFullYear() - 579;
}

/**
 * Get Hijri month name (simplified)
 */
function getHijriMonth(date: Date): string {
  const months = [
    'Muharram',
    'Safar',
    'Rabi al-Awwal',
    'Rabi al-Thani',
    'Jumada al-Awwal',
    'Jumada al-Thani',
    'Rajab',
    'Shaban',
    'Ramadan',
    'Shawwal',
    'Dhul-Qadah',
    'Dhul-Hijjah',
  ];
  return months[date.getMonth()];
}

/**
 * Get Islamic month name (same as Hijri month)
 */
function getIslamicMonth(date: Date): string {
  return getHijriMonth(date);
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
  name: string;
  variable: string;
  description: string;
  example: string;
  category: 'datetime' | 'islamic' | 'episode' | 'quran' | 'channel' | 'video';
  requiresInput?: boolean;
}

/**
 * All available template variables
 */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // Date/Time
  { name: 'Date', variable: '{{date}}', description: 'Current date', example: '11/20/2025', category: 'datetime' },
  { name: 'Time', variable: '{{time}}', description: 'Current time', example: '2:30 PM', category: 'datetime' },
  { name: 'Date & Time', variable: '{{datetime}}', description: 'Current date and time', example: '11/20/2025 2:30 PM', category: 'datetime' },
  { name: 'Year', variable: '{{year}}', description: 'Current year', example: '2025', category: 'datetime' },
  { name: 'Month', variable: '{{month}}', description: 'Current month (number)', example: '11', category: 'datetime' },
  { name: 'Day', variable: '{{day}}', description: 'Current day', example: '20', category: 'datetime' },
  { name: 'Weekday', variable: '{{weekday}}', description: 'Day of week', example: 'Wednesday', category: 'datetime' },

  // Islamic
  { name: 'Hijri Date', variable: '{{hijri_date}}', description: 'Current Hijri date', example: '7/5/1447', category: 'islamic' },
  { name: 'Hijri Year', variable: '{{hijri_year}}', description: 'Current Hijri year', example: '1447', category: 'islamic' },
  { name: 'Hijri Month', variable: '{{hijri_month}}', description: 'Current Hijri month name', example: 'Ramadan', category: 'islamic' },
  { name: 'Islamic Month', variable: '{{islamic_month}}', description: 'Current Islamic month name', example: 'Ramadan', category: 'islamic' },

  // Episode/Series
  { name: 'Episode', variable: '{{episode}}', description: 'Episode number', example: '12', category: 'episode', requiresInput: true },
  { name: 'Season', variable: '{{season}}', description: 'Season number', example: '2', category: 'episode', requiresInput: true },
  { name: 'Series Name', variable: '{{series_name}}', description: 'Name of the series', example: 'Islamic History', category: 'episode', requiresInput: true },
  { name: 'Part', variable: '{{part}}', description: 'Part number', example: '3', category: 'episode', requiresInput: true },

  // Quran
  { name: 'Surah', variable: '{{surah}}', description: 'Surah name or number', example: 'Al-Fatiha', category: 'quran', requiresInput: true },
  { name: 'Ayah', variable: '{{ayah}}', description: 'Ayah number', example: '1-7', category: 'quran', requiresInput: true },
  { name: 'Juz', variable: '{{juz}}', description: 'Juz number', example: '1', category: 'quran', requiresInput: true },

  // Channel
  { name: 'Channel Name', variable: '{{channel_name}}', description: 'Your channel name', example: 'Islamic Lectures', category: 'channel' },
  { name: 'Uploader Name', variable: '{{uploader_name}}', description: 'Your name', example: 'Sheikh Ahmad', category: 'channel' },

  // Video
  { name: 'Video Title', variable: '{{video_title}}', description: 'Video title', example: 'Friday Sermon', category: 'video' },
  { name: 'Video Duration', variable: '{{video_duration}}', description: 'Video duration', example: '45:30', category: 'video' },
  { name: 'Upload Date', variable: '{{upload_date}}', description: 'Upload date', example: '11/20/2025', category: 'video' },
];
