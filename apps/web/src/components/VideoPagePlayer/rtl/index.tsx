"use client";
import { VerifiedBadge } from '@/components/VerifiedBadge';
import React, { useMemo } from "react";
import type { Player } from "video.js";
import Image from "next/image";
import Link from "next/link";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";
import { playerChannelHref, playerChannelName } from "@/lib/video/player-channel";

interface WatchPlayerProps {
  options: PlayerOptions;
  /** Start position in seconds (?t= on the watch page) */
  startTime?: number;
  /** Gives the watch page the Video.js player (share "start at current time") */
  onPlayerReady?: (player: Player) => void;
}

const VideoPlayerRTL: React.FC<WatchPlayerProps> = ({ options, startTime, onPlayerReady }) => {
  const { user } = useAuth();
  const { t } = useLanguage();

  const title = getLocalizedValue(options.titleLocalized, options.title, 'ar');

  // Convert PlayerOptions to CustomVideoPlayer props. Same source resolution as
  // the LTR variant (API playUrl first) and memoized so re-renders don't hand
  // the player a new sources array, which would reload the video.
  const videoSources = useMemo(() => [
    {
      src: options.playUrl || '',
      type: 'application/x-mpegURL'
    }
  ], [options.playUrl, options.id]);

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  const posterUrl = useMemo(() => {
    // Bunny keeps the thumbnail next to the playlist, so derive it from this
    // video's own library (QA/prod differ) rather than a hard-coded host.
    const derived = options.playUrl?.endsWith('/playlist.m3u8')
      ? options.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg')
      : '';
    const poster = options.poster || derived;
    if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
      return `https://${poster}`;
    }
    return poster;
  }, [options.poster, options.id]);

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900" dir="rtl">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* New Custom Video.js Player with Arabic/RTL support */}
          <VideoPlayerWithChapters
            videoId={options.id}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            lang="ar"
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
            title={removeUnwantedChars(title)}
            startTime={startTime}
            onPlayerReady={onPlayerReady}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="flex space-x-4 mt-4 justify-start items-center w-full" dir="rtl">
        {(() => {
          const href = playerChannelHref('ar', options);
          const avatar = (
            <Image
              src={options.channelAvatar || '/avatar.png'}
              alt={t.a11y.channelAvatar.replace('{channel}', removeUnwantedChars(playerChannelName(options)))}
              sizes="44px"
              className="bg-gray-500 object-cover"
              fill
            />
          );
          const avatarEl = href ? (
            <Link href={href} data-testid="watch-channel-link" className="w-11 h-11 shrink-0 rounded-full overflow-hidden relative hover:opacity-80 transition-opacity">
              {avatar}
            </Link>
          ) : (
            <span className="w-11 h-11 shrink-0 rounded-full overflow-hidden relative">{avatar}</span>
          );
          return options.channelVerified ? (
            <span className="inline-flex items-center gap-1">
              {avatarEl}
              <VerifiedBadge />
            </span>
          ) : avatarEl;
        })()}
        <div className="mt-4">
          <h1 className="sm:text-md md:text-xl font-semibold text-black dark:text-white">
            {removeUnwantedChars(title)}
          </h1>
        </div>
      </div>
    </>
  );
};

export default VideoPlayerRTL;