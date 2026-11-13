/**
 * Starting the identity tour from anywhere (Help's "Take the tour", a page's "Show me"): the tour
 * (components/help/IdentityTour.tsx, mounted once in the app shell) listens.
 */
export const TOUR_EVENT = 'aun:identity-tour';

export function requestIdentityTour(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}
