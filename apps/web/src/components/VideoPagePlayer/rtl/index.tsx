"use client";
import React from "react";
import type { Player } from "video.js";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "../interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";
import { VideoDetails } from "@/components/VideoPagePlayer/VideoDetails";
import { playerChannelHref, playerChannelName } from "@/lib/video/player-channel";
import { useDeliveryPlayback } from "../useDeliveryPlayback";

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

  // Bunny or R2 per the admin switch, one-time fallback to Bunny, QoE: same hook as the LTR player
  const { videoSources, posterUrl, handlePlayerReady } = useDeliveryPlayback(options, onPlayerReady);

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
            onPlayerReady={handlePlayerReady}
          />
        </div>
      </div>
      <VideoDetails title={title} channelName={playerChannelName(options)} channelHref={playerChannelHref('ar', options)} options={options} avatarAlt={t.a11y.channelAvatar.replace('{channel}', removeUnwantedChars(playerChannelName(options)))} />
    </>
  );
};

export default VideoPlayerRTL;