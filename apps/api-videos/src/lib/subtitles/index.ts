/**
 * Subtitle service - Main entry point for subtitle operations
 */

import {
  SubtitleTrack,
  SubtitleMetadata,
  SUPPORTED_SUBTITLE_LANGUAGES,
  MAX_SUBTITLE_FILE_SIZE,
} from '@al-ummah/shared-types';
import { SubtitleConverter } from './converter';
import { SubtitleValidator } from './validator';
import { detectFormat, isSupportedFormat } from './format-detector';

export class SubtitleService {
  private converter: SubtitleConverter;
  private validator: SubtitleValidator;

  constructor() {
    this.converter = new SubtitleConverter();
    this.validator = new SubtitleValidator();
  }

  /**
   * Process uploaded subtitle file
   * @param content - Raw subtitle file content
   * @param language - Language code (e.g., 'en', 'ar')
   * @param uploadedBy - User ID who uploaded
   * @returns Processed subtitle data ready for storage
   */
  async processSubtitle(
    content: string,
    language: string,
    uploadedBy: string
  ): Promise<{
    webvttContent: string;
    track: Omit<SubtitleTrack, 'url'>;
    originalFormat: string;
  }> {
    // Validate file size
    if (!this.validator.validateFileSize(content)) {
      throw new Error(
        `Subtitle file exceeds maximum size of ${MAX_SUBTITLE_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    // Detect format
    const format = detectFormat(content);
    if (!isSupportedFormat(format)) {
      throw new Error(
        'Unsupported subtitle format. Supported formats: .vtt, .srt, .sbv'
      );
    }

    // Parse and validate
    const result = this.converter.parseAndValidate(content, format);
    if (!result.validation.valid) {
      const errorMessages = result.validation.errors
        .map((e) => e.message)
        .join('; ');
      throw new Error(`Invalid subtitle file: ${errorMessages}`);
    }

    // Convert to WebVTT
    const webvttContent = this.converter.toWebVTT(content, format);

    // Get language label
    const languageInfo = SUPPORTED_SUBTITLE_LANGUAGES.find(
      (lang) => lang.code === language
    );
    const label = languageInfo?.label || language;

    // Calculate file size
    const fileSize = new TextEncoder().encode(webvttContent).length;

    // Create track metadata
    const track: Omit<SubtitleTrack, 'url'> = {
      id: crypto.randomUUID(),
      language,
      label,
      kind: 'subtitles',
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      fileSize,
      format: format,
      status: 'ready',
    };

    return {
      webvttContent,
      track,
      originalFormat: format,
    };
  }

  /**
   * Validate language code
   * @param language - Language code to validate
   * @returns True if language is supported
   */
  validateLanguage(language: string): boolean {
    return SUPPORTED_SUBTITLE_LANGUAGES.some((lang) => lang.code === language);
  }

  /**
   * Get language label
   * @param language - Language code
   * @returns Display label for language
   */
  getLanguageLabel(language: string): string {
    const languageInfo = SUPPORTED_SUBTITLE_LANGUAGES.find(
      (lang) => lang.code === language
    );
    return languageInfo?.label || language;
  }

  /**
   * Get text direction for language
   * @param language - Language code
   * @returns Text direction ('ltr' or 'rtl')
   */
  getTextDirection(language: string): 'ltr' | 'rtl' {
    const languageInfo = SUPPORTED_SUBTITLE_LANGUAGES.find(
      (lang) => lang.code === language
    );
    return languageInfo?.dir || 'ltr';
  }

  /**
   * Create subtitle metadata object
   * @param videoId - Video ID
   * @param tracks - Array of subtitle tracks
   * @returns Subtitle metadata
   */
  createMetadata(videoId: string, tracks: SubtitleTrack[]): SubtitleMetadata {
    return {
      videoId,
      tracks,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    };
  }

  /**
   * Update subtitle metadata with new track
   * @param metadata - Existing metadata
   * @param track - New track to add
   * @returns Updated metadata
   */
  addTrack(metadata: SubtitleMetadata, track: SubtitleTrack): SubtitleMetadata {
    // Remove existing track for same language if present
    const filteredTracks = metadata.tracks.filter(
      (t) => t.language !== track.language
    );

    return {
      ...metadata,
      tracks: [...filteredTracks, track],
      dateModified: new Date().toISOString(),
    };
  }

  /**
   * Remove track from metadata
   * @param metadata - Existing metadata
   * @param language - Language code to remove
   * @returns Updated metadata
   */
  removeTrack(
    metadata: SubtitleMetadata,
    language: string
  ): SubtitleMetadata {
    return {
      ...metadata,
      tracks: metadata.tracks.filter((t) => t.language !== language),
      dateModified: new Date().toISOString(),
    };
  }

  /**
   * Update default track
   * @param metadata - Existing metadata
   * @param language - Language to set as default
   * @returns Updated metadata
   */
  setDefaultTrack(
    metadata: SubtitleMetadata,
    language: string
  ): SubtitleMetadata {
    return {
      ...metadata,
      tracks: metadata.tracks.map((t) => ({
        ...t,
        isDefault: t.language === language,
      })),
      dateModified: new Date().toISOString(),
    };
  }
}

// Export all subtitle utilities
export * from './format-detector';
export * from './parser';
export * from './srt-parser';
export * from './vtt-parser';
export * from './sbv-parser';
export * from './converter';
export * from './validator';
