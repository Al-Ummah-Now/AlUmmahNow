import { ChapterNavPlaceholder } from '@/components/VideoPagePlayer/ChapterNav';
import { thumbSrcSet } from '@/lib/embed/share-image';

/** The player is the page's width below lg, about 70% of it beside the related column */
const POSTER_SIZES = '(min-width: 1024px) 70vw, 100vw';

/** What the server already knows about the video when the page starts. */
export interface WatchHint {
  title?: string;
  channelName?: string;
  /** The channel page (its @handle URL when it has one): the name links there before the player loads */
  channelHref?: string;
  channelAvatar?: string;
  /** The video's description, in the HTML for search engines and readers without JavaScript */
  description?: string;
  /** The stable same-origin poster (/thumb/<id>.jpg), never a signed CDN URL */
  poster?: string;
  /** The video's encoded size: the poster's intrinsic size (no layout shift while it loads) */
  width?: number;
  height?: number;
  /** The video has chapters: the skeleton holds the chapter bar's place under the player */
  chapters?: boolean;
}

const BLOCK = 'wsk-b animate-pulse rounded bg-muted';

/**
 * Player, title, channel, actions and description placeholders, at their final sizes. The details use the real
 * watch-details/watch-title/watch-channel classes so their spacing cannot drift from VideoDetails.
 *
 * With the server's hint this is the page's server-rendered content (wiki AUN-SEO, phase 4): the title as the
 * page's h1, the channel name linking to the channel, the description, and the poster as a real image with a high
 * fetch priority (the page's LCP element) and its intrinsic size.
 */
export function WatchDetailsSkeleton({ hint }: { hint?: WatchHint }) {
  const known = !!hint?.title;
  return (
    <div {...(known ? {} : { role: 'status', 'aria-busy': true })} className="flex flex-col w-full mt-0 items-center">
      {/* The player and, for a video with chapters, the chapter bar under it, as the loaded page's player block */}
      <div className="wsk-player-frame w-full">
        <div className="wsk-player relative w-full aspect-video overflow-hidden rounded-lg bg-muted">
          {hint?.poster && (
            // contain, not cover: a vertical or square poster is letterboxed like the player shows it, not cropped.
            // A plain img: the stable same-origin /thumb route serves it, there is nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hint.poster}
              srcSet={thumbSrcSet(hint.poster)}
              sizes={thumbSrcSet(hint.poster) ? POSTER_SIZES : undefined}
              alt=""
              width={hint.width ?? 1280}
              height={hint.height ?? 720}
              fetchPriority="high"
              loading="eager"
              decoding="async"
              className="wsk-poster absolute inset-0 h-full w-full object-contain"
              data-testid="watch-poster"
            />
          )}
        </div>
        {hint?.chapters && <ChapterNavPlaceholder />}
      </div>
      <div className="wsk-details watch-details">
        {hint?.title
          ? <h1 className="wsk-title watch-title">{hint.title}</h1>
          : <div className={`wsk-title-b ${BLOCK} w-3/4`} />}
        <div className="wsk-channel watch-channel">
          {hint?.channelAvatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={hint.channelAvatar} alt="" className="wsk-avatar h-11 w-11 rounded-full object-cover" />
            : <div className={`wsk-avatar ${BLOCK} h-11 w-11 !rounded-full`} />}
          {hint?.channelName
            ? hint.channelHref
              ? <a href={hint.channelHref} className="wsk-name watch-channel-name" data-testid="watch-skeleton-channel-link">{hint.channelName}</a>
              : <span className="wsk-name text-sm md:text-base font-medium text-muted-foreground">{hint.channelName}</span>
            : <div className={`wsk-name-b ${BLOCK} h-4 w-40`} />}
          <div className={`wsk-subscribe ${BLOCK} hidden h-9 w-24 !rounded-full`} />
        </div>
      </div>
      <div className="wsk-metrics w-full max-w-4xl mt-4 px-4 flex items-center gap-4 min-h-11">
        {[16, 12, 12, 12].map((width, index) => <div key={index} className={`${BLOCK} h-5`} style={{ width: `${width * 4}px` }} />)}
      </div>
      <div className="wsk-actions w-full max-w-4xl mt-4 px-4 flex items-center gap-3">
        {[24, 28].map((width, index) => <div key={index} className={`${BLOCK} h-[42px] !rounded-lg`} style={{ width: `${width * 4}px` }} />)}
      </div>
      {hint?.description
        // One line in the collapsed description's box (the loaded page's watch-desc), the full text in the HTML
        ? <p className="wsk-desc-text watch-desc truncate" data-testid="watch-skeleton-description">{hint.description}</p>
        : <div className={`wsk-desc ${BLOCK} hidden w-full`} />}
    </div>
  );
}

/** Placeholder for the comments section until the video is known. */
export function CommentsSkeleton() {
  return (
    <div data-testid="comments-skeleton" aria-hidden="true" className="space-y-6">
      {/* Heading row, sign-in or composer box and first comments, at the comments section's own sizes */}
      <div className={`${BLOCK} h-[29px] w-40`} />
      <div className={`${BLOCK} h-[102px] w-full !rounded-lg`} />
      <div className={`${BLOCK} h-[72px] w-full !rounded-lg`} />
    </div>
  );
}
