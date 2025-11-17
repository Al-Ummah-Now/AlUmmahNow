"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getChannelById, updateChannel } from '@/lib/api/channels';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';

interface ChannelData {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

function ChannelEditPage({ params }: { params: Promise<{ id: string }> }) {
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
    bannerUrl: '',
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
        const userChannelId = profile?.channels?.[0] || '';
        const channelData = await getChannelById(
          channelId,
          userChannelId && user?.id ? { channelId: userChannelId, userId: user.id } : undefined
        );

        if (channelData) {
          setChannel(channelData);
          setFormData({
            name: channelData.name || '',
            description: channelData.description || '',
            avatarUrl: channelData.avatarUrl || '',
            bannerUrl: channelData.bannerUrl || '',
          });
        }
      } catch (error) {
        console.error('Error fetching channel:', error);
        setError('Failed to load channel');
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

      router.push(`/en/channel/${channelId}`);
    } catch (error) {
      console.error('Error updating channel:', error);
      setError('Failed to update channel. Please try again.');
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
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading channel...</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-2">Channel not found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">The channel you're trying to edit doesn't exist.</p>
          <Link href="/en/profile" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            Back to Profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <Link href={`/en/channel/${channelId}`} className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-4">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Channel
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Edit Channel</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Update your channel information</p>
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
              Channel Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              maxLength={100}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter channel name"
            />
          </div>

          {/* Description */}
          <div className="mb-6">
            <label htmlFor="description" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              maxLength={500}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Describe your channel"
            />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {formData.description.length}/500 characters
            </p>
          </div>

          {/* Avatar URL */}
          <div className="mb-6">
            <label htmlFor="avatarUrl" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Avatar URL
            </label>
            <input
              type="url"
              id="avatarUrl"
              name="avatarUrl"
              value={formData.avatarUrl}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://example.com/avatar.jpg"
            />
          </div>

          {/* Banner URL */}
          <div className="mb-6">
            <label htmlFor="bannerUrl" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Banner URL
            </label>
            <input
              type="url"
              id="bannerUrl"
              name="bannerUrl"
              value={formData.bannerUrl}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://example.com/banner.jpg"
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
                  <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : (
                'Save Changes'
              )}
            </button>
            <Link
              href={`/en/channel/${channelId}`}
              className="px-6 py-3 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold transition-colors text-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChannelEditPage;
