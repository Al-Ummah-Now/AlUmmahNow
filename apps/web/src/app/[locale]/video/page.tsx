'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from "react";
import VideoPlayer from "@/components/VideoPagePlayer/index";
import RelatedVideosSection from "@/components/related/index";
import CommentsSection from "@/components/commentsSection/index";
import { VideoMetricsDisplay } from "@/components/videoMetrics/VideoMetricsDisplay";
import { useQueryState } from "nuqs";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions } from "@/components/VideoPagePlayer/interface";
import { fetchVideoById, fetchVideos } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import Link from "next/link";
import { Edit } from "lucide-react";
import SaveToPlaylist from "@/components/SaveToPlaylist";
import SaveToPlaylistRTL from "@/components/SaveToPlaylist/rtl";
import { WatchLaterButton } from "@/components/library/WatchLaterButton";

export default function Home() {
  const { t, lang, isRTL } = useLanguage();
  const SaveToPlaylistControl = isRTL ? SaveToPlaylistRTL : SaveToPlaylist;
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const [vid, _setVid] = useQueryState("vid", { shallow: false });
  const { user } = useAuth();
  const [videoOwner, setVideoOwner] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);

  // Fetch video by ID from query string
  useEffect(() => {
    const fetchVideoDetails = async () => {
      if (!isMounted || !vid) return;

      const details = await fetchVideoById(vid);
      setVideoDetails(details || null);

      // Fetch full video object to get owner info
      if (vid) {
        const videoData = await fetchVideoById(vid);
        // Store video owner ID for ownership check
        // Extract userId from the video data if it exists
        setVideoOwner((videoData && 'userId' in videoData) ? (videoData as unknown as { userId: string }).userId : null);
      }
    };

    fetchVideoDetails();
  }, [vid, isMounted]);

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      const videos = await fetchVideos(null);
      setRelatedVideos(videos || []);
    };

    fetchRelatedVideos();
  }, [user?.id]);

  if (!vid) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t.video.noVideoSelected}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t.video.selectVideoMessage || 'Please select a video to watch or add a video ID to the URL.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col md:flex-row overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden">
        <div className="flex flex-col w-full lg:w-3/4 overflow-hidden">
          {/* Video Player Section */}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-center">
              <VideoPlayer options={videoDetails} />

              {/* Real-time video metrics */}
              <div className="w-full max-w-4xl mt-4 px-4">
                <VideoMetricsDisplay
                  videoId={vid}
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
                  <WatchLaterButton videoId={vid} />
                  <SaveToPlaylistControl videoId={vid} />
                </div>
              )}

              {/* Edit button for video owner */}
              {user && videoOwner && user.id === videoOwner && (
                <div className="w-full max-w-4xl mt-4 px-4">
                  <Link
                    href={`/${lang}/video/${vid}/edit`}
                    className="inline-flex items-center gap-2 px-4 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white"
                  >
                    <Edit size={20} />
                    <span>{t.video.editVideo}</span>
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Comments Section with Real-time Updates */}
          <div className="flex flex-col w-full mt-6 gap-6 overflow-auto">
            <div className="w-full max-w-4xl mx-auto px-4">
              <CommentsSection
                videoId={vid}
                initialComments={[]}
                user={user}
              />
            </div>
          </div>
        </div>

        {/* Related Videos Section */}
        <div className="hidden lg:block lg:w-1/4 min-w-[350px] max-w-[500px] pt-4 overflow-auto">
          <RelatedVideosSection relatedVideos={relatedVideos} keyPrefix="t_" />
        </div>
      </div>

      {/* Related Videos Section (Mobile Only) */}
      <div className="block lg:hidden w-full mt-4 overflow-auto">
        <RelatedVideosSection relatedVideos={relatedVideos} keyPrefix="b_" />
      </div>
    </main>
  );
}
