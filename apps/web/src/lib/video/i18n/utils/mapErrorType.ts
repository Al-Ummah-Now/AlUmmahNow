/**
 * Error Type Mapping Utility
 *
 * Maps between VideoErrorHandler enum types and i18n string literal types.
 */

import { VideoErrorType as ErrorHandlerType } from '@/lib/video/error-handler';
import type { VideoErrorType as I18nErrorType } from '../types';

/**
 * Map VideoErrorHandler type to i18n error type
 *
 * @param errorType - VideoErrorType from error-handler
 * @returns Mapped i18n error type string
 */
export function mapErrorTypeToI18n(
  errorType: ErrorHandlerType
): I18nErrorType {
  switch (errorType) {
    case ErrorHandlerType.NETWORK_ERROR:
      return 'network';
    case ErrorHandlerType.FORMAT_ERROR:
      return 'format';
    case ErrorHandlerType.DECODE_ERROR:
      return 'playback';
    case ErrorHandlerType.HLS_ERROR:
      return 'format';
    case ErrorHandlerType.TIMEOUT_ERROR:
      return 'timeout';
    case ErrorHandlerType.UNKNOWN_ERROR:
    default:
      return 'unknown';
  }
}
