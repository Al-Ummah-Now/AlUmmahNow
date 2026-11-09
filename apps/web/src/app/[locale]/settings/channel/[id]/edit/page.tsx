"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getChannelForOwner } from '@/lib/api/channels';
import { uploadFileDirect } from '@/lib/api/direct-upload';
import ImageCropDialog from '@/components/ImageCropDialog';
import { updateChannelProfile } from '@/lib/api/channel-profile';
import { getSubjectEntitlements } from '@/lib/api/entitlements';
import { maxLinksFor, type EntitlementsView } from '@/lib/entitlements/limits';
import { ChannelAboutFields, canSubmitAboutFields, type ChannelAboutValues, type HandleStatus } from '@/components/settings/ChannelAboutFields';
import { channelPath } from '@/lib/channel-url';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { logger } from '@/lib/logger-client';

interface ChannelData {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  handle?: string;
  links?: Array<{ title: string; url: string }>;
  contactEmail?: string;
  location?: string;
}

function ChannelEditPage() {
  const { t } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const channelId = params.id as string;

  const { user } = useAuth();
  // Session channels feed the navigation avatar; refresh them after changes
  const { reloadChannels } = useMultiAccount();
  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picked image waiting to be positioned/zoomed before upload
  const [cropping, setCropping] = useState<{ type: 'avatar' | 'cover'; file: File } | null>(null);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [about, setAbout] = useState<ChannelAboutValues>({ handle: '', links: [], contactEmail: '', location: '' });
  const [planView, setPlanView] = useState<EntitlementsView | null>(null);
  const [savedLinkCount, setSavedLinkCount] = useState(0);

  useEffect(() => {
    if (channelId) getSubjectEntitlements(`channel:${channelId}`).then(setPlanView);
  }, [channelId]);
  const [handleStatus, setHandleStatus] = useState<HandleStatus>({ state: 'idle' });
  const [formData, setFormData] = useState({
    name: '',
    nameEn: '',
    nameAr: '',
    description: '',
    descriptionEn: '',
    descriptionAr: '',
    avatarUrl: '',
    coverUrl: '',
  });

  // The form is filled once per channel: later profile/session refreshes must not
  // overwrite what the owner is typing
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId || initializedFor.current === channelId) return;

    const fetchChannel = async () => {
      setIsLoading(true);
      try {
        const channelData = await getChannelForOwner(channelId);

        if (channelData && initializedFor.current !== channelId) {
          initializedFor.current = channelId;
          setChannel(channelData);
          setFormData({
            name: channelData.name || '',
            nameEn: channelData.nameLocalized?.en || channelData.name || '',
            nameAr: channelData.nameLocalized?.ar || '',
            description: channelData.description || '',
            descriptionEn: channelData.descriptionLocalized?.en || channelData.description || '',
            descriptionAr: channelData.descriptionLocalized?.ar || '',
            avatarUrl: channelData.avatarUrl || '',
            coverUrl: channelData.coverUrl || '',
          });
          setSavedLinkCount(channelData.links?.length ?? 0);
          setAbout({
            handle: channelData.handle || '',
            links: channelData.links || [],
            contactEmail: channelData.contactEmail || '',
            location: channelData.location || '',
          });
        }
      } catch (error) {
        logger.error('Error fetching channel', { error, channelId });
        setError(t.errors.genericError);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChannel();
    // Load once per channel: re-running when the session or translations load would
    // overwrite what the owner has already typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelId || !user?.id) return;

    setIsSaving(true);
    setError(null);

    if (!canSubmitAboutFields(about, handleStatus)) {
      setIsSaving(false);
      return;
    }

    try {
      const result = await updateChannelProfile(channelId, {
        name: formData.nameEn || formData.name, // Legacy field (English)
        nameLocalized: {
          en: formData.nameEn,
          ar: formData.nameAr
        },
        description: formData.descriptionEn || formData.description,
        descriptionLocalized: {
          en: formData.descriptionEn || '',
          ar: formData.descriptionAr || ''
        },
        // Only send the handle when it changed (an empty field keeps the current one)
        ...(about.handle.trim() && about.handle.trim().replace(/^@+/, '') !== (channel?.handle || '') ? { handle: about.handle.trim() } : {}),
        links: about.links.filter((l) => l.title.trim() || l.url.trim()).map((l) => ({ title: l.title.trim(), url: l.url.trim() })),
        contactEmail: about.contactEmail.trim(),
        location: about.location.trim(),
      });

      if (result.ok === false) {
        logger.warn('Channel update rejected', { channelId, status: result.status, error: result.error, reason: result.reason });
        if (result.reason) setHandleStatus({ state: 'unavailable', reason: result.reason });
        setError(result.reason === 'taken' ? t.channel.handleTaken : result.status === 402 ? `${t.plan.linksReached} ${t.plan.higherPlan}` : t.channel.saveFailed);
        setIsSaving(false);
        return;
      }

      await reloadChannels();
      // A full page load rather than router.push: the session refresh above
      // queues more Server Actions (navigation profile reloads), and the App
      // Router can apply one that resolves after a client-side push on top of
      // the old route, which put the owner back on this form.
      window.location.assign(channelPath(locale, { id: channelId, handle: result.channel.handle }));
    } catch (error) {
      logger.error('Error updating channel', { error, channelId });
      setError(t.channel.saveFailed);
      setIsSaving(false);
    }
  };

  const handlePhotoUpdate = async (type: 'avatar' | 'cover', file: File) => {
    if (!channelId || !user?.id) return;

    try {
      // Show loading state
      setIsSaving(true);
      setError(null);

      // Create local preview immediately
      const previewUrl = URL.createObjectURL(file);
      if (type === 'avatar') {
        setFormData({ ...formData, avatarUrl: previewUrl });
      } else {
        setFormData({ ...formData, coverUrl: previewUrl });
      }

      // Upload straight from the browser to the API. Not via a Server Action:
      // Cloudflare's WAF rule for CVE-2025-55183 blocks some image bodies (403).
      const updatedChannel = await uploadFileDirect<ChannelData>(
        `/api/channels/${channelId}/${type === 'avatar' ? 'avatar' : 'cover'}`,
        file,
        { channelId }
      );

      if (updatedChannel) {
        // Update form data with permanent URL from server
        if (type === 'avatar') {
          setFormData({ ...formData, avatarUrl: updatedChannel.avatarUrl || '' });
        } else {
          setFormData({ ...formData, coverUrl: updatedChannel.coverUrl || '' });
        }

        // Update channel state
        setChannel(updatedChannel);
        void reloadChannels();
      } else {
        throw new Error(t.errors.uploadFailed || 'Upload failed');
      }
    } catch (error) {
      logger.error('Error uploading file', { error, type, channelId });
      setError(t.errors.genericError);

      // Revert to original URL on error
      if (channel) {
        if (type === 'avatar') {
          setFormData({ ...formData, avatarUrl: channel.avatarUrl || '' });
        } else {
          setFormData({ ...formData, coverUrl: channel.coverUrl || '' });
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!channelId || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
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
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-2">{t.errors.notFound}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{t.channel.channelNotFoundMessage}</p>
          <Link href={`/${locale}/channels`} className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            {t.common.backTo?.replace('{page}', t.channel.channels) || `${t.common.back} ${t.channel.channels}`}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        {/* Channel Banner Preview */}
        <div
          className="relative h-52 bg-gradient-to-r from-blue-500 to-purple-600 dark:from-blue-700 dark:to-purple-800 cursor-pointer group"
          onClick={() => document.getElementById('coverPhotoInput')?.click()}
        >
          {formData.coverUrl ? (
            <Image
              src={formData.coverUrl}
              alt={t.channel.channelBanner || 'Channel Banner'}
              fill
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-20 h-20 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          )}
          {/* Edit indicator - always visible */}
          <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg flex items-center gap-2 text-white pointer-events-none">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium">{t.channel.clickToChangeCover}</span>
          </div>
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <input
            type="file"
            id="coverPhotoInput"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) setCropping({ type: 'cover', file: picked });
            }}
          />
          {/* Avatar Preview */}
          <div
            className="absolute bottom-[-50px] left-5 w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700 border-4 border-gray-50 dark:border-gray-900 overflow-hidden shadow-lg cursor-pointer group/avatar"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById('avatarPhotoInput')?.click();
            }}
          >
            {formData.avatarUrl ? (
              <Image
                src={formData.avatarUrl}
                alt={formData.nameEn || 'Channel'}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                <span className="text-3xl font-bold text-white">
                  {(formData.nameEn || formData.name).charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            {/* Avatar edit indicator - always visible */}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 dark:bg-gray-800/90 rounded-full p-2">
                <svg className="w-6 h-6 text-gray-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/avatar:opacity-100 transition-opacity"></div>
            <input
              type="file"
              id="avatarPhotoInput"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) setCropping({ type: 'avatar', file: picked });
              }}
            />
          </div>
        </div>

        <ImageCropDialog
          file={cropping?.file ?? null}
          kind={cropping?.type ?? 'avatar'}
          onCancel={() => setCropping(null)}
          onApply={(cropped) => {
            const type = cropping?.type;
            setCropping(null);
            if (type) void handlePhotoUpdate(type, cropped);
          }}
        />

        {/* Channel Info & Edit Form */}
        <div className="pt-16 pb-5 px-5 bg-white dark:bg-gray-800">
          <ChannelSettingsBreadcrumb
            channelId={channelId}
            channelName={channel?.name || ''}
            locale={locale}
            currentPage="edit"
            className="mb-6"
          />
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t.channel.editChannel}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {t.channel.updateChannelInformation}
            </p>
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
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Language Tabs */}
            <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setActiveTab('en')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'en'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {t.languages.english}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ar')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'ar'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {t.languages.arabic}
              </button>
            </div>

            {/* Channel Name */}
            <div>
              <label htmlFor={`channel-name-${activeTab}`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t.channel.channelName} {activeTab === 'en' && <span className="text-red-500">*</span>}
              </label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  value={formData.nameEn}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value, name: e.target.value })}
                  required
                  maxLength={100}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t.channel.channelNameEnglish}
                  id="channel-name-en"
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  value={formData.nameAr}
                  onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                  maxLength={100}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t.channel.channelNameArabic}
                  id="channel-name-ar"
                  dir="rtl"
                />
              )}
            </div>

            {/* Description */}
            <div>
              <label htmlFor={`channel-description-${activeTab}`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t.channel.channelDescription}
              </label>
              {activeTab === 'en' && (
                <>
                  <textarea
                    value={formData.descriptionEn}
                    onChange={(e) => setFormData({ ...formData, descriptionEn: e.target.value, description: e.target.value })}
                    rows={4}
                    maxLength={500}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t.channel.channelDescriptionEnglish}
                    id="channel-description-en"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {formData.descriptionEn.length}/500 {t.channel.charactersRemaining}
                  </p>
                </>
              )}
              {activeTab === 'ar' && (
                <>
                  <textarea
                    value={formData.descriptionAr}
                    onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
                    rows={4}
                    maxLength={500}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t.channel.channelDescriptionArabic}
                    id="channel-description-ar"
                    dir="rtl"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {formData.descriptionAr.length}/500 {t.channel.charactersRemaining}
                  </p>
                </>
              )}
            </div>

            {/* Handle, links, contact, location (Story 29.1) */}
            <ChannelAboutFields
              channelId={channelId}
              currentHandle={channel.handle}
              value={about}
              onChange={setAbout}
              onHandleStatusChange={setHandleStatus}
              disabled={isSaving}
              maxLinks={maxLinksFor(planView, savedLinkCount)}
            />

            {/* Buttons */}
            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={isSaving || !canSubmitAboutFields(about, handleStatus)}
                data-testid="channel-edit-save"
                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
              >
                {isSaving ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t.upload.uploading}
                  </span>
                ) : (
                  t.channel.saveChanges
                )}
              </button>
              <Link
                href={`/${locale}/settings/channel/${channelId}`}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold transition-colors text-center flex items-center justify-center"
              >
                {t.common.cancel}
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ChannelEditPage;
