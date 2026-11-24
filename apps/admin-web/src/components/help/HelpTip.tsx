'use client';

/**
 * The "?" next to a setting's label (wiki AUN-ADMIN-HELP): a real button that opens a brief
 * frosted-glass popover (never the browser's title tooltip) with what the setting does, a one-line
 * caution when there is a real risk, and "Learn more" into the admin help guide.
 *
 * - Opens on click, tap, Enter or Space; focus moves into the popover (a non-modal dialog named by
 *   the setting), so screen readers read it. Esc closes it and puts focus back on the "?"; a click
 *   outside or tabbing out closes it.
 * - With a mouse (hover + fine pointer), resting on the "?" for a moment previews it; leaving closes
 *   the preview. A click keeps it open.
 * - One popover at a time. fitToViewport keeps it on screen (shifts, narrows, flips, caps height).
 * - Place it OUTSIDE the <label> element: a control inside a label takes the label from the input.
 * - The trigger is a focusable role="button" span, not a <button>: settings forms disable their
 *   fieldset for admins who may only read, and a disabled fieldset disables every <button> in it,
 *   but those admins still need the help. It answers Enter and Space like a button.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fitToViewport, releaseFit } from '../../../../../packages/fanous-tokens/nav/menu-fit.js';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';
import { useHelpTip } from './HelpTips';
import { RichText, plainText } from './RichText';

const OPEN_EVENT = 'aun-help-open';
const PREVIEW_DELAY_MS = 400;
const PREVIEW_LEAVE_MS = 150;

type Mode = 'closed' | 'preview' | 'open';

/**
 * Where the popover goes sideways, decided BEFORE it is shown: hanging from the "?" toward the
 * reading direction, then clamped so both edges keep the 8px gutter. A popover that stuck out past
 * the page's start edge even for a moment made an Arabic (RTL) phone scroll the whole page sideways.
 * Returns the left offset from the wrapper and the width, in px.
 */
export function placement(wrap: HTMLElement | null): { left: number; width: number } | null {
  if (!wrap || typeof window === 'undefined') return null;
  const vw = document.documentElement.clientWidth;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const width = Math.min(20 * rem, vw - 2 * GUTTER);
  const r = wrap.getBoundingClientRect();
  const rtl = getComputedStyle(wrap).direction === 'rtl';
  const wanted = rtl ? r.right + HANG - width : r.left - HANG;
  const left = Math.max(GUTTER, Math.min(wanted, vw - GUTTER - width));
  return { left: Math.round(left - r.left), width: Math.floor(width) };
}
const GUTTER = 8;
const HANG = 12;

export function HelpTip({ id, className = '' }: { id: string; className?: string }) {
  const tip = useHelpTip(id);
  const { t } = useLanguage();
  const uid = useId();
  const [mode, setMode] = useState<Mode>('closed');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnOpen = useRef(false);
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback((returnFocus: boolean) => {
    clearTimer();
    setMode('closed');
    if (returnFocus) btnRef.current?.focus();
  }, []);

  const open = useCallback(
    (next: Exclude<Mode, 'closed'>) => {
      clearTimer();
      if (next === 'open') focusOnOpen.current = true;
      setPlace(placement(wrapRef.current));
      setMode(next);
      document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: uid }));
    },
    [uid],
  );

  // Place it on screen once it is shown, and move focus in when the admin asked for it
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (mode === 'closed') {
      releaseFit(pop);
      return;
    }
    fitToViewport(pop);
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      pop?.focus({ preventScroll: true });
    }
  }, [mode]);

  // Another "?" opened: close this one. A press outside closes it.
  useEffect(() => {
    if (mode === 'closed') return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== uid) close(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [mode, uid, close]);

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!tip) logger.warn('[HelpTip] No help text for this setting on the page', { id });
  }, [tip, id]);
  if (!tip) return null;

  const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const titleId = `${uid}-title`;
  const textId = `${uid}-text`;
  const popId = `${uid}-pop`;

  return (
    <span
      ref={wrapRef}
      className={`aun-help ${className}`}
      data-testid="help-tip"
      data-help-id={id}
      data-state={mode}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && mode !== 'closed') {
          e.stopPropagation();
          close(true);
        }
      }}
      onBlur={(e) => {
        if (mode !== 'closed' && !wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
      onMouseEnter={() => {
        if (mode !== 'closed' || !canHover()) return;
        clearTimer();
        timer.current = setTimeout(() => open('preview'), PREVIEW_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (mode === 'open') return;
        clearTimer();
        if (mode === 'preview') timer.current = setTimeout(() => close(false), PREVIEW_LEAVE_MS);
      }}
    >
      <span
        ref={btnRef}
        role="button"
        tabIndex={0}
        className="aun-help-btn"
        aria-label={t('adminHelp.buttonLabel', { label: plainText(tip.label) })}
        aria-expanded={mode !== 'closed'}
        aria-controls={popId}
        data-testid="help-tip-button"
        onClick={(e) => {
          e.preventDefault(); // never also activate a surrounding label
          if (mode === 'open') close(false);
          else open('open');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (mode === 'open') close(false);
            else open('open');
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </span>
      <div
        ref={popRef}
        id={popId}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        hidden={mode === 'closed'}
        className="aun-help-pop aun-glass-panel"
        style={place ? { left: place.left, right: 'auto', insetInlineStart: 'auto', inlineSize: place.width } : undefined}
        data-testid="help-tip-popover"
      >
        <p className="aun-help-title" id={titleId}>
          {tip.label}
        </p>
        <p className="aun-help-text" id={textId}>
          <RichText text={tip.summary} />
        </p>
        {tip.tipCaution && (
          <p className="aun-help-caution" data-testid="help-tip-caution">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <span>
              <span className="sr-only">{t('adminHelp.cautionLabel')} </span>
              <RichText text={tip.tipCaution} />
            </span>
          </p>
        )}
        <a className="aun-help-more" href={tip.href} data-testid="help-tip-more">
          {t('adminHelp.learnMore')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
    </span>
  );
}

/**
 * A setting's label with its "?": the label element stays a real label for the control
 * (`htmlFor`), the button sits beside it.
 */
export function SettingLabel({
  htmlFor,
  helpId,
  children,
  className = 'text-sm font-medium text-fg',
  as = 'label',
}: {
  htmlFor?: string;
  helpId: string;
  children: React.ReactNode;
  className?: string;
  /** 'span' for a label that wraps its own control elsewhere, 'legend' text inside a fieldset */
  as?: 'label' | 'span';
}) {
  const Tag = as;
  return (
    <span className="inline-flex items-center">
      <Tag {...(as === 'label' ? { htmlFor } : {})} className={className}>
        {children}
      </Tag>
      <HelpTip id={helpId} />
    </span>
  );
}
