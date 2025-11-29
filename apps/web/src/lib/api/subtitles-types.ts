/**
 * Subtitle Track Type
 */
export interface SubtitleTrack {
  videoId: string;
  language: string;
  label: string;
  url: string;
  isDefault: boolean;
  fileSize: number;
  uploadDate: string;
  status: 'active' | 'processing' | 'failed';
}

/**
 * Supported Languages (10 languages)
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'ar', name: 'Arabic', nameAr: 'العربية', rtl: true, flag: '🇸🇦' },
  { code: 'en', name: 'English', nameAr: 'الإنجليزية', rtl: false, flag: '🇬🇧' },
  { code: 'ur', name: 'Urdu', nameAr: 'الأردية', rtl: true, flag: '🇵🇰' },
  { code: 'fr', name: 'French', nameAr: 'الفرنسية', rtl: false, flag: '🇫🇷' },
  { code: 'id', name: 'Indonesian', nameAr: 'الإندونيسية', rtl: false, flag: '🇮🇩' },
  { code: 'tr', name: 'Turkish', nameAr: 'التركية', rtl: false, flag: '🇹🇷' },
  { code: 'ms', name: 'Malay', nameAr: 'الملايو', rtl: false, flag: '🇲🇾' },
  { code: 'bn', name: 'Bengali', nameAr: 'البنغالية', rtl: false, flag: '🇧🇩' },
  { code: 'de', name: 'German', nameAr: 'الألمانية', rtl: false, flag: '🇩🇪' },
  { code: 'es', name: 'Spanish', nameAr: 'الإسبانية', rtl: false, flag: '🇪🇸' },
] as const;

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

/**
 * Client-side subtitle validation types
 */
export interface SubtitleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  preview?: SubtitleCue[];
}

export interface SubtitleCue {
  startTime: string;
  endTime: string;
  text: string;
}
