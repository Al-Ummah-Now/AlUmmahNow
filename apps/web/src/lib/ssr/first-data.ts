/**
 * Server-rendered first data (wiki AUN-SEO, phase 4): pages read the first page of their list on the
 * server so the HTML (no JavaScript) carries the titles, links and thumbnails, and the client starts
 * from it instead of fetching it again. A slow or failing API never holds the page back: past the
 * budget, or on any error, the page renders as before and the client loads the data itself.
 */

/** How long a page waits for its first data before rendering without it */
export const FIRST_DATA_BUDGET_MS = 1200;

/** The value of `load`, or undefined when it fails or takes longer than `budgetMs`. */
export async function withinBudget<T>(load: () => Promise<T | null | undefined>, budgetMs = FIRST_DATA_BUDGET_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(load).then((v) => v ?? undefined, () => undefined),
      timeout,
    ]);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
