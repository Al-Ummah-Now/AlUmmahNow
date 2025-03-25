"use client";
import React from 'react';
import Image from 'next/image';
import RelatedVideo, { RelatedVideoProps } from '@/lib/relatedVideo';

const Related: React.FC<{ relatedVideos: RelatedVideoProps[] }> = ({ relatedVideos }) => {
    return (
        <div className="flex-none mt-5">
            <h2 className="text-xl font-semibold mb-4 text-ummah-text">Related Videos</h2>
            <div className="space-y-4">
                {/* Example of a related video item */}
                {relatedVideos.map((video, index) => (
                    <RelatedVideo
                        key={index}
                        title={video.title}
                        channel={video.channel}
                        views={video.views}
                        thumbnail={video.thumbnail}
                        time={video.time}
                    />
                ))}
                {/* Repeat similar blocks for more related videos */}
            </div>
        </div>
    );
};

export default Related;