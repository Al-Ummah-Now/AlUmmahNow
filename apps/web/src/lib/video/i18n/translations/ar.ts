/**
 * Arabic Translations for Video Player
 *
 * Complete set of Arabic UI strings for the video player.
 * Supports RTL (right-to-left) text direction.
 */

import type { VideoPlayerTranslations } from '../types';

export const AR_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'جاري تحميل مشغل الفيديو...',
    ready: 'تم تحميل مشغل الفيديو وهو جاهز',
    buffering: 'جاري التحميل...',
    error: 'خطأ في تحميل الفيديو',
  },

  gestures: {
    hint: 'انقر مرتين على أحد الجانبين للتقديم أو الترجيع ١٠ ثوانٍ. اسحب لأعلى أو لأسفل لتغيير مستوى الصوت.',
    dismiss: 'إغلاق',
  },

  accessibility: {
    videoPlayer: 'مشغل الفيديو',
    playButton: 'تشغيل الفيديو',
    pauseButton: 'إيقاف الفيديو مؤقتاً',
    muteButton: 'كتم الصوت',
    unmuteButton: 'إلغاء كتم الصوت',
    fullscreenButton: 'وضع ملء الشاشة',
    exitFullscreenButton: 'الخروج من ملء الشاشة',
    volumeSlider: 'التحكم بالصوت',
    progressBar: 'تقدم الفيديو',
    seekSlider: 'البحث في الفيديو',
    currentTime: 'الوقت الحالي',
    duration: 'المدة الإجمالية',
    qualityButton: 'جودة الفيديو',
    keyboardHelpButton: 'عرض اختصارات لوحة المفاتيح',
    keyboardHelpButtonTitle: 'اختصارات لوحة المفاتيح (?)',
    announcements: {
      playing: 'يتم التشغيل',
      paused: 'متوقف مؤقتاً',
      muted: 'الصوت مكتوم',
      volume: 'مستوى الصوت {volume}%',
      fullscreenOn: 'وضع ملء الشاشة',
      fullscreenOff: 'خروج من ملء الشاشة',
      playbackError: 'حدث خطأ في تشغيل الفيديو',
      buffering: 'جارٍ التحميل...',
      readyToPlay: 'جاهز للتشغيل',
    },
  },

  errors: {
    title: {
      network: 'خطأ في الشبكة',
      format: 'خطأ في التنسيق',
      playback: 'خطأ في التشغيل',
      timeout: 'انتهت مهلة الاتصال',
      unknown: 'خطأ غير معروف',
    },

    description: {
      network:
        'تعذر تحميل الفيديو. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.',
      format:
        'تنسيق الفيديو هذا غير مدعوم في متصفحك. حاول استخدام متصفح مختلف أو تحديث المتصفح الحالي.',
      playback:
        'حدث خطأ أثناء تشغيل الفيديو. يرجى محاولة إعادة تحميل الفيديو.',
      timeout:
        'استغرق تحميل الفيديو وقتاً طويلاً. يرجى التحقق من اتصالك والمحاولة مرة أخرى.',
      unknown:
        'حدث خطأ غير متوقع أثناء تشغيل الفيديو. يرجى المحاولة مرة أخرى.',
    },

    retryButton: 'حاول مرة أخرى',

    fallbackButton: {
      network: 'إعادة تحميل الفيديو',
      format: 'جرب متصفح مختلف',
      playback: 'إعادة تحميل الفيديو',
      timeout: 'إعادة تحميل الفيديو',
      unknown: 'إعادة تحميل الصفحة',
    },

    details: {
      network:
        'لم يتم تحميل الفيديو بسبب مشكلة في الشبكة. قد يكون السبب:\n\n• ضعف اتصال الإنترنت\n• الخادم غير متاح مؤقتاً\n• ملف الفيديو غير قابل للوصول\n\nحاول تحديث الصفحة أو تحقق من إعدادات الشبكة.',
      format:
        'متصفحك لا يدعم تنسيق الفيديو هذا. الحلول الممكنة:\n\n• استخدم متصفح حديث (Chrome، Firefox، Safari، Edge)\n• حدّث متصفحك الحالي إلى أحدث إصدار\n• جرب إعداد جودة فيديو مختلفة\n\nالتنسيقات المدعومة: MP4 (H.264)، WebM (VP8/VP9)',
      playback:
        'حدث خطأ أثناء تشغيل الفيديو. قد يكون السبب:\n\n• بيانات الفيديو تالفة\n• انقطاع في التشغيل\n• مشاكل في تسريع الأجهزة\n\nحاول تعطيل تسريع الأجهزة في إعدادات المتصفح.',
      timeout:
        'استغرق تحميل الفيديو وقتاً طويلاً. قد يكون السبب:\n\n• اتصال إنترنت بطيء\n• حجم ملف الفيديو كبير\n• تأخر في استجابة الخادم\n\nجرب استخدام إعداد جودة أقل أو تحقق من سرعة الإنترنت.',
      unknown:
        'حدث خطأ غير متوقع. قد يكون السبب:\n\n• مشكلة مؤقتة في المتصفح\n• ذاكرة التخزين المؤقت تالفة\n• تعارض في إضافات المتصفح\n\nحاول مسح ذاكرة التخزين المؤقت، أو تعطيل الإضافات، أو استخدام متصفح آخر.',
    },

    detailLabels: {
      type: 'النوع:',
      message: 'الرسالة:',
      code: 'الكود:',
      time: 'الوقت:',
      severity: 'الخطورة:',
      detailsTitle: 'تفاصيل الخطأ',
    },
  },

  controls: {
    play: 'تشغيل',
    pause: 'إيقاف مؤقت',
    mute: 'كتم الصوت',
    unmute: 'إلغاء الكتم',
    fullscreen: 'ملء الشاشة',
    exitFullscreen: 'الخروج من ملء الشاشة',
    pictureInPicture: 'صورة داخل صورة',
    exitPictureInPicture: 'الخروج من صورة داخل صورة',
    pipNotAvailable: 'صورة داخل صورة غير متاحة',
    pipNotSupported: 'صورة داخل صورة غير مدعومة',
    settings: 'الإعدادات',
    captions: 'الترجمة',
    quality: 'الجودة',
    speed: 'السرعة',
    volume: 'الصوت',
  },

  quality: {
    auto: 'تلقائي',
    high: 'عالية',
    medium: 'متوسطة',
    low: 'منخفضة',
    labels: {
      '2160p': '4K (2160p)',
      '1080p': 'عالية الدقة الكاملة (1080p)',
      '720p': 'عالية الدقة (720p)',
      '480p': 'دقة قياسية (480p)',
      '360p': 'منخفضة (360p)',
      '240p': 'منخفضة جداً (240p)',
    },
  },

  speed: {
    normal: 'عادي',
    labels: {
      '0.25': '٠.٢٥×',
      '0.5': '٠.٥×',
      '0.75': '٠.٧٥×',
      '1': 'عادي',
      '1.25': '١.٢٥×',
      '1.5': '١.٥×',
      '1.75': '١.٧٥×',
      '2': '٢×',
    },
  },

  time: {
    hours: 'ساعات',
    minutes: 'دقائق',
    seconds: 'ثواني',
    live: 'مباشر',
    elapsed: 'منقضي',
    remaining: 'متبقي',
  },

  keyboard: {
    title: 'اختصارات لوحة المفاتيح',
    description: 'تحكم في مشغل الفيديو باستخدام لوحة المفاتيح',
    sections: {
      playback: 'التشغيل',
      seeking: 'التنقل',
      volume: 'الصوت',
      display: 'العرض',
      speed: 'السرعة',
      navigation: 'التنقل بين عناصر التحكم',
    },
    shortcuts: {
      playPause: {
        keys: 'مسافة، K',
        description: 'تشغيل/إيقاف مؤقت',
      },
      rewind5: {
        keys: '→',
        description: 'الرجوع ٥ ثوانٍ',
      },
      rewind10: {
        keys: 'J',
        description: 'الرجوع ١٠ ثوانٍ',
      },
      forward5: {
        keys: '←',
        description: 'التقديم ٥ ثوانٍ',
      },
      forward10: {
        keys: 'L',
        description: 'التقديم ١٠ ثوانٍ',
      },
      volumeUp: {
        keys: '↑',
        description: 'زيادة الصوت',
      },
      volumeDown: {
        keys: '↓',
        description: 'خفض الصوت',
      },
      mute: {
        keys: 'M',
        description: 'كتم/إلغاء الكتم',
      },
      fullscreen: {
        keys: 'F',
        description: 'تبديل ملء الشاشة',
      },
      pip: {
        keys: 'P',
        description: 'صورة داخل صورة',
      },
      speedDecrease: {
        keys: '<',
        description: 'تقليل السرعة',
      },
      speedIncrease: {
        keys: '>',
        description: 'زيادة السرعة',
      },
      seekPercent: {
        keys: '٠-٩',
        description: 'الانتقال إلى ٠٪-٩٠٪',
      },
      help: {
        keys: '?',
        description: 'عرض قائمة الاختصارات هذه',
      },
      tabNavigation: {
        keys: 'Tab، Shift+Tab',
        description: 'التنقل بين عناصر تحكم المشغل',
      },
      activate: {
        keys: 'Enter، مسافة',
        description: 'تفعيل عنصر التحكم المحدد',
      },
      closeDialog: {
        keys: 'Esc',
        description: 'إغلاق القوائم والنوافذ',
      },
    },
    closeButton: 'إغلاق',
  },

  resume: {
    title: 'هل تريد متابعة المشاهدة؟',
    description: 'شاهدت هذا الفيديو سابقاً',
    resumeButton: 'استئناف من',
    startOverButton: 'البدء من البداية',
    autoResumeMessage: 'سيتم الاستئناف تلقائياً خلال',
    dismissHint: 'اضغط ESC أو انقر خارج الإطار للإلغاء',
  },
};
