"use client";
import React, { useState, useEffect } from "react";
import VideoPlayer from "@/components/videoPlayer/index";
import RelatedVideosSection from "@/components/related/index";
import CommentsSection from "@/components/commentsSection/index";
import { VideoMetricsDisplay } from "@/components/videoMetrics/VideoMetricsDisplay";
import { useParams } from "next/navigation";
import { VideoInfo } from "@/interfaces";
import { PlayerOptions } from "@/components/videoPlayer/interface";
import { fetchVideoById, fetchVideos } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useRealTimeNotifications } from "@/hooks/useRealTimeNotifications";
import { Button } from "@/components/ui/button";

export default function VideoViewPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null);
  const params = useParams();
  const videoId = params.id as string;
  const locale = params.locale as string;
  const { user } = useAuth();

  // Real-time notifications for demonstration
  const { addNotification } = useRealTimeNotifications({ userId: user?.id });

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

  // Demo function to test notifications
  const testNotification = () => {
    const notificationTypes = ['like', 'comment', 'subscription', 'upload', 'system'] as const;
    const randomType = notificationTypes[Math.floor(Math.random() * notificationTypes.length)];

    addNotification({
      title: `Test ${randomType} notification`,
      message: `This is a demo ${randomType} notification to show real-time functionality!`,
      type: randomType,
      userId: user?.id || '',
      actionUrl: `/${locale}/video/${videoId}`
    });
  };

  if (!videoId) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">No Video Selected</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Please select a video to watch or add a video ID to the URL.
          </p>

          {/* Demo notification button */}
          {user && process.env.NODE_ENV === 'development' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">Demo Real-time Features:</p>
              <Button onClick={testNotification} variant="outline">
                Test Notification
              </Button>
            </div>
          )}
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
                  videoId={videoId}
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
                      Test Notification
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
                videoId={videoId}
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
