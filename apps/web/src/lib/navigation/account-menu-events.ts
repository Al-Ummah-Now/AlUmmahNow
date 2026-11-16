/**
 * Opening the header's account menu from elsewhere on the page: the identity tour
 * (components/help) opens it on the view its step explains. Composers never open it: identity is
 * chosen only in the header's Acting as menu (owner decision 2026-11-15). The menu (components/UnifiedNavigation) listens; nothing else keeps
 * its open state.
 */
export const ACCOUNT_MENU_EVENT = 'aun:account-menu';

export type AccountMenuView = 'main' | 'channels';

export interface AccountMenuRequest {
  /** false closes the menu */
  open: boolean;
  view?: AccountMenuView;
  /** Move keyboard focus into the menu (a person asked for it); the tour keeps focus on its card */
  focus?: boolean;
}

export function requestAccountMenu(request: AccountMenuRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AccountMenuRequest>(ACCOUNT_MENU_EVENT, { detail: request }));
}
