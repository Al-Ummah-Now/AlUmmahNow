"use client";
import React, { useState, useEffect } from "react";
import VideoPlayer from "@/components/videoPlayer/rtl/index";
import RelatedVideosSection from "@/components/related/rtl/index";
import CommentsSection from "@/components/commentsSection/index";
import { VideoMetricsDisplay } from "@/components/videoMetrics/VideoMetricsDisplay";
import { useQueryState } from "nuqs";
import { VideoInfo } from "../../../interfaces";
import { fetchVideoById, fetchVideos } from "@/lib/api/videos";
import { PlayerOptions } from "@/components/videoPlayer/interface";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useRealTimeNotifications } from "@/hooks/useRealTimeNotifications";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n('ar');
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const [vid, _setVid] = useQueryState("vid", { shallow: false });
  const path = usePathname();
  const rtl = path.indexOf('/ar') > -1;
  const { user } = useAuth();

  // Real-time notifications for demonstration
  const { addNotification } = useRealTimeNotifications({ userId: user?.id });

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);

  // Fetch video by ID from query string
  useEffect(() => {
    const fetchVideoDetails = async () => {
      if (!isMounted || !vid) return;

      const details = await fetchVideoById(vid);
      setVideoDetails(details || null);
    };

    fetchVideoDetails();
  }, [vid, isMounted]);

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      const videos = await fetchVideos(null, user?.id);
      setRelatedVideos(videos || []);
    };

    fetchRelatedVideos();
  }, [user?.id]);

  // Demo function to test notifications in Arabic
  const testNotification = () => {
    const notificationTypes = ['like', 'comment', 'subscription', 'upload', 'system'] as const;
    const randomType = notificationTypes[Math.floor(Math.random() * notificationTypes.length)];
    
    const arabicTitles = {
      like: 'إشعار إعجاب',
      comment: 'إشعار تعليق',
      subscription: 'إشعار اشتراك',
      upload: 'إشعار رفع فيديو',
      system: 'إشعار نظام'
    };
    
    const arabicMessages = {
      like: 'هذا إشعار إعجاب تجريبي لإظهار الوظائف الفورية!',
      comment: 'هذا إشعار تعليق تجريبي لإظهار الوظائف الفورية!',
      subscription: 'هذا إشعار اشتراك تجريبي لإظهار الوظائف الفورية!',
      upload: 'هذا إشعار رفع فيديو تجريبي لإظهار الوظائف الفورية!',
      system: 'هذا إشعار نظام تجريبي لإظهار الوظائف الفورية!'
    };
    
    addNotification({
      title: arabicTitles[randomType],
      message: arabicMessages[randomType],
      type: randomType,
      userId: user?.id || 'demo',
      actionUrl: '/ar/video?vid=' + (vid || 'demo')
    });
  };

  if (!vid) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8" style={{ direction: rtl ? "rtl" : "ltr" }}>
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">
            {t.video.noVideoSelected}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t.video.selectVideoMessage}
          </p>

          {/* Demo notification button */}
          {user && process.env.NODE_ENV === 'development' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">
                تجريب الميزات الفورية:
              </p>
              <Button onClick={testNotification} variant="outline">
                اختبار الإشعار
              </Button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
      <main className="flex flex-col lg:flex-row gap-4 p-4 w-full mt-0 lg:mt-0 overflow-hidden" style={{ direction: rtl ? "rtl" : "ltr" }}>
        <div className="flex flex-col w-full lg:w-3/4 overflow-hidden">
          {/* Video Player Section */}
          {videoDetails && (
            <div className="flex flex-col w-full mt-0 items-start">
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
                    console.log('📊 Video metrics updated:', metrics);
                  }}
                />
              </div>

              {/* Demo buttons for testing (development only) */}
              {process.env.NODE_ENV === 'development' && user && (
                <div className="w-full max-w-4xl mt-2 px-4">
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testNotification}
                    >
                      اختبار الإشعار
                    </Button>
                  </div>
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
          <RelatedVideosSection relatedVideos={relatedVideos} />
        </div>
      </main>

      {/* Related Videos Section (Mobile Only) */}
      <div className="block lg:hidden w-full mt-4 overflow-auto">
        <RelatedVideosSection relatedVideos={relatedVideos} />
      </div>
    </div>
  );
}
