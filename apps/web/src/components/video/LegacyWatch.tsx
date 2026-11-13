'use client';

import React from "react";
import { useQueryState } from "nuqs";
import { MAIN_CONTENT_ID } from "@/components/SkipLinks";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * Legacy watch route (/[locale]/video?vid=<id>), still used by video cards. The watch page itself
 * is in the /[locale]/video layout (components/video/WatchShell.tsx), the same one /video/[id]
 * uses, so moving between the two forms keeps the player; this page gives it the server's
 * placeholder, or says no video was chosen.
 */
export default function LegacyWatch({ skeleton }: { skeleton?: React.ReactNode }) {
  const { t, isRTL } = useLanguage();
  const [vid] = useQueryState("vid", { shallow: false });

  if (!vid) {
    return (
      <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col items-center justify-center p-8" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t.video.noVideoSelected}</h1>
          <p className="text-muted-foreground mb-6">
            {t.video.selectVideoMessage}
          </p>
        </div>
      </main>
    );
  }

  return <>{skeleton}</>;
}
