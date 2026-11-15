import { splitTemplate } from './audit-model';

/**
 * A translated template with React nodes in its placeholders: `t(key, { date })` leaves
 * `{actor}` in place when no actor is passed, and this puts `<UserName …/>` there, isolated
 * (<bdi>) so a name in the other script does not reorder the sentence.
 */
export function fillNodes(template: string, nodes: Record<string, React.ReactNode>): React.ReactNode[] {
  return splitTemplate(template, Object.keys(nodes)).map((part, i) => (typeof part === 'string' ? part : <bdi key={i}>{nodes[part.slot]}</bdi>));
}
