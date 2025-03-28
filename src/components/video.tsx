"use client";
import React from 'react';
import videojs from 'video.js';
import Player, { PlayerReadyCallback } from "video.js/dist/types/player";

import 'video.js/dist/video-js.css';

type PlayerOptions = Parameters<typeof videojs>[1];

export interface IVideoPlayerProps {
  options: PlayerOptions;
  onReady?: PlayerReadyCallback;
}

const initialOptions: PlayerOptions = {
  controls: true,
  fluid: true,
  controlBar: {
    volumePanel: {
      inline: false
    }
  }
};

const VideoPlayer: React.FC<IVideoPlayerProps> = ({ options, onReady }) => {
  const placeholderRef = React.useRef(null);
  const videoRef = React.useRef<HTMLVideoElement>();
  const playerRef = React.useRef<Player>();

  React.useEffect(() => {

    // Make sure Video.js player is only initialized once
    if (playerRef.current === undefined || playerRef.current === null) {
      const placeholderEl = placeholderRef.current;
      const videoElement = placeholderEl.appendChild(
        document.createElement("video-js")
      );

      // videoElement.classList.add('vjs-big-play-centered');
      //videoRef.current.appendChild(videoElement);

      playerRef.current = videojs(videoElement, {
        ...initialOptions,
        ...options
      });
    } else {
      const player = playerRef.current;
      console.log(playerRef);
      player.autoplay(options.autoplay);
      player.src(options.sources);
    }
  }, [options, onReady]);

  // Dispose the Video.js player when the functional component unmounts
  React.useEffect(() => {
    const player = playerRef.current;

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose();
        if (!playerRef.current) {
          playerRef.current = undefined;
        }
      }
    };
  }, [playerRef]);

  return (
    <div ref={placeholderRef} />
  );
}

export default VideoPlayer;