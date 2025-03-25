"use client";
import React from 'react';

export interface PlayerOptions {
    url: string;
    autoplay: boolean;
    type: string;
    width?: number;
    height?: number;
}

const VideoPlayer: React.FC<{ options: PlayerOptions }> = ({ options }) => {

  return (
    <div className={`video-container w-${options.width??"auto"} h-${options.height??"auto"}`}>
      <video
        className="video-js vjs-default-skin w-full h-auto rounded-lg overflow-hidden"
        controls
        preload="auto"
        width={options.width}
        height={options.height}
      >
        <source
          src={options.url}
          type={options.type}
        />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}

export default VideoPlayer;