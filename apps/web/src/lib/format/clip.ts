const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** At most `max` characters, cut at a word where one is near, with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
