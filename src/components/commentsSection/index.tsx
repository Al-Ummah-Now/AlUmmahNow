"use client";
import React from "react";
import Comment, { CommentProps } from "@/components/comment";

const CommentsSection: React.FC<{ comments: CommentProps[] }> = ({ comments }) => {
  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Comments</h2>
      <div className="space-y-4">
        {comments.map((comment, index) => (
          <Comment key={index} {...comment} />
        ))}
      </div>
    </div>
  );
};

export default CommentsSection;
