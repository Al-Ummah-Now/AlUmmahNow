'use client';
/**
 * The player's keyboard shortcuts dialog (docs/specs/VIDEO-PLAYER.md section 5, Layers).
 *
 * Portalled to the player layer (the body, or the fullscreen element) over a scrim, so the page
 * around the player never draws over it. A centred card in the player's menu surface: title and
 * description with a close X, then the groups in two columns (one on narrow screens), each row one
 * compact line of label and key chips. It closes with the X or Escape only; focus is trapped inside
 * and returns to the control that opened it.
 */
import { Fragment, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useVideoPlayerI18n } from '@/lib/video/i18n';
import type { SupportedLanguage } from '@/lib/video/i18n';
import { trapFocus } from '@/lib/accessibility/focus-manager';
import { PLAYER_LAYER_ATTR } from '@/lib/video/player-layer';
import { usePlayerLayerHost } from './usePlayerLayerHost';

/** Key lists use ", " in English and the Arabic comma "، " in Arabic */
export function splitShortcutKeys(keys: string): string[] {
  return keys.split(/\s*[,،]\s*/).filter(Boolean);
}

/** A combination such as "Shift+Tab" is shown as one chip per key */
export function splitKeyCombo(key: string): string[] {
  return key.length > 1 ? key.split('+').map((k) => k.trim()).filter(Boolean) : [key];
}

export interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: SupportedLanguage;
  /** The player's element: the dialog follows it into fullscreen */
  playerElement?: HTMLElement | null;
}

export function KeyboardHelpModal({ isOpen, onClose, lang = 'en', playerElement }: KeyboardHelpModalProps) {
  const { t, dir } = useVideoPlayerI18n(lang);
  const host = usePlayerLayerHost(playerElement);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes (and does not reach the player's shortcuts or exit fullscreen handlers first)
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  // Focus starts on the close button, stays inside, and returns to the opener on close
  useEffect(() => {
    if (!isOpen || !host || !dialogRef.current) return undefined;
    return trapFocus(dialogRef.current, { initialFocus: closeRef.current });
  }, [isOpen, host]);

  // The page behind does not scroll while the dialog is open
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen || !host) return null;

  const s = t.keyboard.shortcuts;
  const groups = [
    { section: t.keyboard.sections.playback, items: [s.playPause, s.next] },
    { section: t.keyboard.sections.seeking, items: [s.rewind5, s.rewind10, s.forward5, s.forward10, s.seekPercent] },
    { section: t.keyboard.sections.volume, items: [s.volumeUp, s.volumeDown, s.mute] },
    { section: t.keyboard.sections.display, items: [s.fullscreen, s.pip, s.theatre, s.captions] },
    { section: t.keyboard.sections.speed, items: [s.speedDecrease, s.speedIncrease] },
    { section: t.keyboard.sections.navigation, items: [s.tabNavigation, s.activate, s.closeDialog, s.help] },
  ];

  return createPortal(
    <div className="vjs-fanous-layer vjs-fanous-dialog-layer" dir={dir} data-testid="player-shortcuts-layer" {...{ [PLAYER_LAYER_ATTR]: '' }}>
      <div
        ref={dialogRef}
        className="vjs-fanous-dialog vjs-fanous-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        aria-describedby="keyboard-help-description"
        dir={dir}
        data-testid="player-shortcuts-dialog"
      >
        <div className="vjs-fanous-dialog-head">
          <div className="vjs-fanous-dialog-heading">
            <h2 id="keyboard-help-title" className="vjs-fanous-dialog-title">{t.keyboard.title}</h2>
            <p id="keyboard-help-description" className="vjs-fanous-dialog-description">{t.keyboard.description}</p>
          </div>
          <button ref={closeRef} type="button" className="vjs-fanous-dialog-close" onClick={onClose} aria-label={t.keyboard.closeButton} data-testid="player-shortcuts-close">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="vjs-fanous-shortcuts-body">
          <div className="vjs-fanous-shortcuts-columns">
            {groups.map((group, g) => (
              <section key={g} className="vjs-fanous-shortcuts-group" aria-labelledby={`keyboard-help-section-${g}`}>
                <h3 id={`keyboard-help-section-${g}`} className="vjs-fanous-shortcuts-heading">{group.section}</h3>
                <dl className="vjs-fanous-shortcuts-list">
                  {group.items.map((item, i) => (
                    <div key={i} className="vjs-fanous-shortcut" data-testid="player-shortcut-row">
                      <dt className="vjs-fanous-shortcut-label">{item.description}</dt>
                      <dd className="vjs-fanous-shortcut-keys" dir="ltr">
                        {splitShortcutKeys(item.keys).map((key, k) => (
                          <span key={k} className="vjs-fanous-shortcut-alt">
                            {splitKeyCombo(key).map((part, c) => (
                              <Fragment key={c}>
                                {c > 0 && <span className="vjs-fanous-shortcut-plus" aria-hidden="true">+</span>}
                                <kbd className="vjs-fanous-kbd">{part}</kbd>
                              </Fragment>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
