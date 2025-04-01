"use client";
import React from 'react';
import Image from 'next/image';


export interface PlayerOptions {
  id: string;
  title: string;
  channel: string;
  channelAvatar: string;
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
      <div className="flex justify-center w-full h-auto mt-0 max-w-[1280px] max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
        <video
          key={options.id}
          className="video-js vjs-default-skin h-auto rounded-lg overflow-hidden max-w-[1280px] max-h-[720px] 2xl:max-w-[1920px] 2xl:max-h-[1080px]"
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
      <div className="flex space-x-4 mt-4 justify-start items-center">
        <div className="w-10 h-10 rounded-full overflow-hidden relative">
          <Image src={options.channelAvatar} alt="User" width={40} height={40} objectFit="cover" className='bg-ummah-label' />
        </div>
        <div className="mt-4">
          <h1 className="text-xl font-semibold text-ummah-text">{options.title}</h1>
          {/* <p className="text-ummah-label">{options.views} views • {options.dateCreated.toLocaleDateString()}</p> */}
        </div>
      </div>
    </>
  );
}

export default VideoPlayer;