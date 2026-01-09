/**
 * SubViewer (.sbv) subtitle parser
 * YouTube's simple subtitle format
 */

import {
  SubtitleData,
  SubtitleCue,
  ValidationResult,
  ValidationError,
} from '@al-ummah/shared-types';
import {
  SubtitleParser,
  formatTimestamp,
  sanitizeText,
  isValidTiming,
  findTimingOverlaps,
} from './parser';
import { logger } from '../logger';

export class SBVParser implements SubtitleParser {
  parse(content: string): SubtitleData {
    const cues: SubtitleCue[] = [];
    const lines = content.split(/\r?\n/);

    let currentCue: Partial<SubtitleCue> = {};
    let currentText: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        // If we have accumulated text, finalize the cue
        if (currentText.length > 0 && currentCue.startTime !== undefined) {
          currentCue.text = sanitizeText(currentText.join('\n'));
          cues.push(currentCue as SubtitleCue);
          currentCue = {};
          currentText = [];
        }
        continue;
      }

      // Timestamp line: "0:00:00.000,0:00:05.000"
      if (line.includes(',') && /^\d{1,2}:\d{2}:\d{2}\.\d{3}/.test(line)) {
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length === 2) {
          try {
            currentCue.startTime = this.parseSBVTimestamp(parts[0]);
            currentCue.endTime = this.parseSBVTimestamp(parts[1]);
          } catch (error) {
            logger.error(`Failed to parse timestamp at line ${i + 1}:`, error);
            // Skip malformed timestamp
          }
        }
        continue;
      }

      // Subtitle text
      if (currentCue.startTime !== undefined) {
        currentText.push(line);
      }
    }

    // Handle last cue if present
    if (currentText.length > 0 && currentCue.startTime !== undefined) {
      currentCue.text = sanitizeText(currentText.join('\n'));
      cues.push(currentCue as SubtitleCue);
    }

    return { cues };
  }

  /**
   * Parse SBV timestamp to seconds
   * Format: H:MM:SS.mmm or HH:MM:SS.mmm
   */
  private parseSBVTimestamp(timestamp: string): number {
    timestamp = timestamp.trim();

    const match = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})$/);

    if (!match) {
      throw new Error(`Invalid SBV timestamp format: ${timestamp}`);
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const milliseconds = parseInt(match[4], 10);

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  validate(data: SubtitleData): ValidationResult {
    const errors: ValidationError[] = [];

    // Check if empty
    if (data.cues.length === 0) {
      errors.push({
        type: 'content',
        message: 'Subtitle file contains no cues',
      });
      return { valid: false, errors };
    }

    // Validate each cue
    data.cues.forEach((cue, index) => {
      // Check timing validity
      if (!isValidTiming(cue)) {
        errors.push({
          type: 'timing',
          message: `Invalid timing for cue ${index + 1}: start=${cue.startTime}s, end=${cue.endTime}s`,
          cueIndex: index,
        });
      }

      // Check text content
      if (!cue.text || cue.text.trim().length === 0) {
        errors.push({
          type: 'content',
          message: `Empty text for cue ${index + 1}`,
          cueIndex: index,
        });
      }

      // Check text length (max 10000 characters per cue)
      if (cue.text && cue.text.length > 10000) {
        errors.push({
          type: 'content',
          message: `Text too long for cue ${index + 1}: ${cue.text.length} characters`,
          cueIndex: index,
        });
      }
    });

    // Check for timing overlaps
    const overlaps = findTimingOverlaps(data.cues);
    overlaps.forEach((overlap) => {
      errors.push({
        type: 'timing',
        message: `Timing overlap between cues ${overlap.cue1 + 1} and ${overlap.cue2 + 1}`,
        cueIndex: overlap.cue1,
      });
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  toWebVTT(data: SubtitleData): string {
    const lines: string[] = ['WEBVTT', ''];

    data.cues.forEach((cue, index) => {
      // Add cue identifier
      lines.push(`${index + 1}`);

      // Add timing line
      const startTime = formatTimestamp(cue.startTime);
      const endTime = formatTimestamp(cue.endTime);
      lines.push(`${startTime} --> ${endTime}`);

      // Add text (can be multi-line)
      lines.push(cue.text);

      // Add blank line between cues
      lines.push('');
    });

    return lines.join('\n');
  }
}
