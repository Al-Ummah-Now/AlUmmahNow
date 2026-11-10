'use client';

import { formatViews } from '@/lib/format/videoMeta';
import { RelativeDate } from '@/components/RelativeDate';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Player } from "video.js";
import Link from "next/link";
import { Edit, VideoOff } from "lucide-react";
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
import { parseTime } from "@/lib/embed/params";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions } from "@/components/VideoPagePlayer/interface";
import { fetchRelatedVideos, fetchVideoById } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { enableWatchPageFeatures, getPlayerUi, subscribePlayerUi, updatePlayerUi } from "@/lib/video/player-ui";
import { CommentsSkeleton, WatchDetailsSkeleton } from "@/components/video/WatchPageSkeleton";

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
  const related = relatedVideos.filter((video) => video.id !== videoId);

  // Theatre, mini player and up next belong to the watch page (docs/specs/VIDEO-PLAYER.md section 5)
  const router = useRouter();
  // The router is read through a ref so the up-next entry depends only on the next video itself:
  // a new router or related-array identity must not republish it (each publish re-renders this page)
  const routerRef = useRef(router);
  routerRef.current = router;
  const reportRef = useRef<HTMLDivElement | null>(null);
  const { theatre } = useSyncExternalStore(subscribePlayerUi, getPlayerUi, getPlayerUi);
  useEffect(() => enableWatchPageFeatures(), []);
  const next = related[0];
  const nextId = next?.id;
  const nextTitle = next?.title;
  const nextChannel = next?.channelName || '';
  const nextThumbnail = next?.thumbnail;
  useEffect(() => {
    updatePlayerUi({
      upNext: nextId
        ? {
            title: nextTitle ?? '',
            channel: nextChannel,
            thumbnail: nextThumbnail,
            go: () => routerRef.current.push(`/${lang}/video/${encodeURIComponent(nextId)}`),
          }
        : null,
    });
  }, [nextId, nextTitle, nextChannel, nextThumbnail, lang]);
  useEffect(() => {
    updatePlayerUi({
      reportProblem: () => {
        const button = reportRef.current?.querySelector<HTMLElement>('button');
        reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        button?.click();
      },
    });
  }, []);
  const renderRelated = (keyPrefix: string) =>
    isRTL
      ? <RelatedVideosSectionRTL relatedVideos={related} loading={relatedLoading} onRetry={retryRelated} />
      : <RelatedVideosSection relatedVideos={related} keyPrefix={keyPrefix} loading={relatedLoading} onRetry={retryRelated} />;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchVideoById(videoId).then((details) => {
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

  const videoDetails = state.status === 'ready' ? state.video : null;
  const isOwnVideo = !!user && !!videoDetails?.userId && videoDetails.userId === user.id;

  return (
    // Below lg the related list stacks under the video (never beside it: at
    // tablet widths a side column squeezed the player to half the page). From lg
    // the player column takes what the side column leaves; the side column is
    // 300-402px of compact rows (thumbnail beside text).
    <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'} data-theatre={theatre || undefined}>
      <div className={`flex flex-col ${theatre ? '' : 'lg:flex-row'} gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden`} data-theatre={theatre || undefined} data-testid="watch-layout">
        <div className={`flex flex-col w-full min-w-0 ${theatre ? '' : 'lg:flex-1'} overflow-hidden`} data-testid="watch-primary">
          {!videoDetails && <div data-testid="watch-skeleton" className="w-full">{skeleton ?? <WatchDetailsSkeleton />}</div>}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-center">
              <section id={VIDEO_PLAYER_ID} className="w-full" tabIndex={-1}>
                <Player
                  key={videoDetails.id}
                  options={videoDetails}
                  startTime={startTime}
                  onPlayerReady={handlePlayerReady}
                />
              </section>

              <div className="watch-actions">
                <VideoMetricsDisplay
                  key={videoDetails.id}
                  videoId={videoId}
                  channelId={videoDetails.channelId || undefined}
                  initialViewCount={parseInt(videoDetails.views?.replace(/[^\d]/g, '') || '0')}
                  initialLikesCount={videoDetails.likesCount || 0}
                  initialDislikesCount={videoDetails.dislikesCount || 0}
                  initialCommentsCount={videoDetails.commentsCount || 0}
                  likes={videoDetails.likes}
                  dislikes={videoDetails.dislikes}
                  onMetricsUpdate={(metrics) => {
                    logger.debug('[WatchPage] Video metrics updated', { metrics });
                  }}
                />
                  <ShareDialog
                    videoId={videoId}
                    title={getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang)}
                    lang={lang === 'ar' ? 'ar' : 'en'}
                    getCurrentTime={getCurrentTime}
                  />
                  {user && <WatchLaterButton videoId={videoId} />}
                  {user && <SaveToPlaylistControl videoId={videoId} />}
                  {isOwnVideo && (
                    <Link
                      href={`/${lang}/video/${videoId}/edit`}
                      data-testid="video-owner-edit-link"
                      className="inline-flex items-center gap-2 px-4 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white"
                    >
                      <Edit size={20} aria-hidden="true" />
                      <span>{t.video.editVideo}</span>
                    </Link>
                  )}
                  {!isOwnVideo && <div ref={reportRef} data-report-content><ReportContentButton
                    contentType="video"
                    contentId={videoId}
                    contentTitle={getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang)}
                  /></div>}
              </div>
              <details className="watch-desc" open={false}>
                <summary><span>{formatViews(videoDetails.views, lang)}</span> <RelativeDate value={videoDetails.dateCreated} lang={lang} /></summary>
                {videoDetails.description && <p>{videoDetails.description}</p>}
              </details>
            </div>
          )}

          <div className="flex flex-col w-full mt-6 gap-6 overflow-auto">
            <div id={COMMENTS_ID} tabIndex={-1} className="w-full max-w-4xl mx-auto px-4">
              {videoDetails ? (
              <Comments
                key={videoId}
                videoId={videoId}
                videoOwnerId={videoDetails?.userId}
                user={user}
              />
              ) : <CommentsSkeleton />}
            </div>
          </div>
        </div>

        <div className={`hidden lg:block ${theatre ? 'lg:w-full' : 'lg:flex-none lg:w-[clamp(300px,30%,402px)]'} pt-4 overflow-auto`} data-testid="watch-secondary">
          {renderRelated("t_")}
        </div>
      </div>

      <div className="block lg:hidden w-full mt-4 px-4 overflow-auto" data-testid="watch-secondary-below">
        {renderRelated("b_")}
      </div>
    </main>
  );
}
