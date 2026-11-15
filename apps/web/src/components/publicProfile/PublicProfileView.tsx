'use client';

/**
 * Public profile page body (Story 29.5): /{locale}/u/@{handle}.
 *
 * Server-rendered with the first page of every list the owner shows; "Show more" loads further
 * pages through the server actions. One component for both directions: logical insets and `dir`
 * (handles and the profile URL stay LTR). Colours come from the theme tokens only.
 */

import React, { useState } from 'react';
import Link from '@/components/common/AppLink';
import { publicProfileTranslations, type Channel, type Playlist, type VideoObject } from '@al-ummah/shared-types';
import { PlaylistCard } from '@/components/PlaylistCard';
import { LibraryVideoTile } from '@/components/library/LibraryVideoTile';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { channelPath, formatHandle } from '@/lib/channel-url';
import { getPublicUserLikes, getPublicUserSubscriptions, type PublicProfileChannel, type PublicUserProfile } from '@/lib/api/public-profile';
import { profileBio, profileName } from '@/lib/user-profile-metadata';
import { logger } from '@/lib/logger-client';

export interface PublicProfileInitial {
  subscriptions: { items: Channel[]; page: number; hasMore: boolean } | null;
  playlists: Playlist[] | null;
  likes: { items: VideoObject[]; nextCursor: string | null } | null;
}

interface PublicProfileViewProps {
  profile: PublicUserProfile;
  locale: string;
  initial: PublicProfileInitial;
  isOwner: boolean;
}

function joinedLabel(template: string, date: string, locale: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return template.replace('{date}', new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', { year: 'numeric', month: 'long' }).format(parsed));
}

function Avatar({ src, alt, size }: { src?: string | null; alt: string; size: 'lg' | 'sm' }) {
  const box = size === 'lg' ? 'h-24 w-24 md:h-32 md:w-32 text-4xl' : 'h-16 w-16 text-xl';
  const initial = alt.trim().charAt(0).toUpperCase();
  // A picture that fails to load falls back to the initial (never the alt text spilling out)
  const [failed, setFailed] = useState(false);
  return (
    <span className={`pp-avatar ${box} relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--fanous-color-surface-raised)] font-semibold text-[var(--fanous-color-text-secondary)]`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed CDN URLs; next/image is unoptimized here anyway
        <img src={src} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" loading={size === 'lg' ? 'eager' : 'lazy'} />
      ) : (
        <span role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>{initial}</span>
      )}
    </span>
  );
}

function Section({ id, title, count, locale, children }: { id: string; title: string; count?: number; locale: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={`profile-section-${id}`} className="pp-section rounded-xl border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-4 md:p-6">
      <h2 id={`${id}-title`} className="mb-4 flex items-baseline gap-2 text-lg font-semibold text-[var(--fanous-color-text-primary)]">
        <span>{title}</span>
        {typeof count === 'number' && count > 0 && <span className="text-sm font-normal text-[var(--fanous-color-text-muted)]">{count.toLocaleString(locale === 'ar' ? 'ar' : 'en')}</span>}
      </h2>
      {children}
    </section>
  );
}

function ChannelTile({ channel, locale }: { channel: PublicProfileChannel | Channel; locale: string }) {
  const name = channel.nameLocalized?.[locale] || channel.name;
  return (
    <Link
      href={channelPath(locale, channel)}
      data-testid="profile-channel"
      data-channel-id={channel.id}
      className="pp-channel group flex min-w-0 flex-col items-center gap-2 rounded-lg p-2 text-center hover:bg-[var(--fanous-color-surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
    >
      <Avatar src={channel.avatarUrl} alt="" size="sm" />
      <span className="flex max-w-full items-center gap-1">
        <span className="truncate text-sm font-medium text-[var(--fanous-color-text-primary)] group-hover:underline">{name}</span>
        {channel.isVerified && <VerifiedBadge size="sm" />}
      </span>
      {channel.handle && (
        <span className="max-w-full truncate text-xs text-[var(--fanous-color-text-muted)]" dir="ltr">{formatHandle(channel.handle)}</span>
      )}
    </Link>
  );
}

function ShowMore({ onClick, busy, label, testId }: { onClick: () => void; busy: boolean; label: string; testId: string }) {
  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        data-testid={testId}
        className="pp-more rounded-full border border-[var(--fanous-color-outline)] px-5 py-2 text-sm font-medium text-[var(--fanous-color-text-primary)] hover:bg-[var(--fanous-color-surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  );
}

export function PublicProfileView({ profile, locale, initial, isOwner }: PublicProfileViewProps) {
  const t = publicProfileTranslations(locale).page;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const name = profileName(profile, locale);
  const bio = profileBio(profile, locale);

  const [subs, setSubs] = useState(initial.subscriptions);
  const [subsBusy, setSubsBusy] = useState(false);
  const [subsError, setSubsError] = useState(false);
  const [likes, setLikes] = useState(initial.likes);
  const [likesBusy, setLikesBusy] = useState(false);
  const [likesError, setLikesError] = useState(false);

  const moreSubs = async () => {
    if (!subs) return;
    setSubsBusy(true);
    setSubsError(false);
    try {
      const next = await getPublicUserSubscriptions(profile.handle, subs.page + 1);
      if (!next) throw new Error('subscriptions page failed');
      setSubs({ items: [...subs.items, ...next.items], page: next.page, hasMore: next.hasMore });
    } catch (error) {
      logger.error('[PublicProfile] More subscriptions failed', { handle: profile.handle, error });
      setSubsError(true);
    } finally {
      setSubsBusy(false);
    }
  };

  const moreLikes = async () => {
    if (!likes?.nextCursor) return;
    setLikesBusy(true);
    setLikesError(false);
    try {
      const next = await getPublicUserLikes(profile.handle, likes.nextCursor);
      if (!next) throw new Error('likes page failed');
      setLikes({ items: [...likes.items, ...next.items], nextCursor: next.nextCursor });
    } catch (error) {
      logger.error('[PublicProfile] More likes failed', { handle: profile.handle, error });
      setLikesError(true);
    } finally {
      setLikesBusy(false);
    }
  };

  const errorLine = (shown: boolean) =>
    shown ? <p role="alert" className="mt-3 text-center text-sm text-[var(--fanous-color-error-text)]">{t.loadError}</p> : null;
  const empty = (text: string) => <p className="text-sm text-[var(--fanous-color-text-muted)]">{text}</p>;

  return (
    <div dir={dir} lang={locale} data-testid="public-profile" className="pp-page min-h-screen bg-[var(--fanous-color-background)]">
      {/* Banner: the user's cover, else the theme's hero gradient */}
      <div
        className="pp-banner relative h-32 w-full overflow-hidden border-b border-[var(--fanous-color-divider)] md:h-48"
        style={profile.coverUrl ? undefined : {
          // The theme's hero colours with a soft glow of its accent rising behind the avatar side
          backgroundImage: `radial-gradient(ellipse 60% 140% at ${dir === 'rtl' ? '85%' : '15%'} 120%, color-mix(in srgb, var(--fanous-color-accent) 30%, transparent), transparent 70%), linear-gradient(135deg, var(--fanous-color-hero-start), var(--fanous-color-hero-end))`,
        }}
      >
        {profile.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed CDN URL
          <img src={profile.coverUrl} alt={t.coverAlt.replace('{name}', name)} className="h-full w-full object-cover" />
        )}
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-12">
        <header className="pp-header relative -mt-12 flex flex-col gap-4 md:-mt-16 md:flex-row md:items-end" data-testid="public-profile-header">
          <span className="rounded-full border-4 border-[var(--fanous-color-background)] self-start">
            <Avatar src={profile.avatarUrl} alt={t.avatarAlt.replace('{name}', name)} size="lg" />
          </span>
          <div className="min-w-0 flex-1 md:pb-2">
            <h1 className="break-words text-2xl font-bold text-[var(--fanous-color-text-primary)] md:text-3xl" data-testid="public-profile-name">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--fanous-color-text-secondary)]">
              <span dir="ltr" data-testid="public-profile-handle">@{profile.handle}</span>
              {joinedLabel(t.joined, profile.dateCreated, locale) && (
                <span>{joinedLabel(t.joined, profile.dateCreated, locale)}</span>
              )}
            </p>
          </div>
        </header>

        {bio && <p className="mt-4 max-w-3xl whitespace-pre-line break-words text-[var(--fanous-color-text-primary)]" data-testid="public-profile-bio">{bio}</p>}

        {isOwner && (
          <div className="pp-owner mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface-raised)] px-4 py-3 text-sm" data-testid="public-profile-owner-note">
            <span className="text-[var(--fanous-color-text-secondary)]">{t.ownerNote}</span>
            <Link href={`/${locale}/settings/public-profile`} className="font-medium text-[var(--fanous-color-link)] underline-offset-2 hover:underline">
              {t.editSettings}
            </Link>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-6">
          {profile.channels.length > 0 && (
            <Section id="channels" title={t.channels} count={profile.channels.length} locale={locale}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {profile.channels.map((channel) => <ChannelTile key={channel.id} channel={channel} locale={locale} />)}
              </div>
            </Section>
          )}

          {profile.sections.playlists && (
            <Section id="playlists" title={t.playlists} count={initial.playlists?.length} locale={locale}>
              {initial.playlists === null ? errorLine(true) : initial.playlists.length === 0 ? empty(t.emptyPlaylists) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {initial.playlists.map((playlist) => <PlaylistCard key={playlist.id} {...playlist} />)}
                </div>
              )}
            </Section>
          )}

          {profile.sections.subscriptions && (
            <Section id="subscriptions" title={t.subscriptions} locale={locale}>
              {subs === null ? errorLine(true) : subs.items.length === 0 ? empty(t.emptySubscriptions) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                    {subs.items.map((channel) => <ChannelTile key={channel.id} channel={channel} locale={locale} />)}
                  </div>
                  {subs.hasMore && <ShowMore onClick={moreSubs} busy={subsBusy} label={t.showMore} testId="profile-subscriptions-more" />}
                  {errorLine(subsError)}
                </>
              )}
            </Section>
          )}

          {profile.sections.likes && (
            <Section id="likes" title={t.likes} locale={locale}>
              {likes === null ? errorLine(true) : likes.items.length === 0 ? empty(t.emptyLikes) : (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {likes.items.map((video) => <LibraryVideoTile key={video.id} video={video as never} testId="profile-liked-video" />)}
                  </div>
                  {likes.nextCursor && <ShowMore onClick={moreLikes} busy={likesBusy} label={t.showMore} testId="profile-likes-more" />}
                  {errorLine(likesError)}
                </>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

export default PublicProfileView;
