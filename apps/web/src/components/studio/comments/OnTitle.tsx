import type { ReactNode } from 'react';

/**
 * "On {title}" on one line, the title cut with an ellipsis. The title is its own <bdi> flex item
 * that truncates; the line around it never does. WebKit's web process aborts when an ellipsis
 * line (text-overflow) holds an inline bidi isolate (<bdi>, or an inline element with dir)
 * (#1382), so never put `truncate` on the parent of an inline <bdi>.
 */
export function OnTitle({ template, title }: { template: string; title: ReactNode }) {
  const [before, after = ''] = template.split('{title}');
  return (
    <span className="flex min-w-0 items-baseline">
      {before && <span className="shrink-0 whitespace-pre">{before}</span>}
      <bdi className="min-w-0 truncate">{title}</bdi>
      {after && <span className="shrink-0 whitespace-pre">{after}</span>}
    </span>
  );
}
