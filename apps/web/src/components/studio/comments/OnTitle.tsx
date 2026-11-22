import type { ReactNode } from 'react';

/**
 * "On {title}": the title is isolated (a title in the other script keeps its order) and the line
 * wraps, balanced so no word sits alone on its last line, instead of cutting the title with an ellipsis.
 * A block, because text-wrap: balance only acts on a block container (on an inline span it did nothing).
 */
export function OnTitle({ template, title }: { template: string; title: ReactNode }) {
  const [before, after = ''] = template.split('{title}');
  return (
    <span className="block min-w-0 [overflow-wrap:anywhere] [text-wrap:balance]">
      {before}
      <bdi>{title}</bdi>
      {after}
    </span>
  );
}
