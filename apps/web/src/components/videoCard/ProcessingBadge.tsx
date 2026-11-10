"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * "Processing" / "Needs re-upload" over a card's thumbnail. Public lists only
 * carry ready videos, so in practice the owner sees it on their own channel.
 */
export function ProcessingBadge({ uploadStatus }: { uploadStatus?: string }) {
    const { t } = useLanguage();
    if (!uploadStatus || uploadStatus === "ready") return null;
    const failed = uploadStatus === "failed";
    return (
        <span
            data-testid="video-card-processing"
            data-status={uploadStatus}
            className={`absolute top-2 start-2 z-10 rounded px-2 py-0.5 text-xs font-semibold shadow ${
                failed ? "bg-red-700 text-white" : "bg-amber-400 text-gray-900"
            }`}
        >
            {failed ? t.video.processingFailedBadge : t.video.processingBadge}
        </span>
    );
}
