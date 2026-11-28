/**
 * Server-side: a CMS page's page-builder blocks (wiki AUN-CMS-PAGE-BUILDER) as HTML, with the shared
 * renderer the CMS editor preview, www and the scholar sites use (@al-ummah/shared-types page-blocks),
 * so the About page here looks like the one the editor built. Styles: @al-ummah/shared-types/page-blocks.css
 * (Fanous tokens only, so every theme and mode restyles it; logical properties for Arabic).
 *
 * This site's link rules: site paths ("/videos/") are www's pages, the same as the markdown body
 * (markdown.ts resolveHref); videos, playlists and channels open here; posts open on www. A card-post
 * grid is a www feature (paged, filtered by the reader's URL), so here it is a call to action to the
 * www page that shows it. Images come only from https (the CSP's img-src).
 */
import {
  defaultImage,
  leadsWithHero,
  renderPageBlocks,
  type ServedBlock,
  type ShelfKind,
} from '@al-ummah/shared-types';
import { resolveHref } from './markdown';
import { safeHttpUrl } from '@/lib/security/safe-input';

export interface AboutBlocksContext {
  /** The page's language. */
  locale: 'en' | 'ar';
  slug: string;
  title: string;
  /** www's origin ('' when unknown: www links and the card-post call to action are left out). */
  wwwUrl: string;
  /** The label of the call to action that stands in for a card-post grid. */
  cardsLink: string;
}

export interface AboutBlocks {
  /** Trusted HTML (the renderer escapes every text). */
  html: string;
  /** The first block is a hero: it is the page's h1, and the page shows no header of its own. */
  hero: boolean;
}

/**
 * True when the page was built with the page builder. A page that is only text (markdown blocks; a page
 * saved before blocks existed is served as one) keeps the About page's own prose card, from `body`.
 */
export function isBuiltPage(blocks: readonly ServedBlock[]): boolean {
  return blocks.some((b) => b.type !== 'markdown');
}

const WATCH: Record<ShelfKind, string> = { video: 'video', playlist: 'playlist', channel: 'channels' };

/** Card-post grids → a call to action to the www page (or nothing when www's address is unknown). */
function forThisSite(blocks: ServedBlock[], ctx: AboutBlocksContext): ServedBlock[] {
  return blocks.flatMap((b): ServedBlock[] => {
    if (b.type !== 'cards') return [b];
    if (!ctx.wwwUrl) return [];
    return [{ id: b.id, appearance: b.appearance, type: 'cta', heading: b.heading, text: null, label: ctx.cardsLink, url: `${ctx.wwwUrl}/${ctx.locale}/${encodeURIComponent(ctx.slug)}/`, tone: 'primary' }];
  });
}

export function renderAboutBlocks(blocks: ServedBlock[], ctx: AboutBlocksContext): AboutBlocks {
  const shown = forThisSite(blocks, ctx);
  const hero = leadsWithHero(shown);
  const link = { wwwUrl: ctx.wwwUrl, locale: ctx.locale };
  const html = shown.length
    ? renderPageBlocks(shown, {
        locale: ctx.locale,
        pageTitle: ctx.title,
        heroIsPageHeading: hero,
        hasCover: false,
        href: (u) => resolveHref(u, link)?.href ?? null,
        image: (ref, o) => {
          const safeUrl = safeHttpUrl(ref.url, { allowHttp: false });
          return safeUrl ? defaultImage({ ...ref, url: safeUrl }, o) : '';
        },
        watchHref: (kind, id) => (id ? `/${ctx.locale}/${WATCH[kind]}/${encodeURIComponent(id)}` : null),
        postHref: (p) => (ctx.wwwUrl && p.slug ? `${ctx.wwwUrl}/${ctx.locale}/articles/${encodeURIComponent(p.slug)}/` : null),
      })
    : '';
  return { html, hero };
}
