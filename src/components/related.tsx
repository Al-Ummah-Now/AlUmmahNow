"use client";
import React from 'react';
import Image from 'next/image';
import RelatedVideo from '@/components/relatedVideo';
import { VideoInfo } from '@/app/interfaces';

const Related: React.FC<{ relatedVideos: VideoInfo[] }> = ({ relatedVideos }) => {
    return (
        <div className="flex flex-col w-full  ">
            <h2 className="text-xl font-semibold mb-4 text-ummah-text">Related Videos</h2>
            <div className="space-y-4">
                {relatedVideos.map((video, index) => (
                    <RelatedVideo
                        key={index}
                        id={video.id}
                        title={video.title}
                        description={video.description}
                        channel={video.channel}
                        views={video.views}
                        thumbnail={video.thumbnail}
                        video={video.video}
                        dateModified={video.dateModified}
                        dateCreated={video.dateCreated}
                        channelId={video.channelId}
                    />
                ))}
            </div>
        </div>
    );
};

export default Related;