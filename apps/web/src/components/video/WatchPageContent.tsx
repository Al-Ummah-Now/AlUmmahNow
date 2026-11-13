'use client';

import { formatAbsoluteDateTime, formatViews } from '@/lib/format/videoMeta';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Player } from "video.js";
import Link from '@/components/common/AppLink';
import { Edit, Flag, MoreHorizontal, VideoOff } from "lucide-react";
import { logger } from '@/lib/logger-client';
import VideoPlayer from "@/components/VideoPagePlayer/index";
import VideoPlayerRTL from "@/components/VideoPagePlayer/rtl/index";
import RelatedVideosSection from "@/components/related/index";
import RelatedVideosSectionRTL from "@/components/related/rtl/index";
import { MAIN_CONTENT_ID, VIDEO_PLAYER_ID, COMMENTS_ID } from "@/components/SkipLinks";
import CommentsSection from "@/components/commentsSection/index";
import CommentsSectionRTL from "@/components/commentsSection/rtl/index";
import ReportContentButton from "@/components/moderation/ReportContentButton";
import { VideoMetricsDisplay } from "@/components/videoMetrics/VideoMetricsDisplay";
import SaveToPlaylist from "@/components/SaveToPlaylist";
import SaveToPlaylistRTL from "@/components/SaveToPlaylist/rtl";
import { WatchLaterButton } from "@/components/library/WatchLaterButton";
import ShareDialog from "@/components/video/ShareDialog";
import { MenuButton } from "@/components/common/MenuButton";
import { useActionRowFit } from "@/hooks/useActionRowFit";
import { parseTime } from "@/lib/embed/params";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions, isVideoProcessing } from "@/components/VideoPagePlayer/interface";
import { VideoProcessingState } from "@/components/video/VideoProcessingState";
import { fetchRelatedVideos, fetchVideoById } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { enableWatchPageFeatures, getPlayerUi, subscribePlayerUi, updatePlayerUi } from "@/lib/video/player-ui";
import { CommentsSkeleton, WatchDetailsSkeleton } from "@/components/video/WatchPageSkeleton";
import { PlaylistPane } from "@/components/video/PlaylistPane";
import { usePlaylistPlayback } from "@/hooks/usePlaylistPlayback";
import { shareableList } from "@/lib/playlists/playback";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { clearAutoplayIntent, hasAutoplayIntent, isAutoAdvance, requestAutoplay } from "@/lib/video/autoplay-intent";
import { pickUpNext, recordWatched, watchedThisSession } from "@/lib/video/up-next";
import { useAutoplaySetting } from "@/hooks/useAutoplaySetting";
import { navigateOrLoad } from "@/lib/navigation/navigate-or-load";
import { channelLabel } from '@/lib/channel-name';
import { VideoDate } from '@/components/VideoDate';

/** The list a share link carries: public playlists only, never the viewer's WL / LL (spec 2.4) */
function shareListOf(list: string | null, index: number | null): { id: string; index: number | null } | null {
  const id = shareableList(list);
  return id ? { id, index } : null;
}

/**
 * Details of a video about to play (the next item, up next), fetched ahead so a seamless next
 * swaps the source as soon as it is pressed. Taken once: a later visit fetches fresh details.
 */
const preloaded = new Map<string, Promise<PlayerOptions | undefined>>();
function preloadVideo(id: string): void {
  if (!preloaded.has(id)) preloaded.set(id, fetchVideoById(id).catch(() => undefined));
}
function loadVideo(id: string): Promise<PlayerOptions | undefined> {
  const ahead = preloaded.get(id);
  preloaded.delete(id);
  return ahead ? ahead.then((v) => v ?? fetchVideoById(id)) : fetchVideoById(id);
}
/** How long a video plays before the next one's details are fetched */
const PRELOAD_AFTER_MS = 5_000;

type VideoState =
  | { status: 'loading' }
  | { status: 'ready'; video: PlayerOptions }
  | { status: 'notFound' };

/**
 * Watch page body shared by /[locale]/video/[id] and the legacy
 * /[locale]/video?vid= route, so both render the same player, actions,
 * comments and related videos (LTR or RTL variants by language).
 */
/**
 * `skeleton` is the server's details placeholder (filled in with the video's
 * title and poster when known); without one a plain placeholder is shown.
 */
export default function WatchPageContent({ videoId, skeleton }: { videoId: string; skeleton?: React.ReactNode }) {
  const [state, setState] = useState<VideoState>({ status: 'loading' });
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedAttempt, setRelatedAttempt] = useState(0);
  const retryRelated = useCallback(() => setRelatedAttempt((attempt) => attempt + 1), []);
  const { user } = useAuth();
  const { t, lang, isRTL } = useLanguage();
  // ?t=754 / ?t=12m34s starts the video there (share links "at current time")
  const searchParams = useSearchParams();
  const startTime = parseTime(searchParams?.get('t')) ?? undefined;
  const playerRef = useRef<Player | null>(null);
  const handlePlayerReady = useCallback((player: Player) => {
    playerRef.current = player;
  }, []);
  const getCurrentTime = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) return 0;
    return player.currentTime() || 0;
  }, []);

  const Comments = isRTL ? CommentsSectionRTL : CommentsSection;
  const Player = isRTL ? VideoPlayerRTL : VideoPlayer;
  const SaveToPlaylistControl = isRTL ? SaveToPlaylistRTL : SaveToPlaylist;
  // "Up next" (the owner's "auto play like youtube"): the first related video of the same format
  // (long to long, Short to Short) not yet watched in this session, shown first in the list
  const current = state.status === 'ready' ? state.video : null;
  const currentShort = current?.isShort;
  const currentWidth = current?.width;
  const currentHeight = current?.height;
  const currentDuration = current?.duration;
  const { next, ordered: related } = useMemo(
    () => pickUpNext({ id: videoId, isShort: currentShort, width: currentWidth, height: currentHeight, duration: typeof currentDuration === 'number' ? currentDuration : undefined }, relatedVideos, watchedThisSession()),
    [videoId, relatedVideos, currentShort, currentWidth, currentHeight, currentDuration],
  );
  useEffect(() => recordWatched(videoId), [videoId]);

  // Theatre, mini player and up next belong to the watch page (docs/specs/VIDEO-PLAYER.md section 5)
  const router = useRouter();
  // The router is read through a ref so the up-next entry depends only on the next video itself:
  // a new router or related-array identity must not republish it (each publish re-renders this page)
  const routerRef = useRef(router);
  routerRef.current = router;
  // Report lives in the action row's "more" menu; its dialog is opened from there or from the player's settings
  const [reportOpen, setReportOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const { theatre } = useSyncExternalStore(subscribePlayerUi, getPlayerUi, getPlayerUi);
  useEffect(() => enableWatchPageFeatures(), []);
  const nextId = next?.id;
  const nextTitle = next?.title;
  const nextChannel = channelLabel(next, lang);
  const nextThumbnail = next?.thumbnail;
  // Playlist playback (docs/specs/PLAYLIST-PLAYBACK.md): with a list in the URL, up next is the
  // list's next item and the related video never follows the list
  const playback = usePlaylistPlayback(videoId, lang);
  const playlistUpNext = playback.upNext;
  const playlistReplay = playback.replayList;
  // Autoplay: a usable list in the URL, or an in-app advance asked for it (never a plain link, D3)
  const autoplayIntent = useMemo(() => !!playback.list || hasAutoplayIntent(videoId), [videoId, playback.list]);
  // Started by the countdown, not the viewer: counted as an autoplayed view
  const autoplayedView = useMemo(() => isAutoAdvance(videoId), [videoId]);
  // "Autoplay next" follows the signed-in viewer's account across devices
  useAutoplaySetting(user?.id);
  const suggestions = related.slice(1, 3);
  const suggestionKey = suggestions.map((v) => v.id).join(',');
  useEffect(() => clearAutoplayIntent(videoId), [videoId]);
  useEffect(() => {
    if (playback.active) {
      updatePlayerUi({ upNext: playlistUpNext, replayList: playlistReplay, suggestions: [] });
      return;
    }
    const goTo = (id: string, auto = false) => {
      requestAutoplay(id, { auto });
      navigateOrLoad((href) => routerRef.current.push(href), `/${lang}/video/${encodeURIComponent(id)}`);
    };
    updatePlayerUi({
      replayList: null,
      upNext: nextId
        ? {
            title: nextTitle ?? '',
            channel: nextChannel,
            thumbnail: nextThumbnail,
            go: (opts) => goTo(nextId, opts?.auto === true),
          }
        : null,
      suggestions: suggestions.map((v) => ({ id: v.id, title: getLocalizedValue(v.titleLocalized, v.title, lang), channel: channelLabel(v, lang), thumbnail: v.thumbnail, go: () => goTo(v.id) })),
    });
    // suggestionKey stands for the suggestions (a new array each render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.active, playlistUpNext, playlistReplay, nextId, nextTitle, nextChannel, nextThumbnail, lang, suggestionKey]);
  useEffect(() => {
    updatePlayerUi({
      reportProblem: () => setReportOpen(true),
    });
  }, []);
  // Preload what plays next: its details (so the swap starts at once) and, in a playlist, its
  // stream manifest (the URL the API chose for it), once this video has played a few seconds
  const preloadId = playback.active ? playback.nextVideo?.id ?? null : nextId ?? null;
  const preloadManifest = playback.active ? playback.nextVideo?.playUrl ?? null : null;
  useEffect(() => {
    if (!preloadId) return undefined;
    let link: HTMLLinkElement | null = null;
    const timer = window.setTimeout(() => {
      preloadVideo(preloadId);
      if (preloadManifest) {
        link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'fetch';
        link.crossOrigin = 'anonymous';
        link.href = preloadManifest;
        document.head.appendChild(link);
      }
    }, PRELOAD_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      link?.remove();
    };
  }, [preloadId, preloadManifest]);
  // One pane, placed by width: the side column from lg (the related column), else under the player
  const wide = useMediaQuery('(min-width: 1024px)');
  const renderPane = (slot: 'side' | 'below') =>
    playback.active && playback.list && (slot === 'side') === wide ? (
      <PlaylistPane
        queue={playback.queue}
        listId={playback.list}
        loop={playback.loop}
        shuffle={playback.shuffle}
        collapsed={playback.collapsed}
        canPrevious={playback.canPrevious}
        canNext={playback.canNext}
        onToggleLoop={playback.toggleLoop}
        onToggleShuffle={playback.toggleShuffle}
        onToggleCollapsed={playback.toggleCollapsed}
        onPrevious={playback.previous}
        onNext={playback.next}
        onPlay={playback.play}
        hrefFor={playback.hrefFor}
      />
    ) : null;
  const renderRelated = (keyPrefix: string) =>
    isRTL
      ? <RelatedVideosSectionRTL relatedVideos={related} loading={relatedLoading} onRetry={retryRelated} />
      : <RelatedVideosSection relatedVideos={related} keyPrefix={keyPrefix} loading={relatedLoading} onRetry={retryRelated} />;

  useEffect(() => {
    let cancelled = false;
    // Seamless next (the watch layout keeps this page and its player): the last video stays on
    // screen until the next one's details arrive, then the player swaps its source in place.
    // Only a first load (or after "not found") shows the skeleton.
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    loadVideo(videoId).then((details) => {
      if (cancelled) return;
      if (!details) logger.warn('[WatchPage] Video not found or not viewable', { videoId });
      setState(details ? { status: 'ready', video: details } : { status: 'notFound' });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    // Started alongside the video details. The shelf is related to the video,
    // so it is not requested again when the auth state settles, only when the
    // viewer asks to retry an empty shelf.
    let cancelled = false;
    setRelatedVideos([]);
    setRelatedLoading(true);
    fetchRelatedVideos(videoId)
      .then((videos) => {
        if (!cancelled) setRelatedVideos(videos);
      })
      .catch((error) => {
        logger.warn('[WatchPage] Related videos failed to load', { videoId, error });
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, relatedAttempt]);

  const videoDetails = state.status === 'ready' ? state.video : null;
  // The tab title follows the video shown. /video/[id] sets it from the server's metadata too; the
  // legacy /video?vid= route has none, and either way it must not lag behind a seamless next.
  const shownTitle = videoDetails && videoDetails.id === videoId ? getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang) : null;
  useEffect(() => {
    if (!shownTitle) return undefined;
    document.title = shownTitle;
    // The router applies a route's metadata after its own commit, which can land after this
    // effect (the legacy route's default title): put the video's title back when that happens
    const keep = new MutationObserver(() => {
      if (document.title !== shownTitle) document.title = shownTitle;
    });
    keep.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => keep.disconnect();
  }, [shownTitle]);
  // A processing video swaps in the player once its check sees it ready
  const handleProcessed = useCallback((fresh: PlayerOptions) => setState({ status: 'ready', video: fresh }), []);
  const isOwnVideo = !!user && !!videoDetails?.userId && videoDetails.userId === user.id;
  // One line of actions at every width: labels drop to icons, then the comment pill goes
  useActionRowFit(actionsRef, [videoDetails?.id, !!user, isOwnVideo, lang]);

  if (state.status === 'notFound') {
    return (
      <main
        id={MAIN_CONTENT_ID}
        className="flex flex-1 flex-col items-center justify-center p-8"
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="video-not-found"
      >
        <div className="text-center" role="alert">
          <VideoOff className="w-16 h-16 text-gray-400 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold mb-2">{t.video.videoNotFound}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{t.video.videoNotFoundDescription}</p>
          <Link href={`/${lang}`} className="text-blue-700 dark:text-blue-400 hover:underline">
            {t.navigation.home}
          </Link>
        </div>
      </main>
    );
  }

  return (
    // Below lg the related list stacks under the video (never beside it: at
    // tablet widths a side column squeezed the player to half the page). From lg
    // the player column takes what the side column leaves; the side column is
    // 300-402px of compact rows (thumbnail beside text).
    <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'} data-theatre={theatre || undefined}>
      <div className={`flex flex-col ${theatre ? '' : 'lg:flex-row'} gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden`} data-theatre={theatre || undefined} data-testid="watch-layout">
        <div className={`flex flex-col w-full min-w-0 ${theatre ? '' : 'lg:flex-1'} overflow-hidden`} data-testid="watch-primary">
          {!videoDetails && <div data-testid="watch-skeleton" className="watch-skeleton w-full">{skeleton ?? <WatchDetailsSkeleton />}</div>}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-center">
              <section id={VIDEO_PLAYER_ID} className="w-full" tabIndex={-1}>
                {isVideoProcessing(videoDetails) || videoDetails.uploadStatus === 'failed' ? (
                  <VideoProcessingState video={videoDetails} isOwner={isOwnVideo} onReady={handleProcessed} />
                ) : (
                  <Player
                    options={videoDetails}
                    startTime={startTime}
                    onPlayerReady={handlePlayerReady}
                    autoplayIntent={autoplayIntent}
                    autoplayedView={autoplayedView}
                    offerResume={playback.active}
                  />
                )}
              </section>

              <div className="watch-actions" ref={actionsRef} data-testid="watch-actions">
                <VideoMetricsDisplay
                  key={videoDetails.id}
                  videoId={videoDetails.id}
                  channelId={videoDetails.channelId || undefined}
                  initialViewCount={parseInt(videoDetails.views?.replace(/[^\d]/g, '') || '0')}
                  initialLikesCount={videoDetails.likesCount || 0}
                  initialCommentsCount={videoDetails.commentsCount || 0}
                  likes={videoDetails.likes}
                  onMetricsUpdate={(metrics) => {
                    logger.debug('[WatchPage] Video metrics updated', { metrics });
                  }}
                />
                  <ShareDialog
                    videoId={videoDetails.id}
                    title={getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang)}
                    lang={lang === 'ar' ? 'ar' : 'en'}
                    getCurrentTime={getCurrentTime}
                    list={playback.active ? shareListOf(playback.list, playback.queue.items.find((i) => i.position === playback.queue.position)?.index ?? null) : null}
                  />
                  {user && <WatchLaterButton videoId={videoDetails.id} />}
                  {user && <SaveToPlaylistControl videoId={videoDetails.id} />}
                  {isOwnVideo && (
                    <Link
                      href={`/${lang}/studio/video/${videoDetails.id}/edit`}
                      data-testid="video-owner-edit-link"
                      title={t.video.editVideo}
                    >
                      <Edit size={20} aria-hidden="true" />
                      <span className="wa-label">{t.video.editVideo}</span>
                    </Link>
                  )}
                  {user && !isOwnVideo && (
                    <MenuButton
                      label={t.a11y.moreVideoActions}
                      testId="watch-more-button"
                      items={[{
                        id: 'report',
                        label: t.reportContent.report,
                        icon: <Flag className="h-4 w-4" />,
                        testId: 'watch-more-report',
                        onSelect: () => setReportOpen(true),
                      }]}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </MenuButton>
                  )}
              </div>
              {!isOwnVideo && (
                <ReportContentButton
                  hideTrigger
                  open={reportOpen}
                  onOpenChange={setReportOpen}
                  contentType="video"
                  contentId={videoDetails.id}
                  contentTitle={getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang)}
                />
              )}
              <details className="watch-desc" open={false}>
                {/* Like the cards: views • relative time (its exact date and time in the tooltip) */}
                <summary><span>{formatViews(videoDetails.views, lang)}</span><span aria-hidden="true">•</span><VideoDate video={videoDetails} lang={lang} /></summary>
                {videoDetails.dateCreated && (
                  <p className="watch-desc-date" data-testid="watch-published">
                    {t.video.publishedAt.replace('{date}', formatAbsoluteDateTime(videoDetails.dateCreated, lang))}
                  </p>
                )}
                {videoDetails.description && <p>{videoDetails.description}</p>}
              </details>
            </div>
          )}

          {/* Below lg the playlist pane sits under the player, above the comments */}
          <div className="w-full mt-4 empty:hidden">{renderPane('below')}</div>

          <div className="flex flex-col w-full mt-6 gap-6 overflow-auto">
            <div id={COMMENTS_ID} tabIndex={-1} className="w-full max-w-4xl mx-auto px-4">
              {videoDetails ? (
              <Comments
                key={videoDetails.id}
                videoId={videoDetails.id}
                videoOwnerId={videoDetails?.userId}
                user={user}
              />
              ) : <CommentsSkeleton />}
            </div>
          </div>
        </div>

        <div className={`hidden lg:block ${theatre ? 'lg:w-full' : 'lg:flex-none lg:w-[clamp(300px,30%,402px)]'} pt-4 overflow-auto`} data-testid="watch-secondary">
          {renderPane('side')}
          {renderRelated("t_")}
        </div>
      </div>

      <div className="block lg:hidden w-full mt-4 px-4 overflow-auto" data-testid="watch-secondary-below">
        {renderRelated("b_")}
      </div>
    </main>
  );
}
