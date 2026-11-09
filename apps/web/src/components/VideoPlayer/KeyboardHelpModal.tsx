/**
 * Keyboard Help Modal Component
 *
 * Displays keyboard shortcuts for the video player in a modal dialog.
 * Supports both English and Arabic languages with RTL layout.
 *
 * Features:
 * - Bilingual support (EN/AR)
 * - RTL support for Arabic
 * - Organized by category
 * - Accessible modal dialog
 * - Keyboard navigation (Esc to close)
 * - Backdrop click to close
 * - Focus trap
 *
 * @example
 * ```tsx
 * <KeyboardHelpModal
 *   isOpen={showHelp}
 *   onClose={() => setShowHelp(false)}
 *   lang="en"
 * />
 * ```
 */

'use client';

import { BodyPortal } from '@/components/ui/BodyPortal';
import { useEffect, useRef } from 'react';
import { useVideoPlayerI18n } from '@/lib/video/i18n';
import type { SupportedLanguage } from '@/lib/video/i18n';
import { trapFocus } from '@/lib/accessibility/focus-manager';

/** Key lists use ", " in English and the Arabic comma "، " in Arabic */
export function splitShortcutKeys(keys: string): string[] {
  return keys.split(/\s*[,،]\s*/).filter(Boolean);
}

export interface KeyboardHelpModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;

  /**
   * Callback when modal should close
   */
  onClose: () => void;

  /**
   * Language for translations
   */
  lang?: SupportedLanguage;
}

/**
 * Keyboard Help Modal Component
 */
export function KeyboardHelpModal({
  isOpen,
  onClose,
  lang = 'en',
}: KeyboardHelpModalProps) {
  const { t, dir } = useVideoPlayerI18n(lang);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Handle Escape key to close modal
   */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /**
   * Trap focus inside the dialog while open (focus starts on the close button)
   * and return it to the control that opened the dialog when it closes.
   */
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    return trapFocus(modalRef.current, { initialFocus: closeButtonRef.current });
  }, [isOpen]);

  /**
   * Prevent body scroll when modal is open
   */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  /**
   * Handle backdrop click
   */
  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!isOpen) return null;

  const shortcuts = [
    {
      section: t.keyboard.sections.playback,
      items: [
        t.keyboard.shortcuts.playPause,
      ],
    },
    {
      section: t.keyboard.sections.seeking,
      items: [
        t.keyboard.shortcuts.rewind5,
        t.keyboard.shortcuts.rewind10,
        t.keyboard.shortcuts.forward5,
        t.keyboard.shortcuts.forward10,
        t.keyboard.shortcuts.seekPercent,
      ],
    },
    {
      section: t.keyboard.sections.volume,
      items: [
        t.keyboard.shortcuts.volumeUp,
        t.keyboard.shortcuts.volumeDown,
        t.keyboard.shortcuts.mute,
      ],
    },
    {
      section: t.keyboard.sections.display,
      items: [
        t.keyboard.shortcuts.fullscreen,
        t.keyboard.shortcuts.pip,
      ],
    },
    {
      section: t.keyboard.sections.speed,
      items: [
        t.keyboard.shortcuts.speedDecrease,
        t.keyboard.shortcuts.speedIncrease,
      ],
    },
    {
      section: t.keyboard.sections.navigation,
      items: [
        t.keyboard.shortcuts.tabNavigation,
        t.keyboard.shortcuts.activate,
        t.keyboard.shortcuts.closeDialog,
        t.keyboard.shortcuts.help,
      ],
    },
  ];

  return (
    <BodyPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-help-title"
      aria-describedby="keyboard-help-description"
      dir={dir}
    >
      <div
        ref={modalRef}
        data-testid="keyboard-help" className="relative flex w-full max-w-4xl max-h-[min(80vh,720px)] flex-col overflow-hidden bg-background rounded-xl shadow-xl m-4"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 py-3 border-b">
          <div>
            <h2
              id="keyboard-help-title"
              className="text-lg font-semibold text-foreground"
            >
              {t.keyboard.title}
            </h2>
            <p id="keyboard-help-description" className="text-sm text-muted-foreground">
              {t.keyboard.description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-muted active:bg-muted transition-colors"
            aria-label={t.keyboard.closeButton}
          >
            <svg
              aria-hidden="true"
              className="w-[18px] h-[18px]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-5 py-3 md:columns-2 md:gap-8">
          {shortcuts.map((category, categoryIndex) => (
            <section key={categoryIndex} className="mb-4 break-inside-avoid" aria-labelledby={`keyboard-help-section-${categoryIndex}`}>
              <h3 id={`keyboard-help-section-${categoryIndex}`} className="text-sm font-semibold text-muted-foreground mb-1">
                {category.section}
              </h3>
              <dl>
                {category.items.map((shortcut, shortcutIndex) => (
                  <div
                    key={shortcutIndex}
                    className="flex min-h-10 items-center justify-between gap-4 border-b border-border/50 last:border-b-0"
                  >
                    <dt className="min-w-0 flex-1 text-sm text-foreground">
                      {shortcut.description}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1" dir="ltr">
                      {splitShortcutKeys(shortcut.keys).map((key, keyIndex) => (
                        <kbd
                          key={keyIndex}
                          className="inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded border border-border px-1.5 text-xs font-semibold text-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div></BodyPortal>
  );
}
