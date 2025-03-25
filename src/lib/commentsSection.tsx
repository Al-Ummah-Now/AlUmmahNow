"use client";
import React from 'react';
import Comment, { CommentProps } from './comment';

const CommentsSection: React.FC<{ comments: CommentProps[] }> = ({ comments }) => {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-4 text-ummah-text">Comments</h2>
      <div className="space-y-4">
        {comments.map((comment, index) => (
          <Comment
            key={index}
            author={comment.author}
            text={comment.text}
            time={comment.time}
            avatar={comment.avatar}
          />
        ))}
      </div>
    </div>
  );
};

export default CommentsSection;