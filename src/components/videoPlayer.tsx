"use client";
import React from 'react';
import Image from 'next/image';


export interface PlayerOptions {
  id: string;
  title: string;
  channel: string;
  description: string;
  views: string;
  url: string;
  autoplay: boolean;
  type: string;
  width?: number;
  height?: number;
  dateCreated: Date;
}

const VideoPlayer: React.FC<{ options: PlayerOptions }> = ({ options }) => {
  return (
    <>
      <div className="video-container w-full h-auto mt-0 max-w-[1920px] max-h-[1080px]">
        <video
          key={options.id}
          className="video-js vjs-default-skin w-full h-auto rounded-lg overflow-hidden"
          controls
          preload="auto"
        >
          <source
            src={options?.url ? `https://${options.url}` : ""}
            type={options?.type ?? "video/mp4"}
          />
          Your browser does not support the video tag.
        </video>
      </div>
      <div className="flex items-center space-x-4 mt-4">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image src="/avatar.png" alt="User" width={40} height={40} objectFit="cover" className='bg-ummah-label' />
        </div>
        <div className="mt-4">
          <h1 className="text-2xl font-semibold text-ummah-text">{options.title}</h1>
          <p className="text-ummah-label">{options.views} views • {options.dateCreated.toLocaleDateString()}</p>
        </div>
      </div>
    </>
  );
}

export default VideoPlayer;