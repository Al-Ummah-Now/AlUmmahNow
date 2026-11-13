/**
 * The Help text (packages/shared-types/src/i18n-help.ts): English and Arabic pages have the same
 * shape, Arabic follows the wording rule, links go to real pages, and the helpers parse and index it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_AR, HELP_CLIP_IDS, HELP_EN, HELP_PICTURE_IDS, HELP_TOPIC_IDS, type HelpBlock, type HelpTranslations } from '@al-ummah/shared-types';
import { helpClipSrc, helpPictureSrc, helpSearchEntries, parseInline, plainText } from '../content';

const APP = join(__dirname, '../../../app/[locale]');
const PUBLIC = join(__dirname, '../../../../public');

function shape(help: HelpTranslations) {
  return HELP_TOPIC_IDS.map((id) => ({
    id,
    sections: help.topics[id].sections.map((s) => ({
      id: s.id,
      blocks: s.blocks.map((b: HelpBlock) => ({
        type: b.type,
        ...(b.type === 'figure' ? { picture: b.picture, markers: b.markers?.length ?? 0 } : {}),
        ...(b.type === 'clip' ? { clip: b.clip } : {}),
        ...(b.type === 'steps' || b.type === 'list' ? { items: b.items.length } : {}),
        ...(b.type === 'table' ? { rows: b.rows.length } : {}),
      })),
    })),
  }));
}

function allText(help: HelpTranslations): string {
  return JSON.stringify(help);
}

describe('Help content', () => {
  it('has the same topics, sections, pictures and list lengths in English and Arabic', () => {
    expect(shape(HELP_AR)).toEqual(shape(HELP_EN));
  });

  it('uses «مرئي / مرئيات» for video in Arabic', () => {
    expect(allText(HELP_AR)).not.toMatch(/فيديو|فيديوهات/);
  });

  it('names no lecture or library framing beyond the site’s own labels', () => {
    expect(allText(HELP_EN)).not.toMatch(/lecture|sheikh|scholar/i);
  });

  it('section ids are unique per topic and every picture and clip is used', () => {
    const used = new Set<string>();
    for (const id of HELP_TOPIC_IDS) {
      const ids = HELP_EN.topics[id].sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of HELP_EN.topics[id].sections) for (const b of s.blocks) {
        if (b.type === 'figure') used.add(`p:${b.picture}`);
        if (b.type === 'clip') used.add(`c:${b.clip}`);
      }
    }
    for (const p of HELP_PICTURE_IDS) expect(used).toContain(`p:${p}`);
    for (const c of HELP_CLIP_IDS) expect(used).toContain(`c:${c}`);
  });

  it('links only to pages that exist', () => {
    for (const help of [HELP_EN, HELP_AR]) {
      for (const match of allText(help).matchAll(/\]\((\/[^)\s]*)\)/g)) {
        expect(existsSync(join(APP, match[1], 'page.tsx'))).toBe(true);
      }
    }
  });

  it('every picture and clip has its files (run the capture script: docs/features/HELP-AND-TOUR.md)', () => {
    const missing: string[] = [];
    for (const lang of ['en', 'ar']) for (const mode of ['light', 'dark'] as const) {
      for (const id of HELP_PICTURE_IDS) for (const device of ['desktop', 'phone'] as const) {
        const src = helpPictureSrc(id, lang, device, mode);
        if (!existsSync(join(PUBLIC, src))) missing.push(src);
      }
      for (const id of HELP_CLIP_IDS) {
        const { video, poster } = helpClipSrc(id, lang, mode);
        for (const src of [video, poster]) if (!existsSync(join(PUBLIC, src))) missing.push(src);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('parseInline', () => {
  it('reads bold and links and keeps the rest as text', () => {
    expect(parseInline('Go to [Privacy & data](/settings/privacy) and select **Download**.')).toEqual([
      { kind: 'text', text: 'Go to ' },
      { kind: 'link', text: 'Privacy & data', path: '/settings/privacy' },
      { kind: 'text', text: ' and select ' },
      { kind: 'bold', text: 'Download' },
      { kind: 'text', text: '.' },
    ]);
    expect(plainText('**Acting as** a channel')).toBe('Acting as a channel');
  });
});

describe('helpSearchEntries', () => {
  it('indexes topics and sections, with the other language’s headings as keywords', () => {
    const entries = helpSearchEntries(HELP_EN, HELP_AR);
    const sw = entries.find((e) => e.id === 'identity#switch')!;
    expect(sw).toMatchObject({ topic: 'identity', section: 'switch', label: 'Switch', subtitle: HELP_EN.topics.identity.title });
    expect(sw.keywords).toContain('التبديل');
    expect(sw.keywords.join(' ')).toMatch(/Use without a channel/);
    expect(entries.filter((e) => !e.section)).toHaveLength(HELP_TOPIC_IDS.length);
  });
});
