'use client';

import { BodyPortal } from '@/components/ui/BodyPortal';
import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useState } from 'react';

interface ImagePostProps {
  post: CommunityPost;
  isRTL?: boolean;
}

export default function ImagePost({ post, isRTL = false }: ImagePostProps) {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

  if (!post.images || post.images.length === 0) return null;

  const imageCount = post.images.length;

  const getGridClass = () => {
    if (imageCount === 1) return 'grid-cols-1';
    if (imageCount === 2) return 'grid-cols-2';
    if (imageCount === 3) return 'grid-cols-3';
    if (imageCount === 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div className="space-y-3">
      {/* Text content if present */}
      {post.content && (
        <p className={cn(
          'text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words',
          isRTL && 'text-right'
        )}>
          {post.content}
        </p>
      )}

      {/* Image Grid */}
      <div className={cn(
        'grid gap-2',
        getGridClass(),
        imageCount > 4 && 'max-h-[600px] overflow-hidden'
      )}>
        {post.images.slice(0, 10).map((image, index) => (
          <div
            key={index}
            className={cn(
              'relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer group',
              imageCount === 1 ? 'aspect-video' : 'aspect-square',
              index === 9 && imageCount > 10 && 'relative'
            )}
            onClick={() => setSelectedImage(index)}
          >
            <Image
              src={image.url}
              alt={image.caption || `Image ${index + 1}`}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-200"
              sizes={imageCount === 1 ? '100vw' : '(max-width: 768px) 50vw, 33vw'}
            />
            {image.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                <p className="text-white text-sm truncate">{image.caption}</p>
              </div>
            )}
            {index === 9 && imageCount > 10 && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="text-white text-2xl font-bold">+{imageCount - 10}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox Modal */}
      {selectedImage !== null && (
        <BodyPortal><div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-gray-300"
            onClick={() => setSelectedImage(null)}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative max-w-7xl max-h-[90vh] w-full h-full">
            <Image
              src={post.images[selectedImage].url}
              alt={post.images[selectedImage].caption || `Image ${selectedImage + 1}`}
              fill
              className="object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {imageCount > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {selectedImage > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImage(selectedImage - 1);
                  }}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg"
                >
                  Previous
                </button>
              )}
              {selectedImage < imageCount - 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImage(selectedImage + 1);
                  }}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg"
                >
                  Next
                </button>
              )}
            </div>
          )}
        </div></BodyPortal>
      )}
    </div>
  );
}
