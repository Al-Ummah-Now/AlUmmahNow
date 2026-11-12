"use client";
import React, { useMemo } from "react";
import type { Player } from "video.js";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";
import { VideoDetails } from "@/components/VideoPagePlayer/VideoDetails";
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
      <div className="flex w-full mt-0 relative" dir="rtl">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* New Custom Video.js Player with Arabic/RTL support */}
          <VideoPlayerWithChapters
            videoId={options.id}
            expectChapters={options.hasChapters === true}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            initialPortrait={(options.height ?? 0) > (options.width ?? 0)}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            isShort={options.isShort === true}
            lang="ar"
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
            title={removeUnwantedChars(title)}
            startTime={startTime}
            onPlayerReady={onPlayerReady}
          />
        </div>
      </div>
      <VideoDetails title={title} channelName={playerChannelName(options)} channelHref={playerChannelHref('ar', options)} options={options} avatarAlt={t.a11y.channelAvatar.replace('{channel}', removeUnwantedChars(playerChannelName(options)))} />
    </>
  );
};

export default VideoPlayerRTL;