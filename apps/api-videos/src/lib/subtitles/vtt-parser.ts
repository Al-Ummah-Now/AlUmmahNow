/**
 * WebVTT (.vtt) subtitle parser
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
import { logger } from '../logger';

export class VTTParser implements SubtitleParser {
  parse(content: string): SubtitleData {
    const cues: SubtitleCue[] = [];
    const metadata: Record<string, string> = {};
    const lines = content.split(/\r?\n/);

    // Validate WebVTT header
    if (!lines[0]?.trim().startsWith('WEBVTT')) {
      throw new Error('Invalid WebVTT file: Missing WEBVTT header');
    }

    let currentCue: Partial<SubtitleCue> = {};
    let currentText: string[] = [];
    let inHeader = true;

    for (let i = 1; i < lines.length; i++) {
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
        inHeader = false;
        continue;
      }

      // Parse header metadata (NOTE: lines after WEBVTT before first blank line)
      if (inHeader) {
        const metaMatch = line.match(/^(\w+):\s*(.+)$/);
        if (metaMatch) {
          metadata[metaMatch[1]] = metaMatch[2];
        }
        continue;
      }

      // Timestamp line: "00:00:00.000 --> 00:00:05.000"
      if (line.includes('-->')) {
        // Check if there's a cue identifier on the previous line
        const prevLine = lines[i - 1]?.trim();
        if (prevLine && !prevLine.includes('-->') && prevLine !== '') {
          currentCue.id = prevLine;
        }

        const parts = line.split('-->').map((p) => p.trim());
        if (parts.length === 2) {
          try {
            // WebVTT uses periods for milliseconds
            currentCue.startTime = parseTimestamp(parts[0]);
            currentCue.endTime = parseTimestamp(parts[1]);

            // Parse optional cue settings (after end timestamp)
            const settingsMatch = parts[1].match(/\s+(.*)/);
            if (settingsMatch) {
              const settings = settingsMatch[1];
              // Parse settings like "align:middle line:90%"
              const settingsParts = settings.split(/\s+/);
              settingsParts.forEach((setting) => {
                const [key, value] = setting.split(':');
                if (key === 'align') {
                  currentCue.align = value as 'start' | 'middle' | 'end';
                } else if (key === 'line' && value) {
                  currentCue.line = parseFloat(value);
                } else if (key === 'size' && value) {
                  currentCue.size = parseFloat(value);
                }
              });
            }
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

    return {
      cues,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
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

    // Check for timing overlaps (warnings only for VTT)
    const overlaps = findTimingOverlaps(data.cues);
    const warnings: ValidationError[] = [];
    overlaps.forEach((overlap) => {
      warnings.push({
        type: 'timing',
        message: `Timing overlap between cues ${overlap.cue1 + 1} and ${overlap.cue2 + 1}`,
        cueIndex: overlap.cue1,
      });
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  toWebVTT(data: SubtitleData): string {
    const lines: string[] = ['WEBVTT'];

    // Add metadata if present
    if (data.metadata) {
      Object.entries(data.metadata).forEach(([key, value]) => {
        lines.push(`${key}: ${value}`);
      });
    }

    lines.push('');

    data.cues.forEach((cue, index) => {
      // Add cue identifier (optional in WebVTT)
      if (cue.id) {
        lines.push(cue.id);
      }

      // Add timing line
      const startTime = formatTimestamp(cue.startTime);
      const endTime = formatTimestamp(cue.endTime);
      let timingLine = `${startTime} --> ${endTime}`;

      // Add cue settings if present
      const settings: string[] = [];
      if (cue.align) settings.push(`align:${cue.align}`);
      if (cue.line !== undefined) settings.push(`line:${cue.line}%`);
      if (cue.size !== undefined) settings.push(`size:${cue.size}%`);
      if (settings.length > 0) {
        timingLine += ' ' + settings.join(' ');
      }

      lines.push(timingLine);

      // Add text (can be multi-line)
      lines.push(cue.text);

      // Add blank line between cues
      lines.push('');
    });

    return lines.join('\n');
  }
}
