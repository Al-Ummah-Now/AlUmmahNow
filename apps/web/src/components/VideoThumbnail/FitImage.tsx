"use client";
import React, { useState } from "react";
import Image from "next/image";
import { aspectOf, thumbnailFit } from "@/lib/video/aspect";

export interface FitImageProps {
  src: string;
  alt: string;
  sizes?: string;
  /** The video's stored size (Bunny's width/height), a hint until the image loads */
  videoWidth?: number | null;
  videoHeight?: number | null;
  onError?: () => void;
}

/**
 * A `fill` thumbnail image for a sized, `relative` box that never distorts:
 * an image of about the box's shape covers it; a clearly different one (a
 * vertical, square or 4:3 thumbnail in a 16:9 card) is shown whole over a
 * blurred, darkened copy of itself (lib/video/aspect.ts). The box needs
 * `overflow-hidden`.
 */
export function FitImage({ src, alt, sizes, videoWidth, videoHeight, onError }: FitImageProps) {
  // Keyed by src: a new image is measured again. (No reset effect: a cached
  // image reports onLoad during commit, before effects would run.)
  const [measured, setMeasured] = useState<{ src: string; image?: number; box?: number } | null>(null);
  const current = measured?.src === src ? measured : null;

  const fit = thumbnailFit(current?.image, aspectOf(videoWidth, videoHeight), current?.box);

  return (
    <>
      {fit === "contain" && (
        // Decorative backdrop: same (cached) image, blurred and darkened, so the letterbox is
        // not a flat bar; scaled up so the blur's soft rim falls outside the box
        <span aria-hidden="true" className="absolute inset-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
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
      <Image
        src={src}
        alt={alt}
        sizes={sizes}
        fill
        unoptimized
        data-fit={fit}
        data-testid="thumbnail-image"
        className={fit === "contain" ? "object-contain" : "object-cover"}
        onLoad={(e) => {
          // The image fills its box, so its layout size is the box's shape (16:9 card, 9:16 shorts box…)
          const img = e.currentTarget;
          const rect = img.getBoundingClientRect();
          setMeasured({ src, image: aspectOf(img.naturalWidth, img.naturalHeight), box: aspectOf(rect.width, rect.height) });
        }}
        onError={onError}
      />
    </>
  );
}

export default FitImage;
