"use client";
import React from "react";
import { CommentBody, type CommentProps } from "../CommentBody";

export type { CommentProps };

/** Video comment (RTL). Rendering is shared with the LTR variant in CommentBody. */
const CommentRTL: React.FC<CommentProps> = (props) => <CommentBody {...props} dir="rtl" />;

export default CommentRTL;
