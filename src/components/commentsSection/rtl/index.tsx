"use client";
import React from "react";
import CommentRTL, { CommentProps } from "@/components/comment/rtl";

const CommentsSectionRTL: React.FC<{ comments: CommentProps[] }> = ({ comments }) => {
  return (
    <div dir="rtl">
      <h2 className="text-lg font-bold mb-4">التعليقات</h2>
      <div className="space-y-4">
        {comments.map((comment, index) => (
          <CommentRTL key={index} {...comment} />
        ))}
      </div>
    </div>
  );
};

export default CommentsSectionRTL;
