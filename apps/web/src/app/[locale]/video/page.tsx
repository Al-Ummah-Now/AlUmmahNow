'use client';

import React from "react";
import { useQueryState } from "nuqs";
import { MAIN_CONTENT_ID } from "@/components/SkipLinks";
import WatchPageContent from "@/components/video/WatchPageContent";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * Legacy watch route (/[locale]/video?vid=<id>), still used by video cards.
 * Renders the same watch page as /[locale]/video/[id].
 */
export default function LegacyVideoPage() {
  const { t, isRTL } = useLanguage();
  const [vid] = useQueryState("vid", { shallow: false });

  if (!vid) {
    return (
      <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col items-center justify-center p-8" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t.video.noVideoSelected}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t.video.selectVideoMessage}
          </p>
        </div>
      </main>
    );
  }

  return <WatchPageContent videoId={vid} />;
}
