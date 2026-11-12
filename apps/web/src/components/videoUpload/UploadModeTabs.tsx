'use client';

import React, { useRef } from 'react';
import { FileStack, FileVideo, type LucideIcon } from 'lucide-react';

export type UploadMode = 'single' | 'batch';

export const UPLOAD_MODE_TAB_ID: Record<UploadMode, string> = {
  single: 'upload-mode-tab-single',
  batch: 'upload-mode-tab-batch',
};

export const UPLOAD_MODE_PANEL_ID: Record<UploadMode, string> = {
  single: 'upload-mode-panel-single',
  batch: 'upload-mode-panel-batch',
};

interface UploadModeTabsProps {
  mode: UploadMode;
  onChange: (mode: UploadMode) => void;
  labels: {
    group: string;
    single: string;
    singleHint: string;
    batch: string;
    batchHint: string;
    /** Spoken between the label and the hint (sr-only): ", " in English, "، " in Arabic */
    separator?: string;
  };
}

const MODES: UploadMode[] = ['single', 'batch'];
const ICONS: Record<UploadMode, LucideIcon> = { single: FileVideo, batch: FileStack };

/**
 * Tabs that switch the upload page between the single-video form and the batch queue.
 * Arrow keys move focus and Enter/Space selects (manual activation), because switching
 * unmounts the form or clears the queue. Styles: `.upload-mode-*` in globals.css.
 */
export function UploadModeTabs({ mode, onChange, labels }: UploadModeTabsProps) {
  const tabRefs = useRef<Record<UploadMode, HTMLButtonElement | null>>({ single: null, batch: null });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: UploadMode) => {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const index = MODES.indexOf(current);
    let next: number | null = null;
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (index + 1) % MODES.length;
    else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MODES.length - 1;
    if (next === null) return;
    event.preventDefault();
    tabRefs.current[MODES[next]]?.focus();
  };

  return (
    <div role="tablist" aria-label={labels.group} className="upload-mode-tabs" data-testid="upload-mode-tabs">
      {MODES.map((m) => {
        const Icon = ICONS[m];
        const selected = m === mode;
        return (
          <button
            key={m}
            ref={(el) => {
              tabRefs.current[m] = el;
            }}
            type="button"
            role="tab"
            id={UPLOAD_MODE_TAB_ID[m]}
            aria-selected={selected}
            aria-controls={selected ? UPLOAD_MODE_PANEL_ID[m] : undefined}
            tabIndex={selected ? 0 : -1}
            data-testid={`upload-mode-${m}`}
            className="upload-mode-tab"
            onClick={() => {
              if (!selected) onChange(m);
            }}
            onKeyDown={(e) => handleKeyDown(e, m)}
          >
            <Icon aria-hidden="true" className="upload-mode-tab__icon" />
            <span className="upload-mode-tab__text">
              {/* Named by its content, label first then hint ("Single video, One file …"), so the name
                  holds all the visible text in order (WCAG 2.5.3). axe compares against everything
                  painted, aria-hidden or not: a name of just the label, with the hint aria-hidden,
                  fails label-content-name-mismatch. The sr-only separator keeps them apart when read; it
                  sits inside the hint, so where the hint is hidden (phones) the name is just the label. */}
              {/* The id names the mode's panel (upload page: aria-labelledby `<tab id>-label`) */}
              <span id={`${UPLOAD_MODE_TAB_ID[m]}-label`} className="upload-mode-tab__label">{m === 'single' ? labels.single : labels.batch}</span>
              <span className="upload-mode-tab__hint">
                <span className="sr-only">{labels.separator ?? ', '}</span>
                {m === 'single' ? labels.singleHint : labels.batchHint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
