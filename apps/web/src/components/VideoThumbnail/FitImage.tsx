"use client";
import React, { useState } from "react";
import Image from "next/image";
import { aspectOf, thumbnailFit } from "@/lib/video/aspect";
import { thumbSrcSet } from "@/lib/embed/share-image";

/**
 * How an image loads: `lazy` (the default) waits until it nears the screen; `eager` loads at once
 * (the first row of a list); `high` also asks for a high fetch priority (the page's largest image,
 * its LCP element).
 */
export type ImageLoading = "lazy" | "eager" | "high";

export interface FitImageProps {
  src: string;
  alt: string;
  sizes?: string;
  /** The video's stored size (Bunny's width/height), a hint until the image loads */
  videoWidth?: number | null;
  videoHeight?: number | null;
  onError?: () => void;
  loading?: ImageLoading;
}

/**
 * A `fill` thumbnail image for a sized, `relative` box that never distorts:
 * an image of about the box's shape covers it; a clearly different one (a
 * vertical, square or 4:3 thumbnail in a 16:9 card) is shown whole over a
 * blurred, darkened copy of itself (lib/video/aspect.ts). The box needs
 * `overflow-hidden`.
 */
export function FitImage({ src, alt, sizes, videoWidth, videoHeight, onError, loading = "lazy" }: FitImageProps) {
  // Keyed by src: a new image is measured again. (No reset effect: a cached
  // image reports onLoad during commit, before effects would run.)
  const [measured, setMeasured] = useState<{ src: string; image?: number; box?: number } | null>(null);
  const current = measured?.src === src ? measured : null;

  const fit = thumbnailFit(current?.image, aspectOf(videoWidth, videoHeight), current?.box);
  const measure = (img: HTMLImageElement) => {
    // The image fills its box, so its layout size is the box's shape (16:9 card, 9:16 shorts box…)
    const rect = img.getBoundingClientRect();
    setMeasured({ src, image: aspectOf(img.naturalWidth, img.naturalHeight), box: aspectOf(rect.width, rect.height) });
  };
  // The stable /thumb image (server-rendered lists, #1209) has width variants: a responsive srcset
  const srcSet = thumbSrcSet(src);
  const common = {
    sizes,
    loading: loading === "lazy" ? ("lazy" as const) : ("eager" as const),
    fetchPriority: loading === "high" ? ("high" as const) : undefined,
    "data-fit": fit,
    "data-testid": "thumbnail-image",
  };

  return (
    <>
      {fit === "contain" && (
        // Decorative backdrop: same (cached) image, blurred and darkened, so the letterbox is
        // not a flat bar; scaled up so the blur's soft rim falls outside the box
        <span aria-hidden="true" className="absolute inset-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={srcSet ? `${src}?w=320` : src}
            alt=""
            // Lazy like the thumbnail itself (next/image is lazy by default): a feed of letterboxed
            // cards must not fetch every backdrop up front (#1224)
            loading="lazy"
            decoding="async"
            data-testid="thumbnail-backdrop"
            className="h-full w-full scale-150 object-cover blur-xl brightness-50"
          />
        </span>
      )}
      {srcSet ? (
        // A plain img: next/image drops a srcset when unoptimized. Server-rendered, so it may have loaded
        // (or failed) before hydration, when React attaches no handler: checked once mounted too.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...common}
          alt={alt}
          src={src}
          srcSet={srcSet}
          decoding="async"
          className={`absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          ref={(img) => {
            // currentSrc is empty while a lazy image has not started: nothing to judge yet
            if (!img?.complete || !img.currentSrc || measured?.src === src) return;
            if (img.naturalWidth > 0) measure(img);
            else onError?.();
          }}
          onLoad={(e) => measure(e.currentTarget)}
          onError={onError}
        />
      ) : (
        <Image
          {...common}
          alt={alt}
          src={src}
          fill
          unoptimized
          loading={common.loading === "lazy" ? undefined : "eager"}
          className={fit === "contain" ? "object-contain" : "object-cover"}
          onLoad={(e) => measure(e.currentTarget)}
          onError={onError}
        />
      )}
    </>
  );
}

export default FitImage;
