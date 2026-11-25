/**
 * Is the browser leaving this page for another document (a link, location.assign, a reload)?
 *
 * Leaving aborts what is still downloading. In Firefox the page keeps running until the next one
 * arrives, so React saw the aborted page stream fail ("Error in input stream") and the error
 * screen replaced the page for the last second or two, and was reported. The error boundaries ask here.
 */
interface NavigateEventLike {
  destination?: { sameDocument?: boolean };
  downloadRequest?: string | null;
}

/** A navigation that never replaced the page (a file download) stops counting after this. */
const LEAVING_MS = 15_000;

let leavingSince = 0;

export function isLeavingPage(now = Date.now()): boolean {
  return leavingSince > 0 && now - leavingSince < LEAVING_MS;
}

/** Tests only. */
export function resetLeaving(): void {
  leavingSince = 0;
}

/** Starts watching (root layout, once). The Navigation API says so before anything is aborted. */
export function watchLeaving(win: Window = window): () => void {
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
  const onNavigate = (event: Event) => {
    const e = event as Event & NavigateEventLike;
    if (e.destination?.sameDocument || e.downloadRequest != null) return;
    leavingSince = Date.now();
  };
  // Back from the back/forward cache: the page is in use again
  const onShow = () => {
    leavingSince = 0;
  };
  navigation?.addEventListener?.('navigate', onNavigate);
  win.addEventListener('pageshow', onShow);
  return () => {
    navigation?.removeEventListener?.('navigate', onNavigate);
    win.removeEventListener('pageshow', onShow);
  };
}
