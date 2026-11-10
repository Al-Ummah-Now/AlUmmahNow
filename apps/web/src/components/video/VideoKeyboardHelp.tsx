/**
 * Video Keyboard Shortcuts Help Overlay
 *
 * Displays an accessible help modal showing all available keyboard shortcuts
 * for the video player. Supports both English and Arabic languages with RTL layout.
 *
 * Features:
 * - Comprehensive keyboard shortcuts list
 * - Bilingual support (EN/AR)
 * - RTL layout for Arabic
 * - Accessible modal with focus trap
 * - Keyboard navigation within help
 * - Category-based organization
 * - Visual key indicators
 */

import { BodyPortal } from '@/components/ui/BodyPortal';
import React, { useEffect, useRef } from 'react';
import { X, HelpCircle, Play, SkipBack, SkipForward, Volume2, Maximize, PictureInPicture, RotateCw } from 'lucide-react';

interface VideoKeyboardHelpProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'en' | 'ar';
}

interface ShortcutCategory {
  title: string;
  titleAr: string;
  shortcuts: {
    keys: string[];
    description: string;
    descriptionAr: string;
    icon?: React.ReactNode;
  }[];
}

const ShortcutCategories: ShortcutCategory[] = [
  {
    title: 'Playback Controls',
    titleAr: 'عناصر التحكم في التشغيل',
    shortcuts: [
      {
        keys: ['Space', 'K'],
        description: 'Play/Pause',
        descriptionAr: 'تشغيل/إيقاف',
        icon: <Play className="w-4 h-4" />
      },
      {
        keys: ['J'],
        description: 'Rewind 10 seconds',
        descriptionAr: 'ترجيع 10 ثوانٍ',
        icon: <SkipBack className="w-4 h-4" />
      },
      {
        keys: ['L'],
        description: 'Forward 10 seconds',
        descriptionAr: 'تقديم 10 ثوانٍ',
        icon: <SkipForward className="w-4 h-4" />
      },
      {
        keys: ['←', '→'],
        description: 'Seek 5 seconds (RTL: arrows swap)',
        descriptionAr: 'بحث 5 ثوانٍ (RTL: تبديل الأسهم)',
        icon: <SkipBack className="w-4 h-4" />
      },
      {
        keys: ['0-9'],
        description: 'Jump to percentage (0=0%, 9=90%)',
        descriptionAr: 'القفز إلى النسبة المئوية (0=0%, 9=90%)',
        icon: <SkipForward className="w-4 h-4" />
      }
    ]
  },
  {
    title: 'Volume Controls',
    titleAr: 'عناصر التحكم في الصوت',
    shortcuts: [
      {
        keys: ['↑', '↓'],
        description: 'Volume up/down (10%)',
        descriptionAr: 'رفع/خفض الصوت (10%)',
        icon: <Volume2 className="w-4 h-4" />
      },
      {
        keys: ['M'],
        description: 'Mute/Unmute',
        descriptionAr: 'كتم/إلغاء كتم الصوت',
        icon: <Volume2 className="w-4 h-4" />
      }
    ]
  },
  {
    title: 'Display Controls',
    titleAr: 'عناصر التحكم في العرض',
    shortcuts: [
      {
        keys: ['F'],
        description: 'Toggle fullscreen',
        descriptionAr: 'تبديل ملء الشاشة',
        icon: <Maximize className="w-4 h-4" />
      },
      {
        keys: ['P'],
        description: 'Picture-in-Picture',
        descriptionAr: 'صورة داخل صورة',
        icon: <PictureInPicture className="w-4 h-4" />
      },
      {
        keys: ['C'],
        description: 'Toggle captions/subtitles',
        descriptionAr: 'تبديل التسميات التوضيحية',
        icon: <HelpCircle className="w-4 h-4" />
      }
    ]
  },
  {
    title: 'Speed Controls',
    titleAr: 'عناصر التحكم في السرعة',
    shortcuts: [
      {
        keys: ['<', ','],
        description: 'Decrease playback speed',
        descriptionAr: 'تقليل سرعة التشغيل',
        icon: <RotateCw className="w-4 h-4" />
      },
      {
        keys: ['>', '.'],
        description: 'Increase playback speed',
        descriptionAr: 'زيادة سرعة التشغيل',
        icon: <RotateCw className="w-4 h-4" />
      }
    ]
  },
  {
    title: 'Other',
    titleAr: 'أخرى',
    shortcuts: [
      {
        keys: ['?'],
        description: 'Show/hide this help',
        descriptionAr: 'إظهار/إخفاء هذه المساعدة',
        icon: <HelpCircle className="w-4 h-4" />
      },
      {
        keys: ['Esc'],
        description: 'Close help / Exit fullscreen',
        descriptionAr: 'إغلاق المساعدة / الخروج من ملء الشاشة',
        icon: <X className="w-4 h-4" />
      }
    ]
  }
];

export function VideoKeyboardHelp({ isOpen, onClose, language }: VideoKeyboardHelpProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isRTL = language === 'ar';

  // Focus management
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Focus trap within modal
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal = modalRef.current; // Copy ref value for cleanup
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    modal.addEventListener('keydown', handleTabKey);
    return () => {
      modal.removeEventListener('keydown', handleTabKey);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const title = language === 'ar' ? 'اختصارات لوحة المفاتيح' : 'Keyboard Shortcuts';
  const closeText = language === 'ar' ? 'إغلاق' : 'Close';
  const pressEscText = language === 'ar' ? 'اضغط ESC للإغلاق' : 'Press ESC to close';

  return (
    <BodyPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-6 h-6 text-primary" />
            <h2 id="help-title" className="text-xl font-semibold text-card-foreground">
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={closeText}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="space-y-6">
            {ShortcutCategories.map((category, categoryIndex) => (
              <div key={categoryIndex}>
                <h3 className="text-lg font-medium text-card-foreground mb-3">
                  {isRTL ? category.titleAr : category.title}
                </h3>
                <div className="space-y-2">
                  {category.shortcuts.map((shortcut, shortcutIndex) => (
                    <div
                      key={shortcutIndex}
                      className="flex items-center gap-4 p-3 rounded-md bg-muted/50"
                    >
                      {/* Icon */}
                      <div className="flex-shrink-0 text-muted-foreground">
                        {shortcut.icon || <HelpCircle className="w-4 h-4" />}
                      </div>

                      {/* Keys */}
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        {shortcut.keys.map((key, keyIndex) => (
                          <React.Fragment key={keyIndex}>
                            <kbd className="px-2 py-1 text-xs font-mono bg-background border border-border rounded shadow-sm">
                              {key}
                            </kbd>
                            {keyIndex < shortcut.keys.length - 1 && (
                              <span className="text-muted-foreground">or</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Description */}
                      <div className="flex-1 text-sm text-muted-foreground">
                        {isRTL ? shortcut.descriptionAr : shortcut.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer note */}
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground text-center">
              {pressEscText}
            </p>
          </div>
        </div>
      </div>
    </div></BodyPortal>
  );
}