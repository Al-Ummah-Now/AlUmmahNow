/** Meta descriptions (wiki AUN-SEO, "Page templates"): at most 160 characters, one line. */
export const META_DESCRIPTION_MAX = 160;

/** Whitespace collapsed; longer text is cut at a word near the limit and ends with an ellipsis. */
export function metaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
