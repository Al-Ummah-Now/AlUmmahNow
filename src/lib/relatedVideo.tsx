"use client";
import React from 'react';
import Image from 'next/image';

export interface RelatedVideoProps {
  title: string;
  channel: string;
  views: string;
  thumbnail: string;
  time: string;
}

const RelatedVideo: React.FC<RelatedVideoProps> = ({ title, channel, views, thumbnail, time }) => {
  return (
    <div className="flex items-center space-x-4 p-4">
      <div className="w-24 h-16 bg-gray-300 rounded-lg overflow-hidden">
        <Image
          src={thumbnail}
          alt="Thumbnail"
          width={96}
          height={64}
          className="object-cover"
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ummah-text">{title}</h3>
        <p className="text-xs text-ummah-label">{channel}</p>
        <p className="text-xs text-ummah-label">{views} • {time}</p>
      </div>
    </div>
  );
};

export default RelatedVideo;