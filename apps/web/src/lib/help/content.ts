/**
 * Help content helpers (docs/features/HELP-AND-TOUR.md): inline text, the search index and where
 * each picture lives. The text itself is t.help (packages/shared-types/src/i18n-help.ts).
 */
import {
  HELP_TOPIC_FEATURES,
  HELP_TOPIC_IDS,
  type HelpBlock,
  type HelpClipId,
  type HelpPictureId,
  type HelpSection,
  type HelpTopicId,
  type HelpTranslations,
  type UserFeatureKey,
  type UserFeatures,
} from '@al-ummah/shared-types';

/** The identity tour's version: raise it when the tour changes enough to show it once more */
export const IDENTITY_TOUR_VERSION = 1;

export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; path: string };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/** `**bold**` and `[text](/path)`; anything else is plain text */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) });
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] });
    else parts.push({ kind: 'link', text: match[2], path: match[3] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

export function plainText(text: string): string {
  return parseInline(text).map((p) => p.text).join('');
}

export function isHelpTopic(value: string): value is HelpTopicId {
  return (HELP_TOPIC_IDS as readonly string[]).includes(value);
}

/** The topics this reader has: one whose feature is off is nowhere (fail closed). */
export function visibleHelpTopics(features?: UserFeatures): HelpTopicId[] {
  return HELP_TOPIC_IDS.filter((id) => {
    const feature = HELP_TOPIC_FEATURES[id];
    return !feature || features?.[feature] === true;
  });
}

export function helpHref(lang: string, topic?: HelpTopicId, section?: string): string {
  if (!topic) return `/${lang}/help`;
  return `/${lang}/help/${topic}${section ? `#${section}` : ''}`;
}

function blockText(block: HelpBlock): string[] {
  switch (block.type) {
    case 'p':
    case 'tip':
    case 'tour':
      return [plainText(block.text)];
    case 'steps':
    case 'list':
      return block.items.map(plainText);
    case 'figure':
      return [block.alt, ...(block.markers ?? [])];
    case 'clip':
      return [block.caption];
    case 'table':
      return [...block.head, ...block.rows.flatMap((row) => [row[0], row[1]])];
  }
}

/**
 * The blocks this reader sees: a block or table row about a feature that is off for them
 * is left out (features.ts, "Hidden when off"). Without `features`, nothing tied to a
 * feature is shown (fail closed).
 */
export function visibleHelpBlocks(blocks: readonly HelpBlock[], features?: UserFeatures): HelpBlock[] {
  const on = (key?: UserFeatureKey) => !key || features?.[key] === true;
  return blocks.filter((block) => on(block.feature)).map((block) =>
    block.type === 'table' ? { ...block, rows: block.rows.filter((row) => on(row[2])) } : block,
  );
}

/** The sections this reader sees: a section tagged with a feature that is off is left out (fail closed). */
export function visibleHelpSections(sections: readonly HelpSection[], features?: UserFeatures): HelpSection[] {
  return sections.filter((section) => !section.feature || features?.[section.feature] === true);
}

export interface HelpSearchEntry {
  id: string;
  topic: HelpTopicId;
  section?: string;
  label: string;
  subtitle: string;
  keywords: string[];
}

/** One entry per topic and per section, matched on headings, text and the other language's headings */
export function helpSearchEntries(help: HelpTranslations, other?: HelpTranslations, features?: UserFeatures): HelpSearchEntry[] {
  const entries: HelpSearchEntry[] = [];
  for (const topic of visibleHelpTopics(features)) {
    const page = help.topics[topic];
    entries.push({ id: topic, topic, label: page.title, subtitle: page.summary, keywords: [page.summary, other?.topics[topic].title ?? ''] });
    for (const section of visibleHelpSections(page.sections, features)) {
      const otherHeading = other?.topics[topic].sections.find((s) => s.id === section.id)?.heading ?? '';
      entries.push({
        id: `${topic}#${section.id}`,
        topic,
        section: section.id,
        label: section.heading,
        subtitle: page.title,
        keywords: [...visibleHelpBlocks(section.blocks, features).flatMap(blockText), otherHeading],
      });
    }
  }
  return entries;
}

export type HelpDevice = 'desktop' | 'phone';
export type HelpMode = 'light' | 'dark';

/** Where the capture script (e2e/help-capture) writes each picture, under apps/web/public */
export function helpPictureSrc(id: HelpPictureId, lang: string, device: HelpDevice, mode: HelpMode): string {
  return `/help/${id}.${lang}.${device}.${mode}.webp`;
}

export function helpClipSrc(id: HelpClipId, lang: string, mode: HelpMode): { video: string; poster: string } {
  return { video: `/help/clips/${id}.${lang}.${mode}.webm`, poster: `/help/clips/${id}.${lang}.${mode}.webp` };
}
