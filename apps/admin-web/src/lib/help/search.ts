/**
 * The admin guide's search (wiki AUN-ADMIN-HELP), shared by the live box and the ?q= results page.
 */
export interface HelpSearchItem {
  href: string;
  label: string;
  area: string;
  summary: string;
}

/** Folds case and Arabic letter forms so «اعداد» finds «إعداد». */
export function fold(text: string): string {
  return text
    .replace(/`/g, '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\p{M}/gu, '');
}

export function matchHelp(items: readonly HelpSearchItem[], query: string): HelpSearchItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  const scored = items
    .map((item) => {
      const label = fold(item.label);
      const rest = fold(`${item.area} ${item.summary}`);
      if (!words.every((w) => label.includes(w) || rest.includes(w))) return null;
      return { item, score: words.filter((w) => label.includes(w)).length };
    })
    .filter((x): x is { item: HelpSearchItem; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.item);
}
