'use client';

/**
 * Channel header: banner, avatar, name, @handle, stats, description and the
 * subscribe button (visitors) or owner actions (owners). Direction-aware
 * (LTR/RTL from the locale).
 *
 * Settings pages render the same header. `settings` hides the subscribe and
 * owner actions; `editing` turns the banner, avatar, name, handle and
 * description into in-place editors (see components/inlineEdit).
 */

import React from 'react';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { Channel } from '@al-ummah/shared-types';
import Image from 'next/image';
import { ImagePlus } from 'lucide-react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useChannelSubscription } from '@/hooks/useChannelSubscription';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger-client';
import { getTranslations } from '@/lib/i18n';
import { getTextDirection } from '@/lib/i18n/utils';
import Link from 'next/link';
import { ChannelBellMenu } from '@/components/notifications/ChannelBellMenu';
import { ChannelOwnerActions } from '@/components/Channel/ChannelOwnerActions';
import { formatHandle, HANDLE_MAX_LENGTH } from '@/lib/channel-url';
import { InlineEditField } from '@/components/inlineEdit/InlineEditField';
import { EditableImage } from '@/components/inlineEdit/EditableImage';

export type ChannelHeaderField = 'name' | 'description' | 'handle';

/** In-place editing controls for the settings pages */
export interface ChannelHeaderEditing {
  /** Edit mode on: pencils and pickers are shown */
  active: boolean;
  /** Draft values shown in the header */
  name: string;
  description: string;
  handle: string;
  /** Direction of the language being edited (name/description) */
  textDir?: 'ltr' | 'rtl';
  /** Language label for the field names, e.g. "Channel name (Arabic)" */
  fieldSuffix?: string;
  onChange: (field: ChannelHeaderField, value: string) => void;
  /** Live handle while typing (availability check) */
  onHandleDraft?: (value: string) => void;
  handleStatus?: React.ReactNode;
  handleInvalid?: boolean;
  avatarUrl?: string;
  coverUrl?: string;
  onImage: (kind: 'avatar' | 'cover', file: File) => Promise<void> | void;
  uploading?: 'avatar' | 'cover' | null;
  dirty?: Partial<Record<ChannelHeaderField, boolean>>;
  /** Edit-mode switch, language picker, links: shown where visitors see Subscribe */
  toolbar?: React.ReactNode;
}

interface ChannelHeaderProps {
  channel: Channel;
  locale: string;
  isOwner?: boolean;
  /** Settings pages: no subscribe button and no owner actions */
  settings?: boolean;
  editing?: ChannelHeaderEditing;
  /** Shown under the details (settings pages: edit toolbar) */
  children?: React.ReactNode;
}

export function ChannelHeader({ channel, locale, isOwner = false, settings = false, editing, children }: ChannelHeaderProps) {
  // While the session loads `user` is still null: treat that as "checking", not anonymous
  const { user, loading: authLoading } = useMultiAccount();
  // Server-side ownership plus a client fallback (e.g. right after switching accounts)
  const owner = isOwner || settings || !!editing || (!!user && user.id === channel.userId);
  const t = getTranslations(locale as 'en' | 'ar');
  const dir = getTextDirection(locale) === 'rtl' ? 'rtl' : 'ltr';
  const isRTL = dir === 'rtl';
  const editMode = !!editing?.active;

  const displayName = editing ? editing.name : channel.nameLocalized?.[locale] || channel.name;
  const displayDescription = editing ? editing.description : channel.descriptionLocalized?.[locale] || channel.description;
  const handle = editing ? editing.handle : channel.handle || '';
  const coverUrl = editing ? editing.coverUrl : channel.coverUrl;
  const avatarUrl = editing ? editing.avatarUrl : channel.avatarUrl;
  const initial = (displayName || channel.name || '?').charAt(0).toUpperCase();
  const label = (base: string) => (editing?.fieldSuffix ? `${base} (${editing.fieldSuffix})` : base);

  const {
    isSubscribed,
    subscriberCount,
    isChecking: checkingSubscription,
    isUpdating: isLoading,
    error: subscriptionError,
    toggle,
  } = useChannelSubscription({
    channelId: channel.id,
    enabled: !!user && !owner,
    initialSubscriberCount: channel.subscribersCount,
  });

  const handleSubscribe = async () => {
    if (!user) {
      logger.warn('[ChannelHeader] Subscribe clicked but user not logged in');
      window.location.href = `/${locale}/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    const ok = await toggle();
    logger.info('[ChannelHeader] Subscription toggle finished', { channelId: channel.id, ok, dir });
  };

  const subscribersLabel = subscriberCount === 1 ? t.channel.subscriberSingular : t.channel.subscribers;
  const videosLabel = channel.videosCount === 1 ? t.video.videoSingular : t.video.videos;

  return (
    <div
      className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
      data-testid="channel-header"
      data-edit-mode={editing ? (editMode ? 'on' : 'off') : undefined}
      dir={dir}
    >
      {/* Channel Cover/Banner */}
      {coverUrl ? (
        <EditableImage
          kind="cover"
          editable={editMode}
          label={t.inlineEdit.changeBanner}
          uploadingLabel={t.inlineEdit.uploading}
          uploading={editing?.uploading === 'cover'}
          onUpload={(file) => editing?.onImage('cover', file)}
          className="relative w-full h-32 sm:h-48 md:h-64 lg:h-80 bg-gray-200 dark:bg-gray-800"
          testId="channel-banner"
        >
          <Image src={coverUrl} alt={`${displayName} cover`} fill className="object-cover" priority unoptimized={coverUrl.startsWith('blob:')} />
        </EditableImage>
      ) : (
        editMode && (
          <EditableImage
            kind="cover"
            editable
            label={t.inlineEdit.addBanner}
            uploadingLabel={t.inlineEdit.uploading}
            uploading={editing?.uploading === 'cover'}
            onUpload={(file) => editing?.onImage('cover', file)}
            className="relative w-full h-28 sm:h-40 bg-muted border-b border-dashed border-[var(--inline-edit-hint)]"
            testId="channel-banner"
          >
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" aria-hidden="true">
              <ImagePlus className="w-8 h-8" />
            </div>
          </EditableImage>
        )
      )}

      {/* Channel Info */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-4 sm:gap-6 items-start">
          {/* Channel Avatar: fixed square, never squeezed by long names (#300) */}
          <EditableImage
            kind="avatar"
            editable={editMode}
            label={t.inlineEdit.changeChannelPicture}
            uploading={editing?.uploading === 'avatar'}
            onUpload={(file) => editing?.onImage('avatar', file)}
            className="relative w-20 h-20 md:w-32 md:h-32 aspect-square rounded-full flex-shrink-0"
            testId="channel-avatar-editor"
          >
            <div className="relative w-full h-full rounded-full overflow-hidden bg-gray-300 dark:bg-gray-700" data-testid="channel-header-avatar">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={`${displayName} avatar`}
                  fill
                  sizes="(min-width: 768px) 128px, 80px"
                  className="object-cover"
                  unoptimized={avatarUrl.startsWith('blob:')}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl md:text-5xl font-bold text-gray-600 dark:text-gray-300">
                  {initial}
                </div>
              )}
            </div>
          </EditableImage>

          {/* Channel Details */}
          <div className={cn('flex-1 min-w-0', isRTL && 'text-right')}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {editing ? (
                  <InlineEditField
                    as="h1"
                    value={editing.name}
                    onCommit={(v) => editing.onChange('name', v.trim())}
                    label={label(t.channel.channelName)}
                    editable={editMode}
                    required={editing.textDir !== 'rtl'}
                    maxLength={100}
                    dir={editing.textDir}
                    emptyText={label(t.channel.channelName)}
                    className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white break-words"
                    dirty={editing.dirty?.name}
                    testId="channel-name"
                    inputTestId="channel-name-input"
                  />
                ) : (
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white truncate">{displayName}</h1>
                )}
                {channel.isVerified && <VerifiedBadge size="md" />}
              </div>

              {/* Subscribe Button (+ per-channel bell while subscribed) - Only show if not owner */}
              {!owner && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {user && isSubscribed && !isLoading && <ChannelBellMenu channelId={channel.id} />}
                  <button
                    onClick={handleSubscribe}
                    data-testid="channel-subscribe-button"
                    aria-pressed={isSubscribed}
                    disabled={authLoading || isLoading || checkingSubscription}
                    className={cn(
                      'px-4 py-1.5 text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg flex-shrink-0',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500',
                      isSubscribed
                        ? 'bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white'
                        : 'bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-gray-900',
                      (authLoading || isLoading || checkingSubscription) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {authLoading || isLoading || checkingSubscription ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t.common.loading}
                      </span>
                    ) : (
                      <>{isSubscribed ? t.channel.subscribed : t.channel.subscribe}</>
                    )}
                  </button>
                </div>
              )}
            </div>

            {editing ? (
              <div className="mb-1" dir="ltr">
                <InlineEditField
                  as="p"
                  value={editing.handle}
                  onCommit={(v) => editing.onChange('handle', v.replace(/^@+/, ''))}
                  onDraftChange={editing.onHandleDraft}
                  transform={(v) => v.replace(/\s/g, '')}
                  label={t.channel.handle}
                  editable={editMode}
                  prefix="@"
                  maxLength={HANDLE_MAX_LENGTH + 1}
                  placeholder={t.channel.handlePlaceholder}
                  emptyText={t.channel.handle}
                  status={editing.handleStatus}
                  invalid={editing.handleInvalid}
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  wrapperClassName={cn(isRTL && 'justify-end')}
                  dirty={editing.dirty?.handle}
                  testId="channel-handle"
                  inputTestId="channel-handle-input"
                />
              </div>
            ) : (
              handle && (
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" dir="ltr" data-testid="channel-handle">
                  {formatHandle(handle)}
                </p>
              )
            )}

            <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
              {subscriberCount !== undefined && (
                <span data-testid="channel-subscriber-count">
                  {formatSubscriberCount(subscriberCount)} {isRTL ? subscribersLabel : subscribersLabel.toLowerCase()}
                </span>
              )}
              {channel.videosCount !== undefined && channel.videosCount > 0 && (
                <>
                  <span aria-hidden="true">•</span>
                  <span>
                    {formatNumber(channel.videosCount)} {isRTL ? videosLabel : videosLabel.toLowerCase()}
                  </span>
                </>
              )}
            </div>

            {subscriptionError && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-2" role="alert">
                {subscriptionError === 'auth'
                  ? t.errors.loginRequired
                  : subscriptionError === 'channel'
                    ? t.errors.channelRequired
                    : t.errors.failedToUpdate}
                {subscriptionError === 'channel' && (
                  <>
                    {' '}
                    <Link href={`/${locale}/profile`} className="underline font-medium">
                      {t.navigation.createChannel}
                    </Link>
                  </>
                )}
              </p>
            )}

            {editing ? (
              <InlineEditField
                as="p"
                value={editing.description}
                onCommit={(v) => editing.onChange('description', v)}
                label={label(t.channel.channelDescription)}
                editable={editMode}
                multiline
                maxLength={500}
                dir={editing.textDir}
                emptyText={t.inlineEdit.addDescription}
                className={cn('text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line max-w-prose', !editMode && 'line-clamp-2')}
                wrapperClassName="mb-4"
                dirty={editing.dirty?.description}
                testId="channel-description"
                inputTestId="channel-description-input"
              />
            ) : (
              displayDescription && (
                <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-4">{displayDescription}</p>
              )
            )}

            {owner && !settings && !editing && (
              <ChannelOwnerActions
                channel={{ id: channel.id, name: channel.name, nameLocalized: channel.nameLocalized, isMain: channel.isMain }}
                className="mt-2"
              />
            )}

            {editing?.toolbar && <div className="mt-2">{editing.toolbar}</div>}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatSubscriberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}
