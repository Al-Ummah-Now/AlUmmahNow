/**
 * Opening the header's account menu from elsewhere on the page: the "Commenting as … · Switch"
 * line opens it on the channel list, and the identity tour (components/help) opens it on the
 * view its step explains. The menu (components/UnifiedNavigation) listens; nothing else keeps
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
