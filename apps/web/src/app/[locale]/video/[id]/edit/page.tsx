'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { VideoObject } from '@/interfaces';
import { getVideoById } from '@/lib/api/videos';
import VideoEdit from '@/components/videoEdit/index';
import Link from 'next/link';

export default function VideoEditPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const videoId = params.id as string;

  const [video, setVideo] = useState<VideoObject | null>(null);
  const [loading, setLoading] = useState(true);
  // Error kind rather than text, so the fetch below does not depend on (and
  // re-run for) translation updates
  const [error, setError] = useState<'notFound' | 'forbidden' | 'genericError' | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      router.push(`/${lang}`);
    }
  }, [userId, router, lang]);

  // Fetch once per video/user; refetching on every render-time dependency
  // change replaced the video mid-edit
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const fetchVideo = async () => {
      if (!videoId) {
        setError('notFound');
        setLoading(false);
        return;
      }

      try {
        const videoData = await getVideoById(videoId);
        if (cancelled) return;

        if (!videoData) {
          setError('notFound');
          return;
        }

        // Check if user owns this video
        if (videoData.userId !== userId) {
          setError('forbidden');
          return;
        }

        setVideo(videoData);
      } catch (err) {
        logger.error('Error fetching video:', err);
        if (!cancelled) setError('genericError');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchVideo();
    return () => {
      cancelled = true;
    };
  }, [videoId, userId]);

  const handleSave = (updatedVideo: VideoObject) => {
    setVideo(updatedVideo);
    // Redirect to video page after successful save
    setTimeout(() => {
      router.push(`/${lang}/video?vid=${videoId}`);
    }, 1500);
  };

  const handleCancel = () => {
    router.push(`/${lang}/video?vid=${videoId}`);
  };

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div data-testid="video-edit-loading" className="text-lg text-gray-600 dark:text-gray-400">{t.common.loading}</div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center" data-testid="video-edit-page-error">
          <h1 className="text-2xl font-bold mb-4 dark:text-white">{t.common.error}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{t.errors[error || 'notFound']}</p>
          <Link
            href={`/${lang}/dashboard/videos`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <ArrowLeft size={20} />
            {t.common.backTo ? t.common.backTo.replace('{page}', t.video.videos || '') : 'Back to videos'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <div className="mb-6">
          <Link
            href={`/${lang}/dashboard/videos`}
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={20} />
            {t.common.backTo ? t.common.backTo.replace('{page}', t.video.myVideos || '') : 'Back to videos'}
          </Link>
        </div>

        {/* Edit Component */}
        <VideoEdit
          video={video}
          userId={user.id}
          channelId={video.channelId || user.id}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
