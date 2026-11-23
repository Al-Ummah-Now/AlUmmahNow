"use client";
import React, { useCallback, useRef, useState } from "react";
import type { Player } from "video.js";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions, startsPortrait } from "./interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";
import { VideoDetails } from "@/components/VideoPagePlayer/VideoDetails";
import { playerChannelHref, playerChannelName } from "@/lib/video/player-channel";
import { useDeliveryPlayback } from "./useDeliveryPlayback";
import { ListenModeSwitch } from "./ListenModeSwitch";

interface WatchPlayerProps {
  options: PlayerOptions;
  /** Start position in seconds (?t= on the watch page) */
  startTime?: number;
  /** Gives the watch page the Video.js player (share "start at current time") */
  onPlayerReady?: (player: Player) => void;
  /** Start playing once loaded (playlist playback or an in-app advance; muted fallback when the browser refuses) */
  autoplayIntent?: boolean;
  /** Started by the countdown rather than the viewer: counted as an autoplayed view */
  autoplayedView?: boolean;
  /** Inside a playlist: start at 0 and offer the saved position instead of jumping to it */
  offerResume?: boolean;
}

const VideoPlayer: React.FC<WatchPlayerProps> = ({ options, startTime, onPlayerReady, autoplayIntent, autoplayedView, offerResume }) => {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const locale = lang;

  const title = getLocalizedValue(options.titleLocalized, options.title, locale);
  const channelHref = playerChannelHref(locale, options);
  const channelName = playerChannelName(options, locale);

  const playerRef = useRef<Player | null>(null);
  const [isListenView, setIsListenView] = useState(false);

  const combinedOnPlayerReady = useCallback(
    (p: Player) => {
      playerRef.current = p;
      onPlayerReady?.(p);
    },
    [onPlayerReady],
  );

  // Bunny or R2, fallback and QoE: shared with the RTL player
  const { videoSources, posterUrl, handlePlayerReady, handlePlaybackError } = useDeliveryPlayback(options, combinedOnPlayerReady);

  return (
    <>
      <div className="flex flex-col w-full mt-0 relative">
        <div className={`w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px] ${isListenView ? "hidden" : ""}`}>
          {/* Video.js player with chapters and subtitles */}
          <VideoPlayerWithChapters
            videoId={options.id}
            expectChapters={options.hasChapters === true}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            initialPortrait={startsPortrait(options)}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            isShort={options.isShort === true}
            lang="en"
            audioTracks={options.audioTracks}
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
            title={removeUnwantedChars(title)}
            startTime={startTime}
            onPlayerReady={handlePlayerReady}
            onPlaybackError={handlePlaybackError}
            autoplayIntent={autoplayIntent}
            autoplayedView={autoplayedView}
            offerResume={offerResume}
          />
        </div>
        <ListenModeSwitch
          videoId={options.id}
          title={removeUnwantedChars(title)}
          channelName={removeUnwantedChars(channelName)}
          thumbnailUrl={posterUrl}
          fallbackPlayUrl={videoSources[0]?.src}
          duration={options.duration}
          getVideoPlaybackState={() => {
            const p = playerRef.current as (Player & { playbackRate?: (r?: number) => number }) | null;
            return {
              currentTime: Number(p?.currentTime?.() ?? startTime ?? 0),
              playbackRate: Number(p?.playbackRate?.() ?? 1),
            };
          }}
          pauseVideo={() => {
            playerRef.current?.pause?.();
          }}
          resumeVideoAt={(seconds, rate) => {
            const p = playerRef.current as (Player & { playbackRate?: (r?: number) => number }) | null;
            if (!p) return;
            p.playbackRate?.(rate);
            p.currentTime?.(seconds);
            void p.play?.();
          }}
          isListenView={isListenView}
          onListenViewChange={setIsListenView}
        />
      </div>
      <VideoDetails title={title} channelName={channelName} channelHref={channelHref} options={options} />
    </>
  );
};

export default VideoPlayer;