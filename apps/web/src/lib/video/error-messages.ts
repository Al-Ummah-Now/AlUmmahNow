/**
 * Bilingual error messages for video player
 */

import { VideoErrorType } from './error-handler';

export interface ErrorMessages {
  title: string;
  description: string;
  retryButton: string;
  fallbackButton: string;
  details: string;
}

/**
 * Error messages in English
 */
export const ERROR_MESSAGES_EN: Record<VideoErrorType, ErrorMessages> = {
  [VideoErrorType.NETWORK_ERROR]: {
    title: 'Network Error',
    description: 'Unable to connect to the video server. Please check your internet connection.',
    retryButton: 'Retry',
    fallbackButton: 'Try Alternative Quality',
    details: 'This error usually occurs due to network connectivity issues.',
  },
  [VideoErrorType.FORMAT_ERROR]: {
    title: 'Format Not Supported',
    description: 'Your browser does not support this video format.',
    retryButton: 'Retry',
    fallbackButton: 'Try Alternative Format',
    details: 'Please try using a different browser or update your current browser.',
  },
  [VideoErrorType.DECODE_ERROR]: {
    title: 'Playback Error',
    description: 'Unable to decode the video. The file may be corrupted.',
    retryButton: 'Retry',
    fallbackButton: 'Try Alternative Quality',
    details: 'This error indicates a problem with the video encoding.',
  },
  [VideoErrorType.HLS_ERROR]: {
    title: 'Streaming Error',
    description: 'Unable to load the video stream. Switching to alternative format.',
    retryButton: 'Retry',
    fallbackButton: 'Use Direct Download',
    details: 'HLS streaming is not available. Trying MP4 format instead.',
  },
  [VideoErrorType.TIMEOUT_ERROR]: {
    title: 'Loading Timeout',
    description: 'The video took too long to load. Please try again.',
    retryButton: 'Retry',
    fallbackButton: 'Try Lower Quality',
    details: 'This may be due to slow network connection or server issues.',
  },
  [VideoErrorType.UNKNOWN_ERROR]: {
    title: 'Playback Error',
    description: 'An unexpected error occurred. Please try again.',
    retryButton: 'Retry',
    fallbackButton: 'Reload Page',
    details: 'If the problem persists, please contact support.',
  },
};

/**
 * Error messages in Arabic
 */
export const ERROR_MESSAGES_AR: Record<VideoErrorType, ErrorMessages> = {
  [VideoErrorType.NETWORK_ERROR]: {
    title: 'خطأ في الشبكة',
    description: 'غير قادر على الاتصال بخادم المرئيات. يرجى التحقق من اتصالك بالإنترنت.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'جرب جودة بديلة',
    details: 'يحدث هذا الخطأ عادة بسبب مشاكل في الاتصال بالشبكة.',
  },
  [VideoErrorType.FORMAT_ERROR]: {
    title: 'التنسيق غير مدعوم',
    description: 'متصفحك لا يدعم تنسيق هذا المرئي.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'جرب تنسيق بديل',
    details: 'يرجى محاولة استخدام متصفح مختلف أو تحديث متصفحك الحالي.',
  },
  [VideoErrorType.DECODE_ERROR]: {
    title: 'خطأ في التشغيل',
    description: 'غير قادر على فك تشفير المرئي. قد يكون الملف تالفاً.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'جرب جودة بديلة',
    details: 'يشير هذا الخطأ إلى مشكلة في ترميز المرئي.',
  },
  [VideoErrorType.HLS_ERROR]: {
    title: 'خطأ في البث',
    description: 'غير قادر على تحميل البث المباشر. جاري التبديل إلى تنسيق بديل.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'استخدم التنزيل المباشر',
    details: 'بث HLS غير متاح. جاري المحاولة بتنسيق MP4 بدلاً من ذلك.',
  },
  [VideoErrorType.TIMEOUT_ERROR]: {
    title: 'انتهت مهلة التحميل',
    description: 'استغرق تحميل المرئي وقتاً طويلاً. يرجى المحاولة مرة أخرى.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'جرب جودة أقل',
    details: 'قد يكون هذا بسبب بطء الاتصال بالشبكة أو مشاكل في الخادم.',
  },
  [VideoErrorType.UNKNOWN_ERROR]: {
    title: 'خطأ في التشغيل',
    description: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
    retryButton: 'إعادة المحاولة',
    fallbackButton: 'إعادة تحميل الصفحة',
    details: 'إذا استمرت المشكلة، يرجى الاتصال بالدعم.',
  },
};

/**
 * Get error messages for a specific language
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Error messages object
 */
export function getErrorMessages(lang: 'en' | 'ar'): Record<VideoErrorType, ErrorMessages> {
  return lang === 'ar' ? ERROR_MESSAGES_AR : ERROR_MESSAGES_EN;
}

/**
 * Get specific error message for type and language
 *
 * @param errorType - Type of error
 * @param lang - Language code ('en' or 'ar')
 * @returns Error messages for the specific error type
 */
export function getErrorMessage(errorType: VideoErrorType, lang: 'en' | 'ar'): ErrorMessages {
  const messages = getErrorMessages(lang);
  return messages[errorType];
}
