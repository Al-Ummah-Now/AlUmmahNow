'use client';

/**
 * Leave guard without browser prompts.
 *
 * While `active`, a click on a link that would leave this page opens the in-app
 * confirm dialog instead of navigating; "Leave" then follows the link. Closing
 * the tab or reloading is not intercepted (that would need a beforeunload
 * prompt, which this app never shows).
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * The URL a click would navigate this tab to, or null when the click does not
 * leave the page (modified click, new tab, download, same-page anchor).
 */
export function leavingHref(event: MouseEvent, current: URL): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute('download')) return null;
  const frame = anchor.getAttribute('target');
  if (frame && frame !== '_self') return null;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute('href') ?? '', current);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Only the hash changes: the page stays
  if (url.origin === current.origin && url.pathname === current.pathname && url.search === current.search) return null;
  return url;
}

export function useLeaveGuard(active: boolean, message: string): ReactNode {
  const { t } = useLanguage();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const state = useRef({ active, message });
  state.current = { active, message };

  const ask = useCallback(
    async (url: URL) => {
      const leave = await confirm({
        title: t.confirmDialog.leaveTitle,
        description: state.current.message,
        confirmLabel: t.confirmDialog.leave,
        cancelLabel: t.confirmDialog.stay,
        testId: 'leave-guard',
      });
      if (!leave) return;
      if (url.origin === window.location.origin) router.push(`${url.pathname}${url.search}${url.hash}`);
      else window.location.assign(url.href);
    },
    [confirm, router, t]
  );

  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      if (!state.current.active) return;
      const url = leavingHref(event, new URL(window.location.href));
      if (!url) return;
      // Capture phase on document: runs before Next's <Link> handler
      event.preventDefault();
      event.stopPropagation();
      void ask(url);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, ask]);

  return dialog;
}
