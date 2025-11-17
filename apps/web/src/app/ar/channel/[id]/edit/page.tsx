"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getChannelById, updateChannel } from '@/lib/api/channels';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { useI18n } from '@/lib/i18n';

interface ChannelData {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  coverUrl?: string;
}

function ChannelEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useI18n('ar');
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    avatarUrl: '',
    coverUrl: '',
  });

  useEffect(() => {
    params.then((resolvedParams) => {
      setChannelId(resolvedParams.id);
    });
  }, [params]);

  useEffect(() => {
    if (!channelId) return;

    const fetchChannel = async () => {
      setIsLoading(true);
      try {
        const channelData = await getChannelById(channelId);

        if (channelData) {
          setChannel(channelData);
          setFormData({
            name: channelData.name || '',
            description: channelData.description || '',
            avatarUrl: channelData.avatarUrl || '',
            coverUrl: channelData.coverUrl || '',
          });
        }
      } catch (error) {
        console.error('Error fetching channel:', error);
        setError(t.errors.genericError);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChannel();
  }, [channelId, user?.id, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelId || !user?.id) return;

    setIsSaving(true);
    setError(null);

    try {
      const userChannelId = profile?.channels?.[0] || channelId;
      await updateChannel(
        channelId,
        formData,
        { channelId: userChannelId, userId: user.id }
      );

      router.push(`/ar/channel/${channelId}`);
    } catch (error) {
      console.error('Error updating channel:', error);
      setError(t.errors.genericError);
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (!channelId || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900" dir="rtl">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900" dir="rtl">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-2">{t.errors.notFound}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">القناة التي تحاول تعديلها غير موجودة.</p>
          <Link href="/ar/profile" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            {t.common.back} إلى {t.profile.myProfile}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8" dir="rtl">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <Link href={`/ar/channel/${channelId}`} className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-4">
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19l7-7-7-7" />
            </svg>
            {t.common.back}
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t.channel.editChannel}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">تحديث معلومات قناتك</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {/* Channel Name */}
          <div className="mb-6">
            <label htmlFor="name" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {t.channel.channelName} *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              maxLength={100}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
              placeholder="أدخل اسم القناة"
            />
          </div>

          {/* Description */}
          <div className="mb-6">
            <label htmlFor="description" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {t.channel.channelDescription}
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              maxLength={500}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
              placeholder="صف قناتك"
            />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {formData.description.length}/500 حرف
            </p>
          </div>

          {/* Avatar URL */}
          <div className="mb-6">
            <label htmlFor="avatarUrl" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {t.channel.channelAvatar} URL
            </label>
            <input
              type="url"
              id="avatarUrl"
              name="avatarUrl"
              value={formData.avatarUrl}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
              placeholder="https://example.com/avatar.jpg"
              dir="ltr"
            />
          </div>

          {/* Cover URL */}
          <div className="mb-6">
            <label htmlFor="coverUrl" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              رابط صورة الغلاف
            </label>
            <input
              type="url"
              id="coverUrl"
              name="coverUrl"
              value={formData.coverUrl}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
              placeholder="https://example.com/cover.jpg"
              dir="ltr"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
            >
              {isSaving ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 ml-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t.upload.uploading}
                </span>
              ) : (
                `${t.common.save} التغييرات`
              )}
            </button>
            <Link
              href={`/ar/channel/${channelId}`}
              className="px-6 py-3 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold transition-colors text-center"
            >
              {t.common.cancel}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChannelEditPage;
