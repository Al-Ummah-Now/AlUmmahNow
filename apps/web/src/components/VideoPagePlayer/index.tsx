"use client";
import React, { useMemo } from "react";
import type { Player } from "video.js";
import Image from "next/image";
import Link from "next/link";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "./interface";
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

const VideoPlayer: React.FC<WatchPlayerProps> = ({ options, startTime, onPlayerReady }) => {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const locale = lang;

  const title = getLocalizedValue(options.titleLocalized, options.title, locale);
  const channelHref = playerChannelHref(locale, options);
  const channelName = playerChannelName(options);

  // Convert PlayerOptions to CustomVideoPlayer props
  // Memoize to prevent new array reference on every render
  const videoSources = useMemo(() => [
    {
      src: options.playUrl || '',
      type: 'application/x-mpegURL'
    }
  ], [options.playUrl, options.id]);

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  // Ensure the poster URL has the protocol (https://) - some API responses return relative URLs
  const posterUrl = useMemo(() => {
    // Bunny keeps the thumbnail next to the playlist, so derive it from this
    // video's own library (QA/prod differ) rather than a hard-coded host.
    const derived = options.playUrl?.endsWith('/playlist.m3u8')
      ? options.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg')
      : '';
    const poster = options.poster || derived;
    // If the poster URL doesn't start with http:// or https://, prepend https://
    if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
      return `https://${poster}`;
    }
    return poster;
  }, [options.poster, options.id]);

  return (
    <>
      <div className="flex w-full mt-0 relative dark:bg-gray-900">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* Video.js player with chapters and subtitles */}
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
            lang="en"
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
            title={removeUnwantedChars(title)}
            startTime={startTime}
            onPlayerReady={onPlayerReady}
          />
        </div>
      </div>

      {/* Video Details */}
      <div className="mt-4 w-full">
        {/* Video Title */}
        <h1 className="text-lg md:text-xl font-semibold text-black dark:text-white mb-3">
          {removeUnwantedChars(title)}
        </h1>

        {/* Channel Info */}
        <div className="flex space-x-3 rtl:space-x-reverse items-center">
          {channelHref ? (
            <Link
              href={channelHref}
              className="w-11 h-11 shrink-0 rounded-full overflow-hidden relative hover:opacity-80 transition-opacity"
              tabIndex={-1}
              aria-hidden="true"
            >
              <Image src={options.channelAvatar || '/avatar.png'} alt="" sizes="44px" className="bg-gray-500 object-cover" fill />
            </Link>
          ) : (
            <span className="w-11 h-11 shrink-0 rounded-full overflow-hidden relative" aria-hidden="true">
              <Image src={options.channelAvatar || '/avatar.png'} alt="" sizes="44px" className="bg-gray-500 object-cover" fill />
            </span>
          )}
          <div className="min-w-0">
            {channelHref ? (
              <Link
                href={channelHref}
                data-testid="watch-channel-link"
                className="inline-flex items-center min-h-11 text-sm md:text-base font-medium text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white"
              >
                {removeUnwantedChars(channelName)}
              </Link>
            ) : (
              <span className="inline-flex items-center min-h-11 text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                {removeUnwantedChars(channelName)}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default VideoPlayer;