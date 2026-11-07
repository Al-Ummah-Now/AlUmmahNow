'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from "react";
import VideoPlayer from "@/components/VideoPagePlayer/index";
import VideoPlayerRTL from "@/components/VideoPagePlayer/rtl/index";
import RelatedVideosSection from "@/components/related/index";
import RelatedVideosSectionRTL from "@/components/related/rtl/index";
import { MAIN_CONTENT_ID, VIDEO_PLAYER_ID, COMMENTS_ID } from "@/components/SkipLinks";
import CommentsSection from "@/components/commentsSection/index";
import CommentsSectionRTL from "@/components/commentsSection/rtl/index";
import ReportContentButton from "@/components/moderation/ReportContentButton";
import { VideoMetricsDisplay } from "@/components/videoMetrics/VideoMetricsDisplay";
import { useParams } from "next/navigation";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions } from "@/components/VideoPagePlayer/interface";
import { fetchVideoById, fetchVideos } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import SaveToPlaylist from "@/components/SaveToPlaylist";
import SaveToPlaylistRTL from "@/components/SaveToPlaylist/rtl";
import { WatchLaterButton } from "@/components/library/WatchLaterButton";

export default function VideoViewPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const params = useParams();
  const videoId = params.id as string;
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();

  const Comments = isRTL ? CommentsSectionRTL : CommentsSection;
  const Player = isRTL ? VideoPlayerRTL : VideoPlayer;
  const renderRelated = (keyPrefix: string) =>
    isRTL
      ? <RelatedVideosSectionRTL relatedVideos={relatedVideos} />
      : <RelatedVideosSection relatedVideos={relatedVideos} keyPrefix={keyPrefix} />;

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);

  // Fetch video by ID from route parameter
  useEffect(() => {
    const fetchVideoDetails = async () => {
      if (!isMounted || !videoId) return;

      const details = await fetchVideoById(videoId);
      setVideoDetails(details || null);
    };

    fetchVideoDetails();
  }, [videoId, isMounted]);

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      const videos = await fetchVideos(null);
      setRelatedVideos(videos || []);
    };

    fetchRelatedVideos();
  }, [user?.id]);

  if (!videoId) {
    return (
      <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col items-center justify-center p-8" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t.video.noVideoSelected}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t.video.selectVideoMessage}
          </p>
        </div>
      </main>
    );
  }

  const isOwnVideo = !!user && !!videoDetails?.userId && videoDetails.userId === user.id;

  return (
    <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col md:flex-row overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden">
        <div className="flex flex-col w-full lg:w-3/4 overflow-hidden">
          {/* Video Player Section */}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-center">
              <section id={VIDEO_PLAYER_ID} className="w-full" tabIndex={-1}>
                <Player options={videoDetails} />
              </section>

              {/* Real-time video metrics */}
              <div className="w-full max-w-4xl mt-4 px-4">
                <VideoMetricsDisplay
                  videoId={videoId}
                  channelId={videoDetails.channel}
                  initialViewCount={parseInt(videoDetails.views?.replace(/[^\d]/g, '') || '0')}
                  initialLikesCount={videoDetails.likesCount || 0}
                  initialCommentsCount={videoDetails.commentsCount || 0}
                  onMetricsUpdate={(metrics) => {
                    logger.debug('📊 Video metrics updated:', metrics);
                  }}
                />
              </div>

              {/* Save to playlist (logged-in users with a channel) */}
              {user && (
                <div className="w-full max-w-4xl mt-4 px-4 flex flex-wrap items-start gap-3" dir={isRTL ? 'rtl' : 'ltr'}>
                  <WatchLaterButton videoId={videoId} />
                  {isRTL ? <SaveToPlaylistRTL videoId={videoId} /> : <SaveToPlaylist videoId={videoId} />}
                </div>
              )}

              {/* Report video (hidden for anonymous viewers and the owner) */}
              {!isOwnVideo && (
                <div className={`w-full max-w-4xl mt-2 px-4 flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
                  <ReportContentButton
                    contentType="video"
                    contentId={videoId}
                    contentTitle={videoDetails.title}
                  />
                </div>
              )}
            </div>
          )}

          {/* Comments Section with Real-time Updates */}
          <div className="flex flex-col w-full mt-6 gap-6 overflow-auto">
            <div id={COMMENTS_ID} tabIndex={-1} className="w-full max-w-4xl mx-auto px-4">
              <Comments
                videoId={videoId}
                videoOwnerId={videoDetails?.userId}
                user={user}
              />
            </div>
          </div>
        </div>

        {/* Related Videos Section */}
        <div className="hidden lg:block lg:w-1/4 min-w-[350px] max-w-[500px] pt-4 overflow-auto">
          {renderRelated("t_")}
        </div>
      </div>

      {/* Related Videos Section (Mobile Only) */}
      <div className="block lg:hidden w-full mt-4 overflow-auto">
        {renderRelated("b_")}
      </div>
    </main>
  );
}
