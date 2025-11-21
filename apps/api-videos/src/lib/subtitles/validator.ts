/**
 * Subtitle validation utilities
 */

import {
  SubtitleCue,
  SubtitleData,
  ValidationError,
  ValidationResult,
  MAX_SUBTITLE_FILE_SIZE,
} from '@al-ummah/shared-types';
import { isValidTiming, findTimingOverlaps, sanitizeText } from './parser';

export class SubtitleValidator {
  /**
   * Validate timing of all cues
   * @param cues - Array of subtitle cues
   * @returns Array of validation errors
   */
  validateTiming(cues: SubtitleCue[]): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check individual cue timing
    cues.forEach((cue, index) => {
      if (!isValidTiming(cue)) {
        errors.push({
          type: 'timing',
          message: `Invalid timing for cue ${index + 1}: start=${cue.startTime}s, end=${cue.endTime}s`,
          cueIndex: index,
        });
      }
    });

    // Check for overlaps
    const overlaps = findTimingOverlaps(cues);
    overlaps.forEach((overlap) => {
      errors.push({
        type: 'timing',
        message: `Timing overlap between cues ${overlap.cue1 + 1} and ${overlap.cue2 + 1}`,
        cueIndex: overlap.cue1,
      });
    });

    // Check for chronological order
    for (let i = 0; i < cues.length - 1; i++) {
      if (cues[i].endTime > cues[i + 1].startTime) {
        errors.push({
          type: 'timing',
          message: `Cue ${i + 1} ends after cue ${i + 2} starts`,
          cueIndex: i,
        });
      }
    }

    return errors;
  }

  /**
   * Validate content of all cues
   * @param cues - Array of subtitle cues
   * @returns Array of validation errors
   */
  validateContent(cues: SubtitleCue[]): ValidationError[] {
    const errors: ValidationError[] = [];

    if (cues.length === 0) {
      errors.push({
        type: 'content',
        message: 'Subtitle file contains no cues',
      });
      return errors;
    }

    cues.forEach((cue, index) => {
      // Check for empty text
      if (!cue.text || cue.text.trim().length === 0) {
        errors.push({
          type: 'content',
          message: `Empty text for cue ${index + 1}`,
          cueIndex: index,
        });
      }

      // Check text length
      if (cue.text && cue.text.length > 10000) {
        errors.push({
          type: 'content',
          message: `Text too long for cue ${index + 1}: ${cue.text.length} characters (max 10000)`,
          cueIndex: index,
        });
      }

      // Check for potential XSS
      if (cue.text && this.containsDangerousContent(cue.text)) {
        errors.push({
          type: 'content',
          message: `Cue ${index + 1} contains potentially dangerous content`,
          cueIndex: index,
        });
      }
    });

    return errors;
  }

  /**
   * Validate file size
   * @param content - Raw subtitle file content
   * @returns True if file size is within limit
   */
  validateFileSize(content: string): boolean {
    const sizeInBytes = new TextEncoder().encode(content).length;
    return sizeInBytes <= MAX_SUBTITLE_FILE_SIZE;
  }

  /**
   * Sanitize subtitle text to prevent XSS
   * @param text - Raw subtitle text
   * @returns Sanitized text
   */
  sanitizeText(text: string): string {
    return sanitizeText(text);
  }

  /**
   * Check if text contains dangerous content
   * @param text - Text to check
   * @returns True if potentially dangerous
   */
  private containsDangerousContent(text: string): boolean {
    // Check for script tags
    if (/<script/i.test(text)) {
      return true;
    }

    // Check for event handlers
    if (/on\w+\s*=/i.test(text)) {
      return true;
    }

    // Check for javascript: protocol
    if (/javascript:/i.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Comprehensive validation of subtitle data
   * @param data - Parsed subtitle data
   * @returns Validation result
   */
  validateSubtitleData(data: SubtitleData): ValidationResult {
    const timingErrors = this.validateTiming(data.cues);
    const contentErrors = this.validateContent(data.cues);

    const allErrors = [...timingErrors, ...contentErrors];

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }
}
