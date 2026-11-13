'use client';
/**
 * The identity tour (docs/features/HELP-AND-TOUR.md): five steps over the real header and account
 * menu that show who you act as (yourself or a channel) and how to switch.
 *
 * - Shown once per account: after sign-in, when the account's `identityTour` (GET
 *   /api/profile/onboarding) is below IDENTITY_TOUR_VERSION, it offers itself with a small card.
 *   Finishing, skipping or "Not now" saves the version on the account, so no other device shows it.
 * - Re-openable: Help's "Take the tour" and "Show me" (requestIdentityTour).
 * - Never in the way: not on watch, Shorts, Studio, upload, live or sign-in pages, not while a
 *   dialog is open; it waits for the next page instead. Automated browsers (navigator.webdriver)
 *   never get it by themselves, so other E2E specs are not interrupted; the tour's own spec opts
 *   back in with localStorage `aun-tour-e2e=on`.
 * - Accessible: a non-modal dialog with a heading that takes focus at each step, Back/Next/Skip
 *   buttons, Escape skips, a polite live region announces "Step n of 5", the highlighted control
 *   is described by the step text, focus returns to the account button at the end; logical
 *   positions mirror in Arabic; phones dock the card to the bottom; reduced motion stops the glide.
 */
import '@/theme/help.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { logger } from '@/lib/logger-client';
import { fetchOnboarding, markIdentityTourSeen } from '@/lib/api/onboarding';
import { IDENTITY_TOUR_VERSION } from '@/lib/help/content';
import { TOUR_EVENT } from '@/lib/help/tour-events';
import { requestAccountMenu, type AccountMenuView } from '@/lib/navigation/account-menu-events';

type StepKey = 'account' | 'actingAs' | 'switch' | 'upload' | 'help';

interface StepTarget {
  selector: string;
  /** The account menu view the step needs open (closed when absent) */
  menu?: AccountMenuView;
  shape?: 'pill';
}

const TARGETS: Record<StepKey, StepTarget> = {
  account: { selector: '[data-testid="nav-menu-trigger"]', shape: 'pill' },
  actingAs: { selector: '[data-testid="nav-channel-layer"]', menu: 'main' },
  switch: { selector: '[data-testid="nav-menu"]', menu: 'channels' },
  upload: { selector: '[data-testid="header-upload"]', shape: 'pill' },
  // Help lives in the side menu (one place per destination, NAV-060); on phones the drawer is
  // closed, so this step shows its card without a highlight
  help: { selector: '[data-testid="side-nav"] a[href$="/help"]' },
};
const ALL_STEPS: StepKey[] = ['account', 'actingAs', 'switch', 'upload', 'help'];

/** Pages the tour never interrupts (playback, creating, signing in) */
const QUIET_PATHS = /^\/(?:en|ar)\/(?:video|shorts|studio|upload|live|embed|auth|profile\/create|scheduled-videos)(?:\/|$)/;
const SEEN_KEY = 'aun-tour-seen';
const E2E_OPT_IN = 'aun-tour-e2e';
const OFFER_DELAY_MS = 1200;
const CARD_GAP = 12;

type Phase = { kind: 'idle' } | { kind: 'welcome' } | { kind: 'step'; index: number; steps: StepKey[] };

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function automated(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true && storage('local')?.getItem(E2E_OPT_IN) !== 'on';
}

function visible(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
}

interface Box { top: number; left: number; width: number; height: number }

export function IdentityTour() {
  const { t, lang } = useLanguage();
  const tour = t.help.tour;
  const { user } = useMultiAccount();
  const userId = user?.id ?? null;
  const pathname = usePathname() ?? '';
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [spot, setSpot] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number; docked: boolean }>({ top: 0, left: 0, docked: true });
  const [announcement, setAnnouncement] = useState('');
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const describedRef = useRef<HTMLElement | null>(null);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const rtl = lang === 'ar';

  useEffect(() => setMounted(true), []);

  const stepKey: StepKey | null = phase.kind === 'step' ? phase.steps[phase.index] : null;

  // Offer the tour once per account
  useEffect(() => {
    if (!userId || phase.kind !== 'idle' || automated()) return undefined;
    if (storage('session')?.getItem(`${SEEN_KEY}:${userId}`)) return undefined;
    if (QUIET_PATHS.test(pathname)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchOnboarding().then((state) => {
        // Help's "Take the tour" may have started it meanwhile
        if (cancelled || phaseRef.current.kind !== 'idle' || !state || state.identityTour >= IDENTITY_TOUR_VERSION) return;
        if (dialogOpen() || QUIET_PATHS.test(window.location.pathname)) return;
        logger.debug('[IdentityTour] Offered', { userId });
        setPhase({ kind: 'welcome' });
      });
    }, OFFER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, pathname, phase.kind]);

  const begin = useCallback(() => {
    // Upload is only there for members who may upload; its step goes when it isn't
    const steps = ALL_STEPS.filter((key) => key !== 'upload' || !!visible(TARGETS.upload.selector));
    setPhase({ kind: 'step', index: 0, steps });
  }, []);

  // Help's "Take the tour" / "Show me"
  useEffect(() => {
    const onRequest = () => begin();
    window.addEventListener(TOUR_EVENT, onRequest);
    return () => window.removeEventListener(TOUR_EVENT, onRequest);
  }, [begin]);

  const finish = useCallback((reason: 'done' | 'skip' | 'later') => {
    const restore = phase.kind === 'step';
    setPhase({ kind: 'idle' });
    setSpot(null);
    setAnnouncement(tour.closed);
    requestAccountMenu({ open: false });
    if (userId) {
      storage('session')?.setItem(`${SEEN_KEY}:${userId}`, '1');
      void markIdentityTourSeen(IDENTITY_TOUR_VERSION);
    }
    logger.debug('[IdentityTour] Closed', { reason });
    // Back to where the tour started: the account button
    if (restore || reason !== 'later') {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(TARGETS.account.selector)?.focus());
    }
  }, [phase.kind, tour.closed, userId]);

  // Each step: open the menu view it needs, announce it
  useEffect(() => {
    if (phase.kind !== 'step' || !stepKey) return;
    const target = TARGETS[stepKey];
    // "Show me" further down a page: bring the header (and its menu) back into view first
    const el = visible(target.selector) ?? visible(TARGETS.account.selector);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'nearest' });
    }
    requestAccountMenu(target.menu ? { open: true, view: target.menu } : { open: false });
    const step = tour.steps[stepKey];
    setAnnouncement(`${tour.stepOf.replace('{current}', String(phase.index + 1)).replace('{total}', String(phase.steps.length))}. ${step.title}`);
  }, [phase, stepKey, tour]);

  // Follow the highlighted control (menus open a frame later; pages scroll and resize)
  useEffect(() => {
    if (phase.kind === 'idle') return undefined;
    const place = () => {
      const narrow = window.innerWidth < 640;
      const cardBox = cardRef.current?.getBoundingClientRect();
      const cardWidth = cardBox?.width ?? 340;
      const cardHeight = cardBox?.height ?? 180;
      if (phase.kind === 'welcome' || !stepKey) {
        setSpot(null);
        setCard({ top: 0, left: 0, docked: true });
        return;
      }
      const el = visible(TARGETS[stepKey].selector);
      if (describedRef.current !== el) {
        describedRef.current?.removeAttribute('aria-describedby');
        el?.setAttribute('aria-describedby', 'tour-body');
        describedRef.current = el;
      }
      if (!el) {
        setSpot(null);
        setCard({ top: 0, left: 0, docked: true });
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        // Off screen: no highlight, the card docks
        setSpot(null);
        setCard({ top: 0, left: 0, docked: true });
        return;
      }
      const pad = 4;
      setSpot({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
      if (narrow) {
        setCard({ top: 0, left: 0, docked: true });
        return;
      }
      const menu = TARGETS[stepKey].menu ? visible('[data-testid="nav-menu"]')?.getBoundingClientRect() : null;
      let top = r.bottom + CARD_GAP;
      let left = rtl ? r.left : r.right - cardWidth;
      if (menu) {
        // Beside the open menu, on the side with room (the menu sits at the header's inline end)
        const roomStart = rtl ? window.innerWidth - menu.right : menu.left;
        if (roomStart >= cardWidth + 2 * CARD_GAP) {
          left = rtl ? menu.right + CARD_GAP : menu.left - cardWidth - CARD_GAP;
          top = r.top;
        } else {
          top = menu.bottom + CARD_GAP;
        }
      }
      left = Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16));
      if (top < 16 || top + cardHeight > window.innerHeight - 16) {
        setCard({ top: 0, left: 0, docked: true });
        return;
      }
      setCard({ top, left, docked: false });
    };
    place();
    const timer = window.setInterval(place, 200);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [phase, stepKey, rtl]);

  // Focus the card's heading at each step (screen readers read the step; keyboard users start here)
  useEffect(() => {
    if (phase.kind === 'idle') return;
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }, [phase]);

  useEffect(() => () => describedRef.current?.removeAttribute('aria-describedby'), []);

  const go = (delta: 1 | -1) => {
    if (phase.kind !== 'step') return;
    const index = phase.index + delta;
    if (index >= phase.steps.length) finish('done');
    else setPhase({ ...phase, index: Math.max(0, index) });
  };

  const live = useMemo(() => (
    <p className="sr-only" role="status" aria-live="polite" data-testid="tour-live">{announcement}</p>
  ), [announcement]);

  if (!mounted) return null;
  if (phase.kind === 'idle') return createPortal(live, document.body);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish(phase.kind === 'welcome' ? 'later' : 'skip');
    }
  };

  const step = stepKey ? tour.steps[stepKey] : null;
  const total = phase.kind === 'step' ? phase.steps.length : 0;
  const position = card.docked ? undefined : { top: card.top, left: card.left };

  return createPortal(
    <>
      {spot && (
        <div
          className="tour-spot"
          data-testid="tour-spot"
          data-shape={stepKey ? TARGETS[stepKey].shape : undefined}
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        dir={rtl ? 'rtl' : 'ltr'}
        data-testid="tour-card"
        data-step={stepKey ?? 'welcome'}
        data-docked={card.docked || undefined}
        style={position}
        onKeyDown={onKeyDown}
      >
        {phase.kind === 'welcome' ? (
          <>
            <h2 id="tour-title" ref={headingRef} tabIndex={-1} className="tour-title">{tour.welcomeTitle}</h2>
            <p id="tour-body" className="tour-body">{tour.welcomeBody}</p>
            <div className="tour-actions">
              <div className="tour-buttons">
                <button type="button" className="b b-ghost" data-testid="tour-later" onClick={() => finish('later')}>{tour.notNow}</button>
                <button type="button" className="b b-primary" data-testid="tour-start" onClick={begin}>{tour.start}</button>
              </div>
            </div>
          </>
        ) : step && phase.kind === 'step' ? (
          <>
            <div className="tour-card-head">
              <h2 id="tour-title" ref={headingRef} tabIndex={-1} className="tour-title">{step.title}</h2>
              <span className="tour-step" data-testid="tour-step-count">
                {tour.stepOf
                  .replace('{current}', (phase.index + 1).toLocaleString(rtl ? 'ar-EG' : 'en'))
                  .replace('{total}', total.toLocaleString(rtl ? 'ar-EG' : 'en'))}
              </span>
            </div>
            <p id="tour-body" className="tour-body">{step.body}</p>
            <div className="tour-actions">
              <div className="tour-dots" aria-hidden="true">
                {phase.steps.map((key, i) => <span key={key} data-on={i === phase.index || undefined} />)}
              </div>
              <div className="tour-buttons">
                {phase.index < total - 1 && (
                  <button type="button" className="b b-ghost" data-testid="tour-skip" onClick={() => finish('skip')}>{tour.skip}</button>
                )}
                {phase.index > 0 && (
                  <button type="button" className="b b-ghost" data-testid="tour-back" onClick={() => go(-1)}>{tour.back}</button>
                )}
                <button type="button" className="b b-primary" data-testid="tour-next" onClick={() => go(1)}>
                  {phase.index === total - 1 ? tour.done : tour.next}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      {live}
    </>,
    document.body,
  );
}

export default IdentityTour;
