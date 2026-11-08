'use client';

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { fetchVideoById, fetchVideos } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import { getLocalizedValue } from "@al-ummah/shared-types";

type VideoState =
  | { status: 'loading' }
  | { status: 'ready'; video: PlayerOptions }
  | { status: 'notFound' };

/**
 * Watch page body shared by /[locale]/video/[id] and the legacy
 * /[locale]/video?vid= route, so both render the same player, actions,
 * comments and related videos (LTR or RTL variants by language).
 */
export default function WatchPageContent({ videoId }: { videoId: string }) {
  const [state, setState] = useState<VideoState>({ status: 'loading' });
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
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
  const renderRelated = (keyPrefix: string) =>
    isRTL
      ? <RelatedVideosSectionRTL relatedVideos={related} />
      : <RelatedVideosSection relatedVideos={related} keyPrefix={keyPrefix} />;

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
    let cancelled = false;
    fetchVideos(null).then((videos) => {
      if (!cancelled) setRelatedVideos(videos || []);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
    <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col md:flex-row overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden">
        <div className="flex flex-col w-full lg:w-3/4 overflow-hidden">
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

              <div className="w-full max-w-4xl mt-4 px-4">
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
              </div>

              <div className="w-full max-w-4xl mt-4 px-4 flex flex-wrap items-center gap-3">
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
              </div>

              {/* Report video (hidden for anonymous viewers and the owner) */}
              {!isOwnVideo && (
                <div className={`w-full max-w-4xl mt-2 px-4 flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
                  <ReportContentButton
                    contentType="video"
                    contentId={videoId}
                    contentTitle={getLocalizedValue(videoDetails.titleLocalized, videoDetails.title, lang)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col w-full mt-6 gap-6 overflow-auto">
            <div id={COMMENTS_ID} tabIndex={-1} className="w-full max-w-4xl mx-auto px-4">
              <Comments
                key={videoId}
                videoId={videoId}
                videoOwnerId={videoDetails?.userId}
                user={user}
              />
            </div>
          </div>
        </div>

        <div className="hidden lg:block lg:w-1/4 min-w-[350px] max-w-[500px] pt-4 overflow-auto">
          {renderRelated("t_")}
        </div>
      </div>

      <div className="block lg:hidden w-full mt-4 overflow-auto">
        {renderRelated("b_")}
      </div>
    </main>
  );
}
