'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import VideoCardLTR from "@/components/videoCard/index";
import VideoCardRTL from "@/components/videoCard/rtl/index";
import { useQueryState } from "nuqs";
import { fetchVideosWithPagination } from "@/lib/api/videos";
import { getNextVideosCursor } from "./videos/VideosPageClient";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import { LibraryRow } from "@/components/home/LibraryRow";
import { HomeHero, HomeHeroPlaceholder } from "@/components/ThemeDemo/HomeHero";
import { pickHomeFeatured } from "@/lib/video/hero";
import type { PaginationResponse } from "@/lib/api/types";
import { mergeFresh } from "@/lib/ssr/merge-fresh";
import { SignInBanner } from "@/components/home/SignInBanner";
import { HomeRails } from "@/components/home/HomeRails";
import { getHomeRails } from "@/lib/api/discovery-home";
import type { HomeRail } from "@/lib/discovery/home-rails";
import Link from "@/components/common/AppLink";
import { AlertCircle, Compass, Film } from "lucide-react";

/** Never featured on the home hero (kept from the original pick). */
const HOME_HERO_EXCLUDED: ReadonlySet<string> = new Set(["e42e5deb-c86a-40b0-b8ec-6072fc550dba"]);

/** How many cards from the top load at once (the first rows); the rest load as they near the screen */
const EAGER_CARDS = 3;

/** The first card is the largest image only when there is no hero (the hero's image is then the LCP element) */
function cardLoading(index: number, hasHero: boolean): "high" | "eager" | undefined {
  if (index >= EAGER_CARDS) return undefined;
  return index === 0 && !hasHero ? "high" : "eager";
}

interface HomePageClientProps {
  /**
   * The first page of videos, read on the server (page.tsx) so the HTML carries the hero and the
   * cards. Missing when the API was slow or down: the page then fetches it after hydration.
   */
  initialPage?: PaginationResponse<VideoObject>;
  /** The server dropped an image only the viewer may see: reload the first page after hydration */
  initialPartial?: boolean;
  /**
   * The ranked rails (wiki E07 "Discovery ranking"), read on the server in the page language. Missing
   * when the API was slow or down: the page then fetches them after hydration.
   */
  initialRails?: HomeRail[];
  /** The server dropped an image in the rails: reload them after hydration */
  initialRailsPartial?: boolean;
}

const VideosPage: React.FC<HomePageClientProps> = ({ initialPage, initialPartial = false, initialRails, initialRailsPartial = false }) => {
  const { t, isRTL, lang } = useLanguage();
  const [rails, setRails] = useState<HomeRail[]>(() => initialRails ?? []);
  const { user: _user } = useAuth();
  const [videos, setVideos] = useState<VideoObject[]>(() => initialPage?.data ?? []);
  const [_cursor, setCursor] = useQueryState("cursor", { shallow: true });
  const [nextCursor, setNextCursor] = useState<string | null>(() => (initialPage ? getNextVideosCursor(initialPage) : null));
  // Without a server page it starts true: the first page is fetched on mount, and rendering the
  // placeholders from the first paint avoids a layout shift
  const [loading, setLoading] = useState(!initialPage);
  // The first page could not be read (API down or slow): a retry instead of an empty grid
  const [failed, setFailed] = useState(false);
  const [isCollapsed, _setIsCollapsed] = useState(true);

  // Select VideoCard component based on locale
  const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR;

  // Prevent duplicate initial fetch (none at all when the server sent the first page)
  const hasInitialFetch = useRef(!!initialPage);

  const fetchVideos = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await fetchVideosWithPagination(cursor);

      if (!data) {
        logger.error("Failed to fetch videos");
        setFailed(true);
        return;
      }

      // Append new videos to the existing list, avoiding duplicates
      setVideos((prevVideos) => {
        const existingIds = new Set(prevVideos.map(video => video.id));
        const newVideos = data.data.filter(video => !existingIds.has(video.id));
        return [...prevVideos, ...newVideos];
      });
      // GET /api/videos returns a top-level `cursor` ("" when there are no more pages)
      setNextCursor(getNextVideosCursor(data));
    } catch (error) {
      logger.error("Error fetching videos:", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fresh copies (signed images included) of the server's first page, when it had to drop some
  const refreshed = useRef(false);
  useEffect(() => {
    if (!initialPartial || refreshed.current) return;
    refreshed.current = true;
    fetchVideosWithPagination(null)
      .then((page) => {
        if (page?.data) setVideos((shown) => mergeFresh(shown, page.data));
      })
      .catch((error) => logger.warn('VideosPage: refreshing the first page failed', { error }));
  }, [initialPartial]);

  useEffect(() => {
    // Prevent duplicate initial fetch
    if (hasInitialFetch.current) {
      logger.debug('VideosPage: Skipping duplicate initial fetch');
      return;
    }

    logger.debug('VideosPage: Performing initial fetch');
    hasInitialFetch.current = true;
    fetchVideos(null);
  }, [fetchVideos]);

  // The rails when the server could not read them (or dropped an image only the viewer may see)
  const railsLoaded = useRef(!!initialRails && !initialRailsPartial);
  useEffect(() => {
    if (railsLoaded.current) return;
    railsLoaded.current = true;
    getHomeRails(lang === 'ar' ? 'ar' : 'en')
      .then((fresh) => {
        if (fresh) setRails(fresh);
      })
      .catch((error) => logger.warn('VideosPage: loading the home rails failed', { error }));
  }, [lang]);

  // A ready landscape video unless an editor featured one (lib/video/hero.ts)
  const featured = pickHomeFeatured(videos, HOME_HERO_EXCLUDED);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor); // Update the cursor in the query state
      fetchVideos(nextCursor); // Fetch the next page of videos
    }
  };

  return (
        <main
          className={`flex flex-col p-4 w-full transition-all duration-300 ${
            isCollapsed ? (isRTL ? "md:pr-20" : "md:pl-20") : (isRTL ? "md:pr-56" : "md:pl-56")
          }`}
          style={{ direction: isRTL ? "rtl" : "ltr" }}
        >
{/* Signed-out visitors only, decided on the server (no flash for the signed-in) */}
<SignInBanner />
<LibraryRow />
{featured ? <HomeHero video={featured} /> : loading && videos.length === 0 && <HomeHeroPlaceholder />}
<HomeRails rails={rails} />
<h1 className="home-h street-plate text-2xl font-bold text-[var(--fanous-color-text-primary)] mb-4">{t.video.videos}</h1>
          {loading && videos.length === 0 ? (
            // Card-sized placeholders reserve the grid's space so the cards
            // (and the button below) don't shift the layout when they load
            <div
              role="status"
              aria-busy="true"
              data-testid="video-grid-loading"
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4"
            >
              <span className="sr-only">{t.common.loading}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} aria-hidden="true" className="flex flex-col rounded-lg shadow-md overflow-hidden bg-[var(--fanous-color-surface-raised)]">
                  <div className="w-full h-48 bg-[var(--fanous-color-divider)] animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-5 w-3/4 rounded bg-[var(--fanous-color-divider)] animate-pulse" />
                    <div className="h-4 w-1/2 rounded bg-[var(--fanous-color-divider)] animate-pulse" />
                    <div className="h-4 w-1/3 rounded bg-[var(--fanous-color-divider)] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : videos.length === 0 && failed ? (
            // The first page failed: say so and offer a retry (never a blank page)
            <div role="alert" data-testid="home-load-failed" className="c empty">
              <AlertCircle aria-hidden="true" />
              <p>{t.video.homeLoadFailed}</p>
              <button type="button" className="b b-secondary" onClick={() => fetchVideos(null)}>{t.common.retry}</button>
            </div>
          ) : videos.length === 0 ? (
            // No public videos yet (#1629, no hollow pages): what will appear here and where to go
            // meanwhile. No upload invitation: uploading is by invitation (creator tiers).
            <div data-testid="home-empty" className="c empty">
              <Film aria-hidden="true" />
              <h4>{t.video.homeEmptyTitle}</h4>
              <p>{t.video.homeEmptyBody}</p>
              <Link href={`/${lang}/explore`} className="b b-secondary" data-testid="home-empty-explore">
                <Compass aria-hidden="true" />
                {t.video.homeEmptyAction}
              </Link>
            </div>
          ) : (
            <div data-testid="video-grid" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
              {videos.map((video, index) => (
                <VideoCard key={video.id} {...video} imageLoading={cardLoading(index, !!featured)} />
              ))}
            </div>
          )}
          {/* Only when there is a next page (or one is loading). Rendered always, it sat under the
              6-card placeholder and jumped up into view when a short first page replaced it:
              CLS 0.38 on a phone (release spec home-hero, QA 2026-11-12). */}
          {(nextCursor || (loading && videos.length > 0)) && (
            <div className="flex justify-center items-center mt-6" data-testid="home-load-more">
              <button
                onClick={handleNextPage}
                disabled={!nextCursor || loading}
                className="px-4 py-2 bg-[var(--fanous-color-primary)] text-[var(--fanous-color-on-primary)] rounded disabled:opacity-50"
              >
                {loading ? t.common.loading : t.common.loadMore}
              </button>
            </div>
          )}
        </main>
  );
};

export default VideosPage;
