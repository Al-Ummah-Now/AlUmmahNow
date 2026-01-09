'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';

export interface ImageWithCaption {
  file?: File;
  url: string;
  caption: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}

interface ImagePostFormProps {
  images: ImageWithCaption[];
  onChange: (images: ImageWithCaption[]) => void;
  locale: string;
  error?: string;
}

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function ImagePostForm({ images, onChange, locale, error }: ImagePostFormProps) {
  const isRTL = locale === 'ar';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string>('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadError('');

    if (images.length + files.length > MAX_IMAGES) {
      setUploadError(isRTL
        ? `الحد الأقصى ${MAX_IMAGES} صور`
        : `Maximum ${MAX_IMAGES} images allowed`
      );
      return;
    }

    const newImages: ImageWithCaption[] = [];

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setUploadError(isRTL
          ? 'نوع الملف غير مدعوم'
          : 'Unsupported file type'
        );
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(isRTL
          ? 'حجم الملف يجب أن يكون أقل من 16MB'
          : 'File size must be less than 16MB'
        );
        continue;
      }

      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = url;

      await new Promise((resolve) => {
        img.onload = () => {
          newImages.push({
            file,
            url,
            caption: '',
            width: img.width,
            height: img.height,
            size: file.size,
            mimeType: file.type
          });
          resolve(null);
        };
      });
    }

    onChange([...images, ...newImages]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onChange(newImages);
  };

  const handleCaptionChange = (index: number, caption: string) => {
    const newImages = [...images];
    newImages[index] = { ...newImages[index], caption };
    onChange(newImages);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm md:text-base">
          {isRTL ? 'الصور' : 'Images'}
          <span className="text-muted-foreground ml-2 rtl:mr-2 rtl:ml-0">
            ({images.length}/{MAX_IMAGES})
          </span>
        </Label>

        {images.length < MAX_IMAGES && (
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              multiple
              onChange={handleFileSelect}
              className="hidden"
              id="image-upload"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <Upload className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
              {isRTL ? 'رفع صور' : 'Upload Images'}
            </Button>
          </div>
        )}

        {(error || uploadError) && (
          <p className="text-destructive text-xs md:text-sm mt-2">
            {error || uploadError}
          </p>
        )}
      </div>

      <div className="
        grid
        grid-cols-1       /* Mobile: 1 column */
        sm:grid-cols-2    /* Tablet: 2 columns */
        gap-4
      ">
        {images.map((image, index) => (
          <Card key={index} className="p-3 md:p-4 space-y-3">
            <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
              <Image
                src={image.url}
                alt={`Image ${index + 1}`}
                fill
                className="object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="
                  absolute
                  top-2 right-2
                  rtl:right-auto rtl:left-2
                  w-7 h-7
                  md:w-8 md:h-8
                "
                onClick={() => handleRemoveImage(index)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div>
              <Label htmlFor={`caption-${index}`} className="text-xs md:text-sm">
                {isRTL ? 'التسمية التوضيحية (اختياري)' : 'Caption (optional)'}
              </Label>
              <Textarea
                id={`caption-${index}`}
                value={image.caption}
                onChange={(e) => handleCaptionChange(index, e.target.value)}
                placeholder={isRTL ? 'أضف تسمية توضيحية...' : 'Add a caption...'}
                dir={isRTL ? 'rtl' : 'ltr'}
                className="mt-1 min-h-[60px] text-xs md:text-sm"
                maxLength={36}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {image.caption.length}/36
              </p>
            </div>
          </Card>
        ))}
      </div>

      {images.length === 0 && (
        <div className="
          border-2 border-dashed
          rounded-lg
          p-8 md:p-12
          text-center
          text-muted-foreground
        ">
          <ImageIcon className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4 opacity-50" />
          <p className="text-sm md:text-base">
            {isRTL ? 'لم يتم رفع صور بعد' : 'No images uploaded yet'}
          </p>
          <p className="text-xs md:text-sm mt-2">
            {isRTL ? 'JPG, PNG, GIF, WEBP - حتى 16MB' : 'JPG, PNG, GIF, WEBP - up to 16MB'}
          </p>
        </div>
      )}
    </div>
  );
}
