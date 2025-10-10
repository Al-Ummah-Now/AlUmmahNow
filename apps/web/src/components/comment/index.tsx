"use client";
import React from "react";

export interface CommentProps {
  author: string;
  text: string;
  time: string;
  avatar: string;
}

const Comment: React.FC<CommentProps> = ({ author, text, time, avatar }) => {
  return (
    <div className="flex items-start space-x-4">
      <img src={avatar} alt="Avatar" className="w-10 h-10 rounded-full" />
      <div>
        <h4 className="font-bold">{author}</h4>
        <p className="text-sm text-gray-500">{time}</p>
        <p>{text}</p>
      </div>
    </div>
  );
};

export default Comment;
