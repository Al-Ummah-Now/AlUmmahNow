/**
 * Subtitle format converter
 */

import { SubtitleFormat } from '@al-ummah/shared-types';
import { SubtitleParser } from './parser';
import { SRTParser } from './srt-parser';
import { VTTParser } from './vtt-parser';
import { SBVParser } from './sbv-parser';
import { detectFormat, isSupportedFormat } from './format-detector';

export class SubtitleConverter {
  private parsers: Map<SubtitleFormat, SubtitleParser>;

  constructor() {
    this.parsers = new Map([
      ['srt', new SRTParser()],
      ['vtt', new VTTParser()],
      ['sbv', new SBVParser()],
    ]);
  }

  /**
   * Convert subtitle from one format to another
   * @param content - Raw subtitle content
   * @param fromFormat - Source format (or 'auto' to detect)
   * @param toFormat - Target format
   * @returns Converted subtitle content
   */
  convert(
    content: string,
    fromFormat: SubtitleFormat | 'auto',
    toFormat: SubtitleFormat
  ): string {
    // Auto-detect format if needed
    let sourceFormat: SubtitleFormat;
    if (fromFormat === 'auto') {
      const detected = detectFormat(content);
      if (!isSupportedFormat(detected)) {
        throw new Error(`Unable to detect subtitle format`);
      }
      sourceFormat = detected;
    } else {
      sourceFormat = fromFormat;
    }

    // Get parser for source format
    const parser = this.parsers.get(sourceFormat);
    if (!parser) {
      throw new Error(`Unsupported source format: ${sourceFormat}`);
    }

    // Parse source content
    const data = parser.parse(content);

    // Validate parsed data
    const validation = parser.validate(data);
    if (!validation.valid) {
      throw new Error(
        `Invalid subtitle file: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }

    // Get parser for target format
    const targetParser = this.parsers.get(toFormat);
    if (!targetParser) {
      throw new Error(`Unsupported target format: ${toFormat}`);
    }

    // Convert to target format
    return targetParser.toWebVTT(data);
  }

  /**
   * Convert any subtitle format to WebVTT
   * @param content - Raw subtitle content
   * @param format - Source format (optional, will auto-detect)
   * @returns WebVTT formatted subtitle
   */
  toWebVTT(content: string, format?: SubtitleFormat): string {
    return this.convert(content, format || 'auto', 'vtt');
  }

  /**
   * Validate and parse subtitle content
   * @param content - Raw subtitle content
   * @param format - Format (optional, will auto-detect)
   * @returns Parsed and validated subtitle data
   */
  parseAndValidate(content: string, format?: SubtitleFormat) {
    // Auto-detect format if not provided
    let sourceFormat: SubtitleFormat;
    if (format) {
      sourceFormat = format;
    } else {
      const detected = detectFormat(content);
      if (!isSupportedFormat(detected)) {
        throw new Error(`Unable to detect subtitle format`);
      }
      sourceFormat = detected;
    }

    // Get parser
    const parser = this.parsers.get(sourceFormat);
    if (!parser) {
      throw new Error(`Unsupported format: ${sourceFormat}`);
    }

    // Parse
    const data = parser.parse(content);

    // Validate
    const validation = parser.validate(data);

    return {
      data,
      validation,
      format: sourceFormat,
    };
  }
}
