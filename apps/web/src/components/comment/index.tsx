"use client";
import React from "react";
import { CommentBody, type CommentProps } from "./CommentBody";

export type { CommentProps };

/** Video comment (LTR). Rendering is shared with the RTL variant in CommentBody. */
const Comment: React.FC<CommentProps> = (props) => <CommentBody {...props} dir="ltr" />;

export default Comment;
