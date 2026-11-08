"use client";
import React from "react";
import CommentsSection, { CommentsSectionProps } from "@/components/commentsSection";

/**
 * RTL comments section. The section itself renders RTL comment items when
 * the active language is RTL; this wrapper forces the RTL document direction.
 */
const CommentsSectionRTL: React.FC<CommentsSectionProps> = (props) => {
  return (
    <div dir="rtl" className="text-right">
      <CommentsSection {...props} />
    </div>
  );
};

export default CommentsSectionRTL;
