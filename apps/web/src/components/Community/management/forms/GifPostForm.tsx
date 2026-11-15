'use client';

import { useId, useState, useRef } from 'react';
import { COMMUNITY_UPLOAD_LIMITS } from '@al-ummah/shared-types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, X } from 'lucide-react';
import Image from 'next/image';
import { useLanguage } from '@/hooks/useLanguage';
import { overLimit, tooLargeMessage } from '@/lib/community/upload-limits';

export interface GifData {
  file?: File;
  url: string;
  width: number;
  height: number;
  duration: number;
}

interface GifPostFormProps {
  gif: GifData | null;
  onChange: (gif: GifData | null) => void;
  locale: string;
  error?: string;
}

export function GifPostForm({ gif, onChange, locale, error }: GifPostFormProps) {
  const isRTL = locale === 'ar';
  const { t, lang } = useLanguage();
  const errorId = `${useId()}-gif-error`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string>('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');

    if (file.type !== 'image/gif') {
      setUploadError(isRTL ? 'الملف يجب أن يكون GIF' : 'File must be a GIF');
      return;
    }

    // The API's limit (@al-ummah/shared-types): refused here, before anything is uploaded
    const tooLarge = overLimit(file, 'gif', COMMUNITY_UPLOAD_LIMITS);
    if (tooLarge) {
      setUploadError(tooLargeMessage(t, lang, 'gif', tooLarge));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.src = url;

    img.onload = () => {
      onChange({
        file,
        url,
        width: img.width,
        height: img.height,
        duration: 0
      });
    };

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUrlChange = (url: string) => {
    if (!url.trim()) {
      onChange(null);
      return;
    }

    onChange({
      url: url.trim(),
      width: 0,
      height: 0,
      duration: 0
    });
  };

  const handleRemove = () => {
    onChange(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm md:text-base">
          {isRTL ? 'صورة GIF' : 'GIF Image'}
        </Label>

        {!gif && (
          <div className="mt-3 space-y-3">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/gif"
                onChange={handleFileSelect}
                className="hidden"
                id="gif-upload"
                aria-invalid={uploadError ? true : undefined}
                aria-describedby={error || uploadError ? errorId : undefined}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto"
                aria-describedby={error || uploadError ? errorId : undefined}
              >
                <Upload className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                {isRTL ? 'رفع GIF' : 'Upload GIF'}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {isRTL ? 'أو' : 'or'}
                </span>
              </div>
            </div>

            <Input
              placeholder={isRTL ? 'الصق رابط GIF...' : 'Paste GIF URL...'}
              onChange={(e) => handleUrlChange(e.target.value)}
              dir={isRTL ? 'rtl' : 'ltr'}
              className="text-sm md:text-base"
            />
          </div>
        )}

        {gif && (
          <div className="mt-3">
            <div className="relative rounded-lg overflow-hidden bg-muted">
              <div className="relative aspect-video">
                <Image
                  src={gif.url}
                  alt="GIF preview"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 rtl:right-auto rtl:left-2"
                onClick={handleRemove}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {(error || uploadError) && (
          <p id={errorId} role="alert" className="text-destructive text-xs md:text-sm mt-2">
            {error || uploadError}
          </p>
        )}
      </div>
    </div>
  );
}
