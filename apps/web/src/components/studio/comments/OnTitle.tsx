import type { ReactNode } from 'react';

/**
 * "On {title}": the title is isolated (a title in the other script keeps its order) and the line
 * wraps instead of cutting the title with an ellipsis.
 */
export function OnTitle({ template, title }: { template: string; title: ReactNode }) {
  const [before, after = ''] = template.split('{title}');
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {before}
      <bdi>{title}</bdi>
      {after}
    </span>
  );
}
