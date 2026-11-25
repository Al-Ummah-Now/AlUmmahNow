/**
 * The views of a list worth a tab: one known to be empty is left out (owner rule: hide what is empty), except
 * the first (the whole list) and the current one. A count still loading, not readable or absent keeps its tab.
 */
export function shownViews<T extends { count?: number | null }>(views: readonly T[], isCurrent: (view: T) => boolean): T[] {
  return views.filter((view, i) => i === 0 || view.count !== 0 || isCurrent(view));
}
