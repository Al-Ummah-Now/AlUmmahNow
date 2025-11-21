/**
 * SubRip (.srt) subtitle parser
 */

import {
  SubtitleData,
  SubtitleCue,
  ValidationResult,
  ValidationError,
} from '@al-ummah/shared-types';
import {
  SubtitleParser,
  parseTimestamp,
  formatTimestamp,
  sanitizeText,
  isValidTiming,
  findTimingOverlaps,
} from './parser';

export class SRTParser implements SubtitleParser {
  parse(content: string): SubtitleData {
    const cues: SubtitleCue[] = [];
    const lines = content.split(/\r?\n/);

    let currentCue: Partial<SubtitleCue> = {};
    let currentText: string[] = [];
    let expectingSequence = true;

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
          expectingSequence = true;
        }
        continue;
      }

      // Sequence number (can be skipped)
      if (expectingSequence && /^\d+$/.test(line)) {
        currentCue.id = line;
        expectingSequence = false;
        continue;
      }

      // Timestamp line: "00:00:00,000 --> 00:00:05,000"
      if (line.includes('-->')) {
        const parts = line.split('-->').map((p) => p.trim());
        if (parts.length === 2) {
          try {
            // SRT uses commas instead of periods for milliseconds
            const startTimestamp = parts[0].replace(',', '.');
            const endTimestamp = parts[1].replace(',', '.');

            currentCue.startTime = parseTimestamp(startTimestamp);
            currentCue.endTime = parseTimestamp(endTimestamp);
          } catch (error) {
            console.error(`Failed to parse timestamp at line ${i + 1}:`, error);
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
      // Add cue identifier (optional in WebVTT, but helpful)
      if (cue.id) {
        lines.push(cue.id);
      } else {
        lines.push(`${index + 1}`);
      }

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
