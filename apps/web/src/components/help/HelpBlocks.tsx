'use client';
/**
 * One Help section's blocks (t.help, packages/shared-types/src/i18n-help.ts). Pictures come in
 * light and dark and in desktop and phone sizes; the page shows the one matching the site's mode
 * and the screen width. Clips never play by themselves: they show a still and the browser's own
 * controls, so nothing moves unless the viewer asks (WCAG 2.2.2, reduced motion).
 */
import type { HelpBlock } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { helpClipSrc, helpPictureSrc, type HelpMode } from '@/lib/help/content';
import { requestIdentityTour } from '@/lib/help/tour-events';
import { HelpText } from './HelpText';

const MODES: HelpMode[] = ['light', 'dark'];

function Figure({ block, lang, markersLabel, digits }: { block: Extract<HelpBlock, { type: 'figure' }>; lang: string; markersLabel: string; digits: (n: number) => string }) {
  return (
    <figure className="hp-figure" data-testid="help-figure" data-picture={block.picture}>
      {MODES.map((mode) => (
        <picture key={mode} className="hp-shot" data-mode={mode}>
          <source media="(max-width: 640px)" srcSet={helpPictureSrc(block.picture, lang, 'phone', mode)} />
          <img src={helpPictureSrc(block.picture, lang, 'desktop', mode)} alt={block.alt} loading="lazy" decoding="async" />
        </picture>
      ))}
      {block.markers && block.markers.length > 0 && (
        <figcaption>
          <span className="hp-markers-label">{markersLabel}</span>
          <ol className="hp-markers">
            {block.markers.map((marker, i) => (
              <li key={marker}>
                <span className="hp-marker" aria-hidden="true">{digits(i + 1)}</span>
                <HelpText text={marker} lang={lang} />
              </li>
            ))}
          </ol>
        </figcaption>
      )}
    </figure>
  );
}

function Clip({ block, lang }: { block: Extract<HelpBlock, { type: 'clip' }>; lang: string }) {
  return (
    <figure className="hp-figure" data-testid="help-clip" data-clip={block.clip}>
      {MODES.map((mode) => {
        const { video, poster } = helpClipSrc(block.clip, lang, mode);
        return (
          <video key={mode} className="hp-shot hp-clip" data-mode={mode} src={video} poster={poster} controls muted loop playsInline preload="none" aria-label={block.label} />
        );
      })}
      <figcaption>{block.caption}</figcaption>
    </figure>
  );
}

export function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  const { t, lang } = useLanguage();
  const digits = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en');
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'p':
            return <p key={i}><HelpText text={block.text} lang={lang} /></p>;
          case 'tip':
            return <p key={i} className="hp-tip" role="note"><HelpText text={block.text} lang={lang} /></p>;
          case 'steps':
            return <ol key={i} className="hp-steps">{block.items.map((item) => <li key={item}><HelpText text={item} lang={lang} /></li>)}</ol>;
          case 'list':
            return <ul key={i} className="hp-list">{block.items.map((item) => <li key={item}><HelpText text={item} lang={lang} /></li>)}</ul>;
          case 'table':
            return (
              <div key={i} className="hp-table-wrap">
                <table className="hp-table">
                  <thead><tr>{block.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                  <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><HelpText text={cell} lang={lang} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          case 'figure':
            return <Figure key={i} block={block} lang={lang} markersLabel={t.help.markersLabel} digits={digits} />;
          case 'clip':
            return <Clip key={i} block={block} lang={lang} />;
          case 'tour':
            return (
              <p key={i}>
                <button type="button" className="b b-primary hp-show-me" data-testid="help-show-me" onClick={() => requestIdentityTour()}>
                  {block.text}
                </button>
              </p>
            );
        }
      })}
    </>
  );
}
