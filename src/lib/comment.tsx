"use client";
import React from 'react';
import Image from 'next/image';

export interface CommentProps {
    author: string;
    text: string;
    time: string;
    avatar: string;
}

const Comment: React.FC<CommentProps> = ({ author, text, time, avatar }) => {
    return (
        <div className="flex items-start space-x-4">
            <div className="w-10 h-10 rounded-full overflow-hidden relative">
                <Image src={avatar} alt={`${author}'s avatar`} width={40} height={40} objectFit="cover" className='bg-ummah-text' />
            </div>
            <div>
                <h4 className="text-sm font-semibold text-ummah-text">{author}</h4>
                <p className="text-xs text-ummah-label">{time}</p>
                <p className="text-sm text-ummah-text">{text}</p>
            </div>
        </div>
    );
};

export default Comment;