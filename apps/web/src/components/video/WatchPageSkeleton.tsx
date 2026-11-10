/** What the server already knows about the video when the page starts. */
export interface WatchHint {
  title?: string;
  channelName?: string;
  channelAvatar?: string;
  poster?: string;
}

const BLOCK = 'wsk-b animate-pulse rounded bg-muted';

/** Player, title, channel, actions and description placeholders, at their final sizes. */
export function WatchDetailsSkeleton({ hint }: { hint?: WatchHint }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col w-full mt-0 items-center">
      <div className="wsk-player w-full aspect-video rounded-lg bg-muted bg-cover bg-center" style={hint?.poster ? { backgroundImage: `url("${hint.poster}")` } : undefined} />
      <div className="wsk-details mt-4 w-full">
        {hint?.title
          ? <p className="wsk-title text-lg md:text-xl font-semibold text-foreground mb-3">{hint.title}</p>
          : <div className={`wsk-title-b ${BLOCK} mb-3 h-7 w-3/4`} />}
        <div className="wsk-channel flex items-center gap-3 min-h-11">
          {hint?.channelAvatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={hint.channelAvatar} alt="" className="wsk-avatar h-11 w-11 rounded-full object-cover" />
            : <div className={`wsk-avatar ${BLOCK} h-11 w-11 !rounded-full`} />}
          {hint?.channelName
            ? <span className="wsk-name text-sm md:text-base font-medium text-muted-foreground">{hint.channelName}</span>
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
      <div className={`wsk-desc ${BLOCK} hidden w-full`} />
    </div>
  );
}

/** Placeholder for the comments section until the video is known. */
export function CommentsSkeleton() {
  return (
    <div data-testid="comments-skeleton" aria-hidden="true" className="min-h-60 space-y-4">
      <div className={`${BLOCK} h-7 w-40`} />
      <div className={`${BLOCK} h-24 w-full !rounded-lg`} />
    </div>
  );
}
