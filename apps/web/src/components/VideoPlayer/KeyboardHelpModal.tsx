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
    <div
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
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background rounded-lg shadow-xl m-4"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b bg-background">
          <div>
            <h2
              id="keyboard-help-title"
              className="text-2xl font-bold text-foreground"
            >
              {t.keyboard.title}
            </h2>
            <p id="keyboard-help-description" className="text-sm text-muted-foreground mt-1">
              {t.keyboard.description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-11 min-h-11 p-2 rounded-lg hover:bg-muted active:bg-muted transition-colors"
            aria-label={t.keyboard.closeButton}
          >
            <svg
              aria-hidden="true"
              className="w-6 h-6"
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
        <div className="px-6 py-4 space-y-6">
          {shortcuts.map((category, categoryIndex) => (
            <section key={categoryIndex} aria-labelledby={`keyboard-help-section-${categoryIndex}`}>
              <h3 id={`keyboard-help-section-${categoryIndex}`} className="text-lg font-semibold text-foreground mb-3">
                {category.section}
              </h3>
              <dl className="space-y-2">
                {category.items.map((shortcut, shortcutIndex) => (
                  <div
                    key={shortcutIndex}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <dt className="text-sm text-foreground flex-1">
                      {shortcut.description}
                    </dt>
                    <dd className="flex items-center gap-2" dir="ltr">
                      {splitShortcutKeys(shortcut.keys).map((key, keyIndex) => (
                        <kbd
                          key={keyIndex}
                          className="px-3 py-1.5 text-sm font-semibold text-foreground bg-background border border-border rounded-md shadow-sm min-w-[2.5rem] text-center"
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

        {/* Footer */}
        <div className="sticky bottom-0 px-6 py-4 border-t bg-background">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-11 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 active:bg-primary/80 transition-colors"
          >
            {t.keyboard.closeButton}
          </button>
        </div>
      </div>
    </div>
  );
}
