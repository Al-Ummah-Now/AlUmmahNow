import type { ReactNode } from 'react';

/**
 * "On {title}" on one line: the words around the title stay whole and the title (isolated, so a
 * title in the other script keeps its order) is the part that gets cut to fit.
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
